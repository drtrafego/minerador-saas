"""Handlers do webhook oficial Meta WhatsApp Cloud API v25.0."""
import asyncio
import hashlib
import hmac
import logging
import re
import unicodedata
from collections import OrderedDict
from typing import Any

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import PlainTextResponse

from clients import meta_whatsapp, transcrever
from config import settings
from runner import run
from session.debouncer import Debouncer

logger = logging.getLogger(__name__)

_OPT_OUT_DESPEDIDA = (
    "Sem problemas, não vou mais te enviar mensagens por aqui. Se um dia quiser "
    "falar com a gente, é só chamar. Tenha um ótimo dia."
)

_OPT_OUT_REGEX = re.compile(
    r"\b(?:nao quero|nao tenho interesse|sem interesse|nao receber|nao perturbe|"
    r"nao perturbar|parar|pare de|cancelar|remover|descadastr|sair da lista|"
    r"tirar da lista)\b"
)


def _normalizar(text: str) -> str:
    """Minusculas e sem acentos para casar padroes PT-BR de forma robusta."""
    decomposed = unicodedata.normalize("NFKD", text)
    sem_acento = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return sem_acento.lower().strip()


def is_opt_out(text: str) -> bool:
    """Heuristica PT-BR para detectar recusa ou pedido de descadastro."""
    if not text:
        return False
    return bool(_OPT_OUT_REGEX.search(_normalizar(text)))

_debouncer = Debouncer(seconds=settings.DEBOUNCE_SECONDS)

_DEDUPE_MAX = 1000
_seen_messages: "OrderedDict[str, bool]" = OrderedDict()
_seen_lock = asyncio.Lock()


async def _dedupe(message_id: str) -> bool:
    """Retorna True se ja foi visto, False caso contrario. Atualiza LRU."""
    async with _seen_lock:
        if message_id in _seen_messages:
            _seen_messages.move_to_end(message_id)
            return True
        _seen_messages[message_id] = True
        while len(_seen_messages) > _DEDUPE_MAX:
            _seen_messages.popitem(last=False)
        return False


async def verify(request: Request) -> PlainTextResponse:
    """Confirma webhook handshake da Meta no GET /webhook."""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge") or ""
    if mode == "subscribe" and token == settings.META_VERIFY_TOKEN:
        return PlainTextResponse(content=challenge, status_code=200)
    raise HTTPException(status_code=403, detail="verify failed")


def verify_signature(body: bytes, signature_header: str) -> bool:
    """Confere assinatura X-Hub-Signature-256 com HMAC SHA256 do App Secret."""
    if not settings.META_APP_SECRET:
        if settings.APP_ENV != "development":
            logger.error("META_APP_SECRET ausente em producao, rejeitando requisicao")
            return False
        logger.warning("META_APP_SECRET ausente, bypass de assinatura ativo (desenvolvimento)")
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(
        settings.META_APP_SECRET.encode(), body, hashlib.sha256
    ).hexdigest()
    received = signature_header.split("=", 1)[1]
    return hmac.compare_digest(expected, received)


async def _lookup_lead_id(phone: str, name_hint: str | None) -> str | None:
    """Resolve lead_id pelo phone consultando o CRM. Cria lead se nao existir."""
    if not settings.CRM_BASE_URL:
        return None

    headers = {"Authorization": f"Bearer {settings.CRM_API_TOKEN}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(
                f"{settings.CRM_BASE_URL}/api/leads/by-phone/{phone}",
                headers=headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                lead_id = data.get("id")
                if lead_id:
                    return str(lead_id)
            elif resp.status_code != 404:
                logger.warning(
                    "by-phone status inesperado=%s body=%s",
                    resp.status_code,
                    resp.text,
                )
        except Exception as exc:
            logger.error("by-phone erro: %s", exc)

        try:
            create_resp = await client.post(
                f"{settings.CRM_BASE_URL}/api/leads",
                headers=headers,
                json={
                    "phone": phone,
                    "name": name_hint,
                    "source": "whatsapp_inbound",
                },
            )
            if create_resp.status_code in (200, 201):
                data = create_resp.json()
                lead_id = data.get("id")
                if lead_id:
                    return str(lead_id)
            logger.error(
                "criacao de lead falhou status=%s body=%s",
                create_resp.status_code,
                create_resp.text,
            )
        except Exception as exc:
            logger.error("create lead erro: %s", exc)
    return None


async def _extract_text(message: dict[str, Any]) -> str | None:
    """Extrai texto do payload Meta segundo o tipo. Trata audio via Gemini."""
    msg_type = message.get("type")
    if msg_type == "text":
        return (message.get("text") or {}).get("body")

    if msg_type == "audio":
        audio = message.get("audio") or {}
        media_id = audio.get("id")
        mime_type = audio.get("mime_type") or "audio/ogg"
        if not media_id:
            return None
        try:
            audio_bytes, fetched_mime = await meta_whatsapp.download_media(media_id)
        except Exception as exc:
            logger.error("falha baixando audio media_id=%s: %s", media_id, exc)
            return None
        text = await transcrever.transcribe(audio_bytes, fetched_mime or mime_type)
        return text or None

    if msg_type == "button":
        return (message.get("button") or {}).get("text")

    if msg_type == "interactive":
        interactive = message.get("interactive") or {}
        if interactive.get("type") == "button_reply":
            return (interactive.get("button_reply") or {}).get("title")
        if interactive.get("type") == "list_reply":
            return (interactive.get("list_reply") or {}).get("title")

    logger.info("tipo de mensagem ignorado type=%s", msg_type)
    return None


async def _post_outbound(lead_id: str, text: str) -> None:
    """Registra a resposta outbound do agente no CRM (thread, mensagem, atividade)."""
    if not settings.CRM_BASE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.CRM_BASE_URL}/api/whatsapp/outbound",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json={
                    "leadId": lead_id,
                    "text": text,
                },
            )
            if resp.status_code >= 400:
                logger.warning(
                    "post_outbound status inesperado=%s lead=%s body=%s",
                    resp.status_code,
                    lead_id,
                    resp.text[:300],
                )
    except Exception as exc:
        logger.warning("post_outbound falhou lead=%s: %s", lead_id, exc)


async def _send_response(to: str, text: str, lead_id: str) -> None:
    try:
        await meta_whatsapp.send_text(to, text)
    except Exception as exc:
        logger.error("send_text falhou to=%s: %s", to, exc)
        return
    await _post_outbound(lead_id, text)


async def _post_opt_out(lead_id: str, reason: str) -> None:
    """Marca o lead como nao perturbar e perdido no CRM (rota dedicada de opt-out)."""
    if not settings.CRM_BASE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/opt-out",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json={"reason": reason},
            )
            if resp.status_code >= 400:
                logger.warning(
                    "post_opt_out status inesperado=%s lead=%s body=%s",
                    resp.status_code,
                    lead_id,
                    resp.text[:300],
                )
    except Exception as exc:
        logger.warning("post_opt_out falhou lead=%s: %s", lead_id, exc)


async def _promote_stage(lead_id: str, stage: str, reason: str) -> None:
    """Tenta promover o lead para `stage`. O CRM ignora se ja esta em estagio superior."""
    if not settings.CRM_BASE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.put(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/stage",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json={"stage": stage, "reason": reason},
            )
    except Exception as exc:
        logger.warning("promote_stage falhou lead=%s stage=%s: %s", lead_id, stage, exc)


async def _post_inbound(lead_id: str, text: str, message_id: str | None) -> None:
    """Registra a mensagem inbound do lead no CRM (thread, mensagem, atividade, batch)."""
    if not settings.CRM_BASE_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.CRM_BASE_URL}/api/whatsapp/inbound",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json={
                    "leadId": lead_id,
                    "text": text,
                    "providerMessageId": message_id,
                },
            )
            if resp.status_code >= 400:
                logger.warning(
                    "post_inbound status inesperado=%s lead=%s body=%s",
                    resp.status_code,
                    lead_id,
                    resp.text[:300],
                )
    except Exception as exc:
        logger.warning("post_inbound falhou lead=%s: %s", lead_id, exc)


async def _process_message(message: dict[str, Any], contacts: list[dict[str, Any]]) -> None:
    message_id = message.get("id") or ""
    if message_id:
        already = await _dedupe(message_id)
        if already:
            logger.info("mensagem ja processada id=%s", message_id)
            return

    phone = message.get("from")
    if not phone:
        logger.warning("mensagem sem campo from, ignorando")
        return

    name_hint: str | None = None
    if contacts:
        profile = (contacts[0] or {}).get("profile") or {}
        name_hint = profile.get("name")

    text = await _extract_text(message)
    if not text:
        return

    lead_id = await _lookup_lead_id(phone, name_hint)
    if not lead_id:
        logger.error("nao foi possivel obter lead_id phone=%s", phone)
        return

    # Curto-circuito de opt-out so para CLIQUE DE BOTAO de quick reply: texto
    # digitado nunca corta a conversa (a recusa contextual fica a cargo da Amanda
    # via a tool registrar_opt_out, evitando falso positivo na qualificacao).
    eh_clique_botao = message.get("type") in ("button", "interactive")
    if eh_clique_botao and is_opt_out(text):
        logger.info("opt-out por clique de botao detectado lead=%s", lead_id)
        await _post_inbound(lead_id, text, message_id or None)
        await _post_opt_out(lead_id, text)
        await _send_response(phone, _OPT_OUT_DESPEDIDA, lead_id)
        return

    await _promote_stage(lead_id, "em_conversa", reason="lead respondeu via WhatsApp")
    await _post_inbound(lead_id, text, message_id or None)

    async def on_flush(batch: list[str]) -> None:
        full = " ".join(batch).strip()
        try:
            response_text = await run(lead_id, full)
        except Exception as exc:
            logger.error("runner falhou lead=%s: %s", lead_id, exc, exc_info=True)
            return
        if response_text:
            await _send_response(phone, response_text, lead_id)

    await _debouncer.add(lead_id, text, on_flush)


async def handle_incoming(payload: dict[str, Any]) -> None:
    """Roteia o payload completo da Meta para o processamento por mensagem."""
    entries = payload.get("entry") or []
    for entry in entries:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            messages = value.get("messages") or []
            contacts = value.get("contacts") or []
            for message in messages:
                try:
                    await _process_message(message, contacts)
                except Exception as exc:
                    logger.error("erro processando mensagem: %s", exc, exc_info=True)
