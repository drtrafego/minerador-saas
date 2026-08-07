"""Tool qualify_lead: registra BANT, calcula score e temperatura."""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)


tool = {
    "name": "qualify_lead",
    "description": (
        "Registra respostas BANT do lead, calcula score (0 a 5) e temperatura "
        "(cold, warm, hot). Chame quando já tiver pelo menos 3 dos 5 sinais."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "nicho": {"type": "string", "description": "Nicho ou segmento do lead"},
            "dor": {"type": "string", "description": "Principal dor declarada"},
            "budget_sinal": {"type": "boolean"},
            "authority_sinal": {"type": "boolean"},
            "need_sinal": {"type": "boolean"},
            "timing_sinal": {"type": "boolean"},
            "expectativa": {"type": "string", "description": "Expectativa de resultado"},
        },
        "required": ["nicho", "dor"],
    },
}


def _temperatura(score: int) -> str:
    if score >= 4:
        return "hot"
    if score >= 2:
        return "warm"
    return "cold"


async def execute(args: dict, context: dict) -> dict:
    sinais = [
        bool(args.get("budget_sinal")),
        bool(args.get("authority_sinal")),
        bool(args.get("need_sinal")),
        bool(args.get("timing_sinal")),
        bool(args.get("expectativa")),
    ]
    score = sum(1 for s in sinais if s)
    temperatura = _temperatura(score)
    should_book_call = score >= 3

    lead_id = context.get("lead_id", "")
    payload = {
        "nicho": args.get("nicho", ""),
        "dor": args.get("dor", ""),
        "bant_score": score,
        "temperatura": temperatura,
        "budget_sinal": bool(args.get("budget_sinal")),
        "authority_sinal": bool(args.get("authority_sinal")),
        "need_sinal": bool(args.get("need_sinal")),
        "timing_sinal": bool(args.get("timing_sinal")),
        "expectativa": args.get("expectativa", ""),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/qualify",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json=payload,
            )
    except Exception as exc:
        logger.error("qualify_lead falhou no CRM: %s", exc)

    return {
        "score": score,
        "temperatura": temperatura,
        "should_book_call": should_book_call,
    }
