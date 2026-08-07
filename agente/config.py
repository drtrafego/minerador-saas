"""Configuracoes do agente SDR via pydantic-settings."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_BASE_DIR = Path(__file__).resolve().parent
_ROOT_ENV = _BASE_DIR.parent / ".env"
_LOCAL_ENV = _BASE_DIR / ".env"


class Settings(BaseSettings):
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""

    # Provider de LLM. Vazio = autodetecta pelo prefixo do LLM_MODEL
    # (claude*/gemini*) ou pela presenca de "/" (OpenRouter). Valores
    # explicitos: "openrouter" | "anthropic" | "gemini".
    LLM_PROVIDER: str = ""
    LLM_MODEL: str = "gemini-2.5-pro"

    # OpenRouter: API compativel com OpenAI, da acesso a varios modelos por
    # uma chave. Modelo no formato "vendor/modelo", ex "anthropic/claude-3.5-sonnet".
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_APP_URL: str = "https://seu-dominio.com"

    # Gemini via Vertex AI (Google Cloud). Quando ha service account,
    # usa Vertex por padrao em vez da API do AI Studio (generativelanguage).
    GEMINI_USE_VERTEX: bool = True
    GEMINI_LOCATION: str = "us-central1"

    CRM_BASE_URL: str = "http://localhost:3000"
    CRM_API_TOKEN: str = ""

    AGENT_API_TOKEN: str = ""

    REDIS_URL: str = "redis://localhost:6379/0"
    SESSION_TTL_SECONDS: int = 86_400
    DEBOUNCE_SECONDS: int = 5

    # Meta WhatsApp Cloud API oficial
    META_ACCESS_TOKEN: str = ""
    META_PHONE_NUMBER_ID: str = ""
    META_VERIFY_TOKEN: str = ""
    META_APP_SECRET: str = ""
    META_WABA_ID: str = ""
    META_GRAPH_VERSION: str = "v25.0"

    # deprecated, mantido por compatibilidade com configuracoes legadas UZApi
    UZAPI_WEBHOOK_SECRET: str = ""

    GOOGLE_CALENDAR_ID: str = "primary"
    GOOGLE_SERVICE_ACCOUNT_JSON: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REFRESH_TOKEN: str = ""

    TRANSCREVER_API_URL: str = "https://api.transcrever.seu-dominio.com"

    APP_ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    PORT: int = 8000

    model_config = SettingsConfigDict(
        env_file=(str(_ROOT_ENV), str(_LOCAL_ENV)),
        extra="ignore",
    )


settings = Settings()
