"""Registry e dispatch de tools do agente."""
from . import (
    notify_human,
    qualify_lead,
    registrar_opt_out,
    schedule_call,
    search_knowledge,
    update_crm_stage,
)

TOOLS = {
    "qualify_lead": qualify_lead.execute,
    "schedule_call": schedule_call.execute,
    "update_crm_stage": update_crm_stage.execute,
    "search_knowledge": search_knowledge.execute,
    "notify_human": notify_human.execute,
    "registrar_opt_out": registrar_opt_out.execute,
}


async def dispatch(name: str, args: dict, context: dict) -> dict:
    if name not in TOOLS:
        return {"error": f"tool desconhecida: {name}"}
    return await TOOLS[name](args, context)
