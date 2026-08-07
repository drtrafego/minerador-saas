"""Tool notify_human: aciona Gastao para casos fora do escopo."""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

_VALID_REASONS = {
    "STOP",
    "HOT_LEAD",
    "OUT_OF_SCOPE",
    "AGGRESSIVE",
    "BIG_TICKET",
    "TECH_QUESTION",
}
_VALID_URGENCY = {"low", "medium", "high"}

tool = {
    "name": "notify_human",
    "description": (
        "Notifica Gastão Matos quando a conversa sai do escopo do agente. "
        "Use para STOP, lead muito quente, agressividade, ticket alto ou pergunta técnica."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "enum": list(_VALID_REASONS),
                "description": "Motivo do acionamento",
            },
            "urgency": {"type": "string", "enum": list(_VALID_URGENCY)},
            "context": {"type": "string", "description": "Resumo do que aconteceu"},
        },
        "required": ["reason", "urgency", "context"],
    },
}


async def execute(args: dict, context: dict) -> dict:
    reason = (args.get("reason") or "").strip()
    urgency = (args.get("urgency") or "").strip()
    summary = (args.get("context") or "").strip()

    if reason not in _VALID_REASONS:
        return {"error": f"reason inválido: {reason}"}
    if urgency not in _VALID_URGENCY:
        return {"error": f"urgency inválido: {urgency}"}

    payload = {
        "leadId": context.get("lead_id", ""),
        "reason": reason,
        "urgency": urgency,
        "context": summary,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.CRM_BASE_URL}/api/notify",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json=payload,
            )
    except Exception as exc:
        logger.error("notify_human falhou: %s", exc)
        return {"error": "Não consegui acionar o time agora."}

    return {"ok": True, "reason": reason, "urgency": urgency}
