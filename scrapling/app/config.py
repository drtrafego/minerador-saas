from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SCRAPLING_", env_file=".env", extra="ignore")

    shared_secret: str = ""
    log_level: str = "info"
    headless: bool = True
    max_concurrency: int = 2
    default_timeout_ms: int = 120_000
    ig_session_cookie: str = ""


settings = Settings()
