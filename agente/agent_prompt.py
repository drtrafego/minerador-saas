"""Resolve a instrucao da Amanda: busca no CRM com cache, fallback pro arquivo."""
import logging
import time
from pathlib import Path

import httpx

from config import settings

logger = logging.getLogger(__name__)

_PROMPT_PATH = Path(__file__).parent / "prompts" / "sdr.md"
_FILE_INSTRUCTION = _PROMPT_PATH.read_text(encoding="utf-8")

_CACHE_TTL_SECONDS = 60.0
_cached_instruction: str | None = None
_cached_at: float = 0.0


async def _fetch_remote_prompt() -> str | None:
    """Busca o prompt no CRM. Retorna None em erro, timeout ou prompt vazio."""
    if not settings.CRM_BASE_URL:
        return None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.CRM_BASE_URL}/api/agent/prompt",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
            )
        if resp.status_code != 200:
            logger.warning("agent/prompt status inesperado=%s", resp.status_code)
            return None
        prompt = (resp.json() or {}).get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            return prompt
        return None
    except Exception as exc:
        logger.warning("agent/prompt falhou, usando fallback: %s", exc)
        return None


async def get_instruction() -> str:
    """Instrucao da Amanda com cache de 60s e fallback pro prompts/sdr.md."""
    global _cached_instruction, _cached_at

    now = time.monotonic()
    if _cached_instruction is not None and (now - _cached_at) < _CACHE_TTL_SECONDS:
        return _cached_instruction

    remote = await _fetch_remote_prompt()
    instruction = remote if remote is not None else _FILE_INSTRUCTION

    _cached_instruction = instruction
    _cached_at = now
    return instruction
