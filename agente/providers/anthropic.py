"""Provider Claude (Anthropic) com prompt caching habilitado."""
import logging

from anthropic import AsyncAnthropic

from config import settings

logger = logging.getLogger(__name__)


class AnthropicProvider:
    def __init__(self, model: str):
        self.model = model
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.instruction: str = ""
        self.tools: list[dict] = []

    def bind(self, instruction: str, tools: list[dict]) -> "AnthropicProvider":
        self.instruction = instruction
        self.tools = tools
        return self

    async def generate(self, messages: list[dict]) -> dict:
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=[
                    {
                        "type": "text",
                        "text": self.instruction,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=self.tools,
                messages=messages,
            )
        except Exception as exc:
            logger.error("anthropic generate erro: %s", exc, exc_info=True)
            return {"text": "", "tool_calls": [], "stop_reason": "error"}

        text = ""
        tool_calls: list[dict] = []
        for block in response.content:
            if block.type == "text":
                text += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    {
                        "id": block.id,
                        "name": block.name,
                        "args": block.input if isinstance(block.input, dict) else {},
                    }
                )

        return {
            "text": text.strip(),
            "tool_calls": tool_calls,
            "stop_reason": response.stop_reason,
        }
