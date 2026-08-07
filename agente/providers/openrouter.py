"""Provider OpenRouter (API compativel com OpenAI) com function calling.

OpenRouter expoe uma API no formato da OpenAI, dando acesso a varios modelos
(anthropic/*, openai/*, google/*, etc) por uma unica chave. O modelo vem em
LLM_MODEL como "vendor/modelo", ex "anthropic/claude-3.5-sonnet".

Mantem a mesma interface dos outros providers (bind/generate) e o mesmo
contrato de retorno {text, tool_calls, stop_reason}, convertendo o formato
interno de mensagens (estilo Anthropic, com blocks tool_use/tool_result) para
o formato de chat da OpenAI e de volta.
"""
import asyncio
import json
import logging

from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

_RETRY_DELAYS = (0.6, 1.5)
_TRANSIENT_CODES = {429, 500, 502, 503, 504}
_TRANSIENT_NAMES = (
    "APITimeoutError",
    "InternalServerError",
    "RateLimitError",
    "APIConnectionError",
)


def _is_transient(exc: Exception) -> bool:
    """True para 429/5xx/timeouts (vale retry), False para 4xx permanente."""
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(code, int):
        if code in _TRANSIENT_CODES:
            return True
        if 400 <= code < 500:
            return False
    name = type(exc).__name__
    return any(token in name for token in _TRANSIENT_NAMES)


class OpenRouterProvider:
    def __init__(self, model: str):
        self.model = model
        self.client = AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url=settings.OPENROUTER_BASE_URL,
            default_headers={
                # Recomendado pelo OpenRouter para atribuicao/ranking.
                "HTTP-Referer": settings.OPENROUTER_APP_URL,
                "X-Title": "Minerador Claude SDR",
            },
        )
        self.instruction: str = ""
        self.tools: list[dict] = []

    def bind(self, instruction: str, tools: list[dict]) -> "OpenRouterProvider":
        self.instruction = instruction
        self.tools = tools
        return self

    def _to_openai_tools(self) -> list[dict]:
        out: list[dict] = []
        for t in self.tools:
            out.append(
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t.get(
                            "input_schema", {"type": "object", "properties": {}}
                        ),
                    },
                }
            )
        return out

    def _to_openai_messages(self, messages: list[dict]) -> list[dict]:
        out: list[dict] = []
        if self.instruction:
            out.append({"role": "system", "content": self.instruction})

        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")

            if isinstance(content, str):
                if content:
                    out.append({"role": role, "content": content})
                continue

            # content e lista de blocks (estilo Anthropic)
            if role == "assistant":
                text_parts: list[str] = []
                tool_calls: list[dict] = []
                for block in content:
                    bt = block.get("type")
                    if bt == "text" and block.get("text"):
                        text_parts.append(block["text"])
                    elif bt == "tool_use":
                        tool_calls.append(
                            {
                                "id": block["id"],
                                "type": "function",
                                "function": {
                                    "name": block["name"],
                                    "arguments": json.dumps(
                                        block.get("input", {}), ensure_ascii=False
                                    ),
                                },
                            }
                        )
                m: dict = {"role": "assistant", "content": "".join(text_parts) or None}
                if tool_calls:
                    m["tool_calls"] = tool_calls
                out.append(m)
            else:
                # user com tool_result e/ou texto
                for block in content:
                    bt = block.get("type")
                    if bt == "tool_result":
                        raw = block.get("content", "{}")
                        text = raw if isinstance(raw, str) else json.dumps(
                            raw, ensure_ascii=False
                        )
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": block["tool_use_id"],
                                "content": text,
                            }
                        )
                    elif bt == "text" and block.get("text"):
                        out.append({"role": "user", "content": block["text"]})
        return out

    async def generate(self, messages: list[dict]) -> dict:
        payload_messages = self._to_openai_messages(messages)
        tools = self._to_openai_tools() or None

        total_attempts = len(_RETRY_DELAYS) + 1
        response = None
        for attempt in range(1, total_attempts + 1):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=payload_messages,
                    tools=tools,
                    max_tokens=1024,
                    temperature=0.7,
                )
                break
            except Exception as exc:
                transient = _is_transient(exc)
                if transient and attempt < total_attempts:
                    delay = _RETRY_DELAYS[attempt - 1]
                    logger.warning(
                        "openrouter generate falhou (tentativa %s/%s, retry %ss): %s",
                        attempt,
                        total_attempts,
                        delay,
                        exc,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error("openrouter generate erro: %s", exc, exc_info=True)
                return {"text": "", "tool_calls": [], "stop_reason": "error"}

        choice = response.choices[0]
        message = choice.message
        text = (message.content or "").strip()

        tool_calls: list[dict] = []
        for tc in message.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            tool_calls.append(
                {
                    "id": tc.id,
                    "name": tc.function.name,
                    "args": args if isinstance(args, dict) else {},
                }
            )

        return {
            "text": text,
            "tool_calls": tool_calls,
            "stop_reason": choice.finish_reason or "stop",
        }
