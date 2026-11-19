import ast
import io
import logging
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import BaseModel

from backend.app.api.service import Service
from backend.app.knowledge.lookup import KnowledgeSearch
from backend.app.llm.client import LLMClient, LLMError
from backend.app.logs import make_handler, run_id_var

APP = Path(__file__).resolve().parents[1] / "app"


class Answer(BaseModel):
    a: int


def fake_client(*texts):
    replies = iter(texts)

    def create(**_):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=next(replies)))],
            usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3),
        )

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def test_llm_calls_are_logged_without_their_content(caplog):
    llm = LLMClient(model="m", client=fake_client('{"a": 1}'))
    with caplog.at_level(logging.INFO, logger="haggle"):
        llm.complete_json("SECRET-SYSTEM", "SECRET-USER", Answer, task="compose")
    assert "task=compose" in caplog.text and "ok=True" in caplog.text
    assert "SECRET" not in caplog.text


def test_an_invalid_reply_is_a_warning_and_never_quotes_the_reply(caplog):
    llm = LLMClient(model="m", client=fake_client("not json SECRET-REPLY", '{"a": 1}'))
    with caplog.at_level(logging.INFO, logger="haggle"):
        llm.complete_json("s", "u", Answer, task="compose")
    assert any(r.levelno == logging.WARNING for r in caplog.records)
    assert "SECRET-REPLY" not in caplog.text


def test_giving_up_is_logged_as_an_error(caplog):
    llm = LLMClient(model="m", client=fake_client("x", "y", "z"), max_retries=2)
    with caplog.at_level(logging.INFO, logger="haggle"), pytest.raises(LLMError):
        llm.complete_json("s", "u", Answer, task="compose")
    assert any(r.levelno == logging.ERROR for r in caplog.records)


def test_log_lines_carry_the_run_id():
    stream = io.StringIO()
    logger = logging.getLogger("haggle.test_run_id")
    handler = make_handler(stream)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    token = run_id_var.set("abcdef1234567890")
    try:
        logger.info("hello")
    finally:
        run_id_var.reset(token)
        logger.removeHandler(handler)
    assert "run=abcdef12 hello" in stream.getvalue()


class OneRun:
    def get(self, run_id):
        return {
            "asking": "9183.17",
            "budget": "4242.42",
            "mode": "simulate",
            "persona": "no-such-persona",
            "seed": 1,
            "style": "balanced",
        }


def test_a_failed_run_is_logged_with_where_and_without_private_values(caplog):
    service = Service(saver=None, calendar=None, runs=OneRun())
    with caplog.at_level(logging.INFO, logger="haggle"):
        service._drive("run1234567890", "start", None)
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    message = errors[0].getMessage()
    assert "run failed" in message and "service.py" in message
    assert "4242" not in caplog.text and "9183" not in caplog.text
    assert run_id_var.get() == "-"  # the context is restored after the run


def test_app_code_never_prints():
    offenders = []
    for path in APP.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "print"
            ):
                offenders.append(f"{path.relative_to(APP)}:{node.lineno}")
    assert not offenders, offenders


def test_a_knowledge_failure_is_logged_by_type_only(caplog):
    def broken():
        raise RuntimeError("SECRET-DSN postgresql://user:pw@host/db")

    search = KnowledgeSearch("postgresql://nobody", broken)
    with caplog.at_level(logging.WARNING, logger="haggle"):
        assert search("query", None) == []
    assert search.failures == 1
    assert "RuntimeError" in caplog.text
    assert "SECRET" not in caplog.text and "pw@host" not in caplog.text


def test_a_memory_failure_is_logged_and_counted(caplog):
    service = Service(saver=None, calendar=None, runs=None, memory=object())
    config = {
        "mode": "copilot",
        "profile_id": "p1",
        "autonomy": "approve_close",
        "asking": "1",
        "budget": "1",
    }
    with caplog.at_level(logging.WARNING, logger="haggle"):
        service._remember("run1", config)
    assert service.memory_failures == 1
    assert any("memory" in r.getMessage() for r in caplog.records)
