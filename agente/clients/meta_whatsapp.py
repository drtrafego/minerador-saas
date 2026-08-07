"""Cliente HTTP para Meta WhatsApp Cloud API oficial."""
import logging
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.facebook.com"


def _graph_url(path: str) -> str:
    version = settings.META_GRAPH_VERSION or "v25.0"
    return f"{_GRAPH_BASE}/{version}/{path.lstrip('/')}"


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.META_ACCESS_TOKEN}"}


async def download_media(media_id: str) -> tuple[bytes, str]:
    """Baixa midia da Meta em dois passos.

    1) GET /{media_id} retorna metadados, inclusive a url pre assinada.
    2) GET na url retorna os bytes. Tudo com Bearer token.
    """
    if not settings.META_ACCESS_TOKEN:
        raise RuntimeError("META_ACCESS_TOKEN ausente, impossivel baixar midia")

    async with httpx.AsyncClient(timeout=30.0) as client:
        meta_resp = await client.get(_graph_url(media_id), headers=_auth_headers())
        meta_resp.raise_for_status()
        meta = meta_resp.json()
        url = meta.get("url")
        mime_type = meta.get("mime_type", "application/octet-stream")
        if not url:
            raise RuntimeError(f"resposta sem url para media_id={media_id}")

        bin_resp = await client.get(url, headers=_auth_headers())
        bin_resp.raise_for_status()
        return bin_resp.content, mime_type


async def send_text(to: str, body: str) -> dict[str, Any]:
    """Envia mensagem de texto via Cloud API."""
    if not settings.META_ACCESS_TOKEN or not settings.META_PHONE_NUMBER_ID:
        logger.warning("[meta_whatsapp] envs ausentes, mock send to=%s", to)
        return {"ok": True, "mock": True, "to": to}

    url = _graph_url(f"{settings.META_PHONE_NUMBER_ID}/messages")
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": body},
    }
    headers = {**_auth_headers(), "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            logger.error(
                "[meta_whatsapp] envio falhou status=%s body=%s",
                resp.status_code,
                resp.text,
            )
            return {"ok": False, "status": resp.status_code, "error": resp.text}
        data = resp.json()
        return {"ok": True, "data": data}
