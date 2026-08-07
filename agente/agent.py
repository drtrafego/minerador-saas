"""Agente SDR de prospeccao fria, estilo ADK do Google."""
from pathlib import Path

from config import settings
from providers.factory import get_provider
from tools import (
    notify_human,
    qualify_lead,
    registrar_opt_out,
    schedule_call,
    search_knowledge,
    update_crm_stage,
)

PROMPT_PATH = Path(__file__).parent / "prompts" / "sdr.md"

_TOOLS = [
    qualify_lead.tool,
    schedule_call.tool,
    update_crm_stage.tool,
    search_knowledge.tool,
    notify_human.tool,
    registrar_opt_out.tool,
]

_INSTRUCTION = PROMPT_PATH.read_text(encoding="utf-8")


def build_agent(instruction: str | None = None):
    provider = get_provider(settings.LLM_MODEL)
    return provider.bind(instruction or _INSTRUCTION, _TOOLS)
