"""Tool search_knowledge: busca semantica na base de conhecimento do CRM."""
import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)


tool = {
    "name": "search_knowledge",
    "description": (
        "Busca informações na base de conhecimento da empresa sobre nichos, "
        "casos, serviços."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
}


async def execute(args: dict, context: dict) -> dict:
    query = (args.get("query") or "").strip()
    if not query:
        return {
            "found": False,
            "message": "Consulta vazia. Reformule a pergunta antes de buscar.",
        }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{settings.CRM_BASE_URL}/api/knowledge/search",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json={"query": query, "k": 4},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.error("search_knowledge falhou no CRM: %s", exc)
        return {
            "found": False,
            "message": (
                "Não foi possível consultar a base agora. Responda com info "
                "genérica e segura, sem inventar fatos específicos."
            ),
        }

    results = data.get("results") or []
    if not results:
        return {
            "found": False,
            "message": (
                "Nenhum documento relevante encontrado. Responda com info "
                "genérica e segura, sem inventar fatos específicos."
            ),
        }

    trechos = []
    for r in results:
        title = (r.get("title") or "").strip()
        content = (r.get("content") or "").strip()
        if title and content:
            trechos.append(f"{title}\n{content}")
        elif content:
            trechos.append(content)

    return {
        "found": True,
        "results": results,
        "context": "\n\n---\n\n".join(trechos),
    }
