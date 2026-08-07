"""Loop de tool calling, recebe lead_id e inbound_text e retorna resposta final."""
import asyncio
import logging

import httpx

from agent import build_agent
from agent_prompt import get_instruction
from config import settings
from session.store import SessionStore
from tools import dispatch

logger = logging.getLogger(__name__)

_MAX_ITERATIONS = 8
_FALLBACK = "Desculpa, tive um problema técnico. Pode repetir?"


async def _fetch_last_outreach(lead_id: str) -> dict | None:
    """Busca a ultima abordagem outbound enviada ao lead no CRM."""
    if not settings.CRM_BASE_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/last-outreach",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
            )
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code != 404:
                logger.warning(
                    "last-outreach status inesperado=%s lead=%s",
                    resp.status_code,
                    lead_id,
                )
    except Exception as exc:
        logger.warning("last-outreach falhou lead=%s: %s", lead_id, exc)
    return None


async def _fetch_lead(lead_id: str) -> dict | None:
    """Busca os dados cadastrais do lead no CRM."""
    if not settings.CRM_BASE_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                # a rota retorna o lead aninhado em "lead"
                return data.get("lead") if isinstance(data, dict) else None
            if resp.status_code != 404:
                logger.warning(
                    "lead status inesperado=%s lead=%s",
                    resp.status_code,
                    lead_id,
                )
    except Exception as exc:
        logger.warning("fetch lead falhou lead=%s: %s", lead_id, exc)
    return None


def _build_context_note(outreach: dict | None, lead: dict | None = None) -> str | None:
    """Monta a nota de contexto interno para o primeiro turno."""
    blocos: list[str] = []

    if outreach and outreach.get("body"):
        template_key = outreach.get("templateKey")
        template_trecho = f" (template: {template_key})" if template_key else ""
        blocos.append(
            "Este lead recebeu uma abordagem de prospecção da Casal do Tráfego"
            + template_trecho
            + " e está respondendo agora. Você é a Amanda e está DANDO SEQUÊNCIA a "
            "essa conversa: não se reapresente do zero nem repita a abordagem. "
            "Reconheça o contato, faça a avaliação/qualificação completa normalmente "
            "e conduza para agendar uma call de vídeo de 20 minutos. Se o lead recusar "
            "ou pedir para não receber mais mensagens, use a ferramenta de opt-out e "
            "despeça-se com educação."
        )

    if lead:
        ramo = (lead.get("segmento") or lead.get("niche") or "").strip()
        cidade = (lead.get("city") or "").strip()
        empresa = (lead.get("razaoSocial") or lead.get("name") or "").strip()
        socio = (lead.get("socioPrincipal") or "").strip()

        partes: list[str] = []
        if ramo:
            partes.append(f"Ramo {ramo}")
        if cidade:
            partes.append(f"Cidade {cidade}")
        if empresa:
            partes.append(f"Empresa {empresa}")
        if socio:
            partes.append(f"Sócio {socio}")

        if partes:
            blocos.append(
                "Dados da empresa deste lead (do cadastro, podem estar imprecisos): "
                + " | ".join(partes)
                + ". Use isso para personalizar a abertura e demonstrar que conhece o "
                "negócio, mas CONFIRME em vez de afirmar (ex: 'vi que vocês atuam com X, "
                "é isso mesmo?'). NÃO pergunte o que já sabe (não pergunte o ramo/o que "
                "vende). Trate o sócio pelo primeiro nome."
            )

    if not blocos:
        return None

    return (
        "[CONTEXTO INTERNO, não responda a isto diretamente: "
        + " ".join(blocos)
        + "]"
    )


async def run(lead_id: str, inbound_text: str) -> str:
    instruction = await get_instruction()
    agent = build_agent(instruction)
    session = await SessionStore.load(lead_id)

    if len(session.messages) == 0:
        outreach, lead = await asyncio.gather(
            _fetch_last_outreach(lead_id),
            _fetch_lead(lead_id),
            return_exceptions=True,
        )
        if isinstance(outreach, Exception):
            logger.warning("last-outreach gather falhou lead=%s: %s", lead_id, outreach)
            outreach = None
        if isinstance(lead, Exception):
            logger.warning("fetch lead gather falhou lead=%s: %s", lead_id, lead)
            lead = None
        nota = _build_context_note(outreach, lead)
        if nota:
            session.append("user", nota)

    session.append("user", inbound_text)

    vazias = 0
    for _ in range(_MAX_ITERATIONS):
        result = await agent.generate(session.messages)

        if result.get("stop_reason") == "error":
            return _FALLBACK

        tool_calls = result.get("tool_calls") or []
        text = result.get("text") or ""

        if not tool_calls:
            if not text:
                vazias += 1
                logger.warning(
                    "resposta vazia do modelo lead=%s stop_reason=%s tentativa_vazia=%s",
                    lead_id,
                    result.get("stop_reason"),
                    vazias,
                )
                if vazias < 2:
                    continue
                return _FALLBACK
            session.append("assistant", text)
            await SessionStore.save(lead_id, session)
            return text

        session.append_assistant_tool_use(text, tool_calls)

        tool_results = []
        for tc in tool_calls:
            output = await dispatch(tc["name"], tc.get("args", {}), {"lead_id": lead_id})
            tool_results.append({
                "tool_use_id": tc["id"],
                "tool_name": tc["name"],
                "content": output,
            })
        session.append_tool_results(tool_results)

    logger.error("runner: limite de iteracoes atingido para lead_id=%s", lead_id)
    return _FALLBACK
