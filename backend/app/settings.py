import os
from collections.abc import Mapping
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field

DEFAULT_CORS = ("http://localhost:5173",)
DEFAULT_EMBED_MODEL = "BAAI/bge-small-en-v1.5"

LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")


def _log_level(value: str | None) -> str:
    level = (value or "").strip().upper()
    return level if level in LOG_LEVELS else "INFO"

class Settings(BaseModel):
    """Every environment variable the app reads, in one place. Secrets stay out of repr."""

    database_url: str | None = Field(default=None, repr=False)
    llm_mode: Literal["offline", "live"] = "live"        # Offline means using deterministic logics without llm
    llm_model: str = ""
    llm_base_url: str | None = None
    llm_api_key: str = Field(default="", repr=False)
    llm_timeout_s: float = 45.0          # per-call timeout for every LLM request
    llm_max_retries: int = 3             # retries on transient failures only
    embed_model: str = DEFAULT_EMBED_MODEL
    log_level: str = "INFO"
    cors_origins: tuple[str, ...] = DEFAULT_CORS
    marketplace_channel: bool = False

    def require_database_url(self) -> str:
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is not set: copy .env.example to .env and fill it in")
        return self.database_url

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        """Read the process environment (or the mapping given). Never loads a .env file."""
        env = os.environ if env is None else env
        origins = tuple(o.strip() for o in env.get("CORS_ORIGINS", "").split(",") if o.strip())
        return cls(
            database_url=env.get("DATABASE_URL") or None,
            llm_mode="offline" if env.get("HAGGLE_LLM") == "offline" else "live",
            llm_model=env.get("LLM_MODEL", ""),
            llm_base_url=env.get("LLM_BASE_URL") or None,
            llm_api_key=env.get("LLM_API_KEY", ""),
            llm_timeout_s=_parse_float(env.get("LLM_TIMEOUT_S"), 45.0),
            llm_max_retries=_parse_int(env.get("LLM_MAX_RETRIES"), 3),
            embed_model=env.get("EMBED_MODEL") or DEFAULT_EMBED_MODEL,
            log_level=_log_level(env.get("LOG_LEVEL")),
            cors_origins=origins or DEFAULT_CORS,
            marketplace_channel=env.get("MARKETPLACE_CHANNEL") == "on",
        )

    @classmethod
    def load(cls) -> "Settings":
        """For the server and scripts: read .env first (it never overrides real variables)."""
        load_dotenv()
        return cls.from_env()


def _parse_float(value: str | None, default: float) -> float:
    if value is None or not value.strip():
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _parse_int(value: str | None, default: int) -> int:
    if value is None or not value.strip():
        return default
    try:
        return int(value)
    except ValueError:
        return default