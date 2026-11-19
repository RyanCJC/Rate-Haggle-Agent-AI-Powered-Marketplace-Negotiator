import os
import re
from pathlib import Path

import pytest

from backend.app.settings import DEFAULT_CORS, DEFAULT_EMBED_MODEL, Settings

# The test suite must never call a real LLM: it burns quota and makes runs slow and flaky.
os.environ["HAGGLE_LLM"] = "offline"

APP = Path(__file__).resolve().parents[1] / "app"
# The calendar runs in its own process with a deliberately minimal environment.
ALLOWED = {"settings.py", "boundaries/calendar_server.py"}
READS = re.compile(r"\bos\.(environ|getenv)\b")


def test_defaults_without_any_environment():
    s = Settings.from_env({})
    assert s.llm_mode == "live"
    assert s.embed_model == DEFAULT_EMBED_MODEL
    assert s.cors_origins == DEFAULT_CORS
    assert s.database_url is None and s.llm_base_url is None
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        s.require_database_url()


def test_offline_mode_only_for_the_exact_word():
    assert Settings.from_env({"HAGGLE_LLM": "offline"}).llm_mode == "offline"
    for other in ("", "Offline", "true", "live"):
        assert Settings.from_env({"HAGGLE_LLM": other}).llm_mode == "live"


def test_the_test_suite_never_uses_the_live_model():
    assert Settings.from_env().llm_mode == "offline"  # set by backend/tests/conftest.py

def test_cors_origins_are_split_and_trimmed():
    s = Settings.from_env({"CORS_ORIGINS": "http://a.test, http://b.test ,"})
    assert s.cors_origins == ("http://a.test", "http://b.test")
    assert Settings.from_env({"CORS_ORIGINS": " , "}).cors_origins == DEFAULT_CORS


def test_model_settings_are_read():
    s = Settings.from_env(
        {"LLM_MODEL": "m", "LLM_BASE_URL": "http://llm.test/v1", "EMBED_MODEL": "e"}
    )
    assert (s.llm_model, s.llm_base_url, s.embed_model) == ("m", "http://llm.test/v1", "e")


def test_secrets_never_appear_in_repr():
    s = Settings.from_env(
        {"DATABASE_URL": "postgresql://user:hunter2@host/db", "LLM_API_KEY": "sk-secret-key"}
    )
    text = repr(s) + str(s)
    assert "hunter2" not in text and "sk-secret-key" not in text
    assert s.require_database_url().endswith("@host/db")


def test_the_app_reads_the_environment_only_in_the_settings_file():
    offenders = []
    for path in APP.rglob("*.py"):
        relative = path.relative_to(APP).as_posix()
        if relative not in ALLOWED and READS.search(path.read_text(encoding="utf-8")):
            offenders.append(relative)
    assert offenders == []


def test_log_level_defaults_and_ignores_garbage():
    assert Settings.from_env({}).log_level == "INFO"
    assert Settings.from_env({"LOG_LEVEL": "debug"}).log_level == "DEBUG"
    assert Settings.from_env({"LOG_LEVEL": "nonsense"}).log_level == "INFO"