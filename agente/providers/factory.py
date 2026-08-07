"""Factory de providers de LLM.

Seleciona o provider por LLM_PROVIDER explicito (settings) ou, quando vazio,
autodetecta pelo formato do modelo: prefixo claude*/gemini*, ou "vendor/modelo"
(presenca de "/") como OpenRouter.
"""
from config import settings


def get_provider(model: str, provider: str | None = None):
    p = (provider or settings.LLM_PROVIDER or "").lower()

    if p == "openrouter":
        from .openrouter import OpenRouterProvider
        return OpenRouterProvider(model)
    if p == "anthropic" or (not p and model.startswith("claude")):
        from .anthropic import AnthropicProvider
        return AnthropicProvider(model)
    if p == "gemini" or (not p and model.startswith("gemini")):
        from .gemini import GeminiProvider
        return GeminiProvider(model)

    # Sem provider explicito e modelo no formato "vendor/modelo": OpenRouter.
    if not p and "/" in model:
        from .openrouter import OpenRouterProvider
        return OpenRouterProvider(model)

    raise ValueError(f"Provider/modelo nao suportado: provider={p!r} model={model!r}")
