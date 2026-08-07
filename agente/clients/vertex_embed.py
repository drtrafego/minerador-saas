"""Geracao de embeddings via Vertex AI (gemini-embedding-001, 768 dims)."""
import asyncio
import logging

from google.genai import types

from providers.gemini import get_vertex_client

logger = logging.getLogger(__name__)

EMBED_MODEL = "gemini-embedding-001"
EMBED_DIMS = 768

_client = None


def _get_client():
    """Singleton do client Vertex para nao reparsear a service account a cada gather."""
    global _client
    if _client is None:
        _client = get_vertex_client()
    return _client


async def _embed_one(client, text: str) -> list[float]:
    resp = await client.aio.models.embed_content(
        model=EMBED_MODEL,
        contents=text,
        config=types.EmbedContentConfig(output_dimensionality=EMBED_DIMS),
    )
    if not resp.embeddings:
        raise ValueError("Vertex retornou resposta sem embeddings")
    values = resp.embeddings[0].values
    if not values:
        raise ValueError("Vertex retornou embedding com values vazio")
    if len(values) != EMBED_DIMS:
        raise ValueError(
            f"Embedding com dimensao errada: esperado {EMBED_DIMS}, recebido {len(values)}"
        )
    return list(values)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Gera embedding de cada texto (Vertex aceita 1 conteudo por chamada)."""
    if not texts:
        return []
    client = _get_client()
    return await asyncio.gather(*[_embed_one(client, t) for t in texts])
