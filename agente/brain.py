"""Endpoints de IA via Vertex: split de documento e geração de embeddings.

Protegidos por Bearer token (settings.AGENT_API_TOKEN). Usados pelo CRM para
preparar a base de conhecimento e o systemPrompt do agente.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.genai import types
from pydantic import BaseModel

from clients.vertex_embed import embed_texts
from config import settings
from providers.gemini import get_vertex_client

logger = logging.getLogger(__name__)

router = APIRouter()

_bearer = HTTPBearer(auto_error=False)

_SPLIT_SYSTEM_INSTRUCTION = (
    "Você recebe um documento que mistura o comportamento de um agente de vendas "
    "(a Amanda, do Casal do Tráfego) e fatos do negócio. Separe em duas partes. Em "
    "systemPrompt coloque tudo sobre comportamento, personalidade, tom de voz, regras "
    "e fluxo de conversa, como um prompt de sistema único e coeso. Em knowledge coloque "
    "os fatos consultáveis (serviços, preços, objeções, FAQ, cases, diferenciais), cada "
    "um como um item com title curto e content autocontido. Não invente informação e "
    "não resuma a ponto de perder dados. Responda em português. Preserve integralmente "
    "a acentuação do português no systemPrompt e em cada fato; nunca remova acentos."
)

_SPLIT_SCHEMA = {
    "type": "object",
    "properties": {
        "systemPrompt": {"type": "string"},
        "knowledge": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["title", "content"],
            },
        },
    },
    "required": ["systemPrompt", "knowledge"],
}


def _require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    if not settings.AGENT_API_TOKEN:
        raise HTTPException(status_code=401, detail="token não configurado")
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="credenciais ausentes")
    if credentials.credentials != settings.AGENT_API_TOKEN:
        raise HTTPException(status_code=401, detail="token inválido")


class SplitRequest(BaseModel):
    text: str


class KnowledgeItem(BaseModel):
    title: str
    content: str


class SplitResponse(BaseModel):
    systemPrompt: str
    knowledge: list[KnowledgeItem]


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


async def _run_split(client, model: str, text: str) -> dict:
    resp = await client.aio.models.generate_content(
        model=model,
        contents=text,
        config=types.GenerateContentConfig(
            system_instruction=_SPLIT_SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=_SPLIT_SCHEMA,
            temperature=0.2,
            max_output_tokens=8192,
        ),
    )
    raw = (resp.text or "").strip()
    if not raw:
        raise ValueError("resposta vazia do modelo")
    try:
        data = json.loads(raw)
    except Exception as exc:
        raise ValueError(f"JSON inválido do modelo {model}: raw={raw[:200]!r}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"JSON não é um objeto: raw={raw[:200]!r}")
    return data


@router.post("/brain/split", response_model=SplitResponse)
async def split(body: SplitRequest, _: None = Depends(_require_auth)) -> SplitResponse:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text vazio")

    try:
        client = get_vertex_client()
    except Exception as exc:
        logger.error("brain split: client Vertex indisponível: %s", exc)
        raise HTTPException(status_code=500, detail="Vertex indisponível")

    data: dict | None = None
    try:
        data = await _run_split(client, "gemini-2.5-flash", body.text)
    except Exception as exc:
        logger.warning("brain split flash falhou, tentando pro: %s", exc)
        try:
            data = await _run_split(client, "gemini-2.5-pro", body.text)
        except Exception as exc2:
            logger.error("brain split pro falhou: %s", exc2, exc_info=True)
            raise HTTPException(status_code=500, detail="falha ao separar documento")

    try:
        return SplitResponse(**data)
    except Exception as exc:
        logger.error("brain split shape invalido: %s", exc)
        raise HTTPException(status_code=500, detail="resposta fora do formato")


@router.post("/embed", response_model=EmbedResponse)
async def embed(body: EmbedRequest, _: None = Depends(_require_auth)) -> EmbedResponse:
    if len(body.texts) > 64:
        raise HTTPException(status_code=400, detail="máximo de 64 textos por requisição")

    try:
        embeddings = await embed_texts(body.texts)
    except Exception as exc:
        logger.error("embed falhou: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="falha ao gerar embeddings")

    return EmbedResponse(embeddings=embeddings)
