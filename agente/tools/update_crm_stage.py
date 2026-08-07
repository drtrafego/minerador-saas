"""Tool update_crm_stage: muda o estagio do lead no CRM."""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

_VALID_STAGES = {
    "contactado",
    "em_conversa",
    "qualificado",
    "call_agendada",
    "perdido",
}

tool = {
    "name": "update_crm_stage",
    "description": (
        "Atualiza o estágio do lead no CRM. Valores aceitos: contactado, em_conversa, "
        "qualificado, call_agendada, perdido."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "stage": {
                "type": "string",
                "enum": list(_VALID_STAGES),
                "description": "Novo estágio do lead",
            },
            "reason": {"type": "string", "description": "Motivo opcional da mudança"},
        },
        "required": ["stage"],
    },
}


async def execute(args: dict, context: dict) -> dict:
    stage = (args.get("stage") or "").strip()
    if stage not in _VALID_STAGES:
        return {"error": f"stage inválido: {stage}"}

    lead_id = context.get("lead_id", "")
    payload = {"stage": stage}
    reason = args.get("reason")
    if reason:
        payload["reason"] = reason

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.put(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/stage",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json=payload,
            )
    except Exception as exc:
        logger.error("update_crm_stage falhou: %s", exc)
        return {"error": "Não consegui atualizar o estágio agora."}

    return {"ok": True, "stage": stage}
