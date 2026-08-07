"""Provider Gemini 2.5 Pro com function calling.

Usa Vertex AI (Google Cloud) quando ha service account configurado, com
fallback para a API do AI Studio (generativelanguage) via api_key.
"""
import asyncio
import json
import logging
from typing import Any

from google import genai
from google.genai import types

from config import settings

logger = logging.getLogger(__name__)

_RETRY_DELAYS = (0.6, 1.5)
_TRANSIENT_CODES = {429, 500, 502, 503, 504}
_TRANSIENT_NAMES = (
    "ServerError",
    "ServiceUnavailable",
    "DeadlineExceeded",
    "ResourceExhausted",
    "Timeout",
    "Unavailable",
)


def _is_transient(exc: Exception) -> bool:
    """Decide se vale re-tentar: True para timeouts/5xx/429, False para 4xx permanente."""
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(code, int):
        if code in _TRANSIENT_CODES:
            return True
        if 400 <= code < 500:
            return False
    name = type(exc).__name__
    if any(token in name for token in _TRANSIENT_NAMES):
        return True
    msg = str(exc).upper()
    if "RESOURCE_EXHAUSTED" in msg or "DEADLINE_EXCEEDED" in msg or "UNAVAILABLE" in msg:
        return True
    if "INVALID_ARGUMENT" in msg or "PERMISSION_DENIED" in msg or "UNAUTHENTICATED" in msg:
        return False
    if "TIMEOUT" in msg or "TIMED OUT" in msg:
        return True
    return False


def get_vertex_client() -> genai.Client:
    """Cria um client Gemini no modo Vertex AI a partir do service account.

    Exige GEMINI_USE_VERTEX ativo e GOOGLE_SERVICE_ACCOUNT_JSON setado. Levanta
    RuntimeError caso contrario, pois os endpoints que dependem disso (brain,
    embed) so funcionam via Vertex.
    """
    sa_json = settings.GOOGLE_SERVICE_ACCOUNT_JSON
    if not settings.GEMINI_USE_VERTEX or not sa_json:
        raise RuntimeError(
            "Vertex AI nao configurado: defina GEMINI_USE_VERTEX=True e "
            "GOOGLE_SERVICE_ACCOUNT_JSON com o service account do GCP."
        )

    from google.oauth2 import service_account

    info = json.loads(sa_json)
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    client = genai.Client(
        vertexai=True,
        project=info["project_id"],
        location=settings.GEMINI_LOCATION or "us-central1",
        credentials=creds,
    )
    logger.info(
        "gemini provider: modo Vertex AI (project=%s location=%s)",
        info["project_id"],
        settings.GEMINI_LOCATION or "us-central1",
    )
    return client


def _build_client() -> genai.Client:
    """Cria o client Gemini, preferindo Vertex AI quando ha service account.

    Vertex precisa de billing ativo no GCP e roda gemini-2.5-pro. A API do
    AI Studio (api_key) fica como fallback caso nao haja service account.
    """
    if settings.GEMINI_USE_VERTEX and settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        return get_vertex_client()

    logger.info("gemini provider: modo AI Studio (api_key)")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


class GeminiProvider:
    def __init__(self, model: str):
        self.model = model
        self.client = _build_client()
        self.instruction: str = ""
        self.tools: list[dict] = []

    def bind(self, instruction: str, tools: list[dict]) -> "GeminiProvider":
        self.instruction = instruction
        self.tools = tools
        return self

    def _content_to_parts(self, content: Any) -> list[types.Part]:
        if isinstance(content, str):
            return [types.Part.from_text(text=content)] if content else []

        parts: list[types.Part] = []
        for block in content:
            t = block.get("type")
            if t == "text" and block.get("text"):
                parts.append(types.Part.from_text(text=block["text"]))
            elif t == "tool_use":
                args = block.get("input", {}) or {}
                parts.append(types.Part.from_function_call(
                    name=block["name"],
                    args=args if isinstance(args, dict) else {"value": args},
                ))
            elif t == "tool_result":
                raw = block.get("content", "{}")
                if isinstance(raw, str):
                    try:
                        response_data = json.loads(raw)
                    except Exception:
                        response_data = {"result": raw}
                else:
                    response_data = raw
                if not isinstance(response_data, dict):
                    response_data = {"value": response_data}
                parts.append(types.Part.from_function_response(
                    name=block.get("tool_name") or "unknown_tool",
                    response=response_data,
                ))
        return parts

    def _to_gemini_contents(self, messages: list[dict]) -> list[types.Content]:
        contents: list[types.Content] = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            parts = self._content_to_parts(msg.get("content", ""))
            if parts:
                contents.append(types.Content(role=role, parts=parts))
        return contents

    def _to_gemini_tools(self) -> list[types.Tool]:
        declarations: list[types.FunctionDeclaration] = []
        for t in self.tools:
            declarations.append(types.FunctionDeclaration(
                name=t["name"],
                description=t.get("description", ""),
                parameters=t.get("input_schema", {"type": "object", "properties": {}}),
            ))
        return [types.Tool(function_declarations=declarations)] if declarations else []

    async def generate(self, messages: list[dict]) -> dict:
        contents = self._to_gemini_contents(messages)
        config = types.GenerateContentConfig(
            system_instruction=self.instruction or None,
            tools=self._to_gemini_tools() or None,
            max_output_tokens=8192,
            temperature=0.7,
        )

        total_attempts = len(_RETRY_DELAYS) + 1
        response = None
        for attempt in range(1, total_attempts + 1):
            try:
                response = await self.client.aio.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=config,
                )
                break
            except Exception as exc:
                transient = _is_transient(exc)
                if transient and attempt < total_attempts:
                    delay = _RETRY_DELAYS[attempt - 1]
                    logger.warning(
                        "gemini generate falhou (tentativa %s/%s, transitorio, "
                        "retry em %ss): %s",
                        attempt,
                        total_attempts,
                        delay,
                        exc,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error(
                    "gemini generate erro (tentativa %s/%s, transitorio=%s): %s",
                    attempt,
                    total_attempts,
                    transient,
                    exc,
                    exc_info=True,
                )
                return {"text": "", "tool_calls": [], "stop_reason": "error"}

        text = ""
        tool_calls: list[dict] = []
        stop_reason = "STOP"

        if response.candidates:
            candidate = response.candidates[0]
            if candidate.finish_reason:
                stop_reason = candidate.finish_reason.name
            if candidate.content and candidate.content.parts:
                for idx, part in enumerate(candidate.content.parts):
                    if getattr(part, "text", None):
                        text += part.text
                    fc = getattr(part, "function_call", None)
                    if fc and fc.name:
                        tool_calls.append({
                            "id": f"gemini_call_{fc.name}_{idx}",
                            "name": fc.name,
                            "args": dict(fc.args) if fc.args else {},
                        })

        text = text.strip()

        if stop_reason not in ("STOP", "MAX_TOKENS") and not text and not tool_calls:
            logger.warning(
                "gemini generate sem saida util, finish_reason=%s (sem text e sem "
                "tool_calls); runner cai no fallback",
                stop_reason,
            )

        return {
            "text": text,
            "tool_calls": tool_calls,
            "stop_reason": stop_reason,
        }

    async def transcribe_audio(self, audio_bytes: bytes, mime_type: str) -> str:
        """Transcreve audio com Gemini multimodal, modelo flash por custo."""
        try:
            response = await self.client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                    types.Part.from_text(
                        text=(
                            "Transcreva este audio em portugues do Brasil. "
                            "Retorne APENAS o texto transcrito, sem comentarios."
                        ),
                    ),
                ],
                config=types.GenerateContentConfig(
                    max_output_tokens=2048,
                    temperature=0.0,
                ),
            )
        except Exception as exc:
            logger.error("gemini transcribe erro: %s", exc, exc_info=True)
            return ""

        if not response.candidates:
            return ""
        candidate = response.candidates[0]
        if not candidate.content or not candidate.content.parts:
            return ""
        out = ""
        for part in candidate.content.parts:
            if getattr(part, "text", None):
                out += part.text
        return out.strip()
