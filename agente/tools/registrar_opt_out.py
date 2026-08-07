"""Tool registrar_opt_out: marca o lead como nao perturbar no CRM."""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)

tool = {
    "name": "registrar_opt_out",
    "description": (
        "Registra opt-out do lead quando ele recusa o contato ou pede para não "
        "receber mais mensagens durante a conversa. Marca o lead como não perturbar "
        "e o move para perdido no CRM. Depois de chamar, despeça-se com educação."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Trecho ou resumo do que o lead disse ao recusar",
            },
        },
        "required": [],
    },
}


async def execute(args: dict, context: dict) -> dict:
    lead_id = context.get("lead_id", "")
    if not lead_id:
        return {"error": "lead_id ausente no contexto."}

    reason = (args.get("reason") or "").strip()
    payload: dict = {}
    if reason:
        payload["reason"] = reason

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/opt-out",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json=payload,
            )
    except Exception as exc:
        logger.error("registrar_opt_out falhou lead=%s: %s", lead_id, exc)
        return {"error": "Não consegui registrar o opt-out agora."}

    if resp.status_code == 200:
        return {"ok": True}
    if resp.status_code == 404:
        logger.warning("registrar_opt_out lead nao encontrado lead=%s", lead_id)
        return {"ok": False, "error": "lead não encontrado"}

    logger.warning(
        "registrar_opt_out status inesperado=%s lead=%s body=%s",
        resp.status_code,
        lead_id,
        resp.text[:300],
    )
    return {"ok": False, "error": f"status {resp.status_code}"}
