from decimal import Decimal
from types import SimpleNamespace

import pytest

from backend.app.core.models import NegotiationContext
from backend.app.core.strategy import StrategyDecision
from backend.app.llm.client import LLMClient, LLMError, extract_json
from backend.app.llm.tasks import (
    Draft,
    build_compose_prompt,
    compose_message,
    extract_seller_intent,
)


def fake_openai(replies, seen=None):
    """A stand-in for the OpenAI SDK that returns scripted replies. No network."""
    queue = iter(replies)

    def create(**kwargs):
        if seen is not None:
            seen.append(kwargs)
        text = next(queue)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=text))],
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
        )

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def make_llm(replies, seen=None, retries=2):
    return LLMClient(model="fake", client=fake_openai(replies, seen), max_retries=retries)


def test_extract_json_handles_fences_and_chatter():
    assert extract_json('Sure!\n```json\n{"a": 1}\n```\nHope that helps') == {"a": 1}


def test_extract_json_rejects_text_without_json():
    with pytest.raises(ValueError):
        extract_json("no braces here")


def test_retries_after_invalid_json_then_succeeds():
    llm = make_llm(["not json at all", '{"message": "Hi, would RM 800 work?"}'])
    draft = llm.complete_json("sys", "user", Draft, task="compose")
    assert draft.message.startswith("Hi")
    assert [c.ok for c in llm.calls] == [False, True]


def test_schema_violation_triggers_retry():
    llm = make_llm(['{"message": ""}', '{"message": "ok"}'])
    assert llm.complete_json("sys", "user", Draft).message == "ok"


def test_raises_after_retries_are_exhausted():
    llm = make_llm(["bad", "bad", "bad"])
    with pytest.raises(LLMError):
        llm.complete_json("sys", "user", Draft, task="compose")
    assert len(llm.calls) == 3


def test_system_prompt_asks_for_json_and_includes_schema():
    seen = []
    make_llm(['{"message": "ok"}'], seen).complete_json("sys", "user", Draft)
    system = seen[0]["messages"][0]["content"]
    assert "JSON" in system and "message" in system
    assert seen[0]["response_format"] == {"type": "json_object"}


def test_extract_seller_intent_parses_price_and_flags():
    reply = '{"price": 1069, "accepted": false, "asks_budget": true}'
    intent = extract_seller_intent(make_llm([reply]), "Boleh lah, RM 1,069 last price. Budget?")
    assert intent.price == Decimal(1069)
    assert intent.asks_budget and not intent.accepted


def test_compose_message_returns_the_draft():
    ctx = NegotiationContext(max_budget=Decimal(900), asking_price=Decimal(1200))
    decision = StrategyDecision(kind="offer", price=Decimal(800))
    draft = compose_message(make_llm(['{"message": "How about RM 800?"}']), decision, ctx, [])
    assert "800" in draft.message


def test_prompts_never_contain_private_numbers():
    ctx = NegotiationContext(
        max_budget=Decimal("987.65"),
        asking_price=Decimal(1200),
        current_offer=Decimal(740),
        seller_last_price=Decimal(1100),
    )
    decision = StrategyDecision(
        kind="offer", price=Decimal(800), reason="limit 873.00 target 842.95"
    )
    system, user = build_compose_prompt(decision, ctx, [("seller", "RM 1100 lah. Budget?")])
    text = system + user
    for secret in ("987", "873", "842.95", "max_budget"):
        assert secret not in text
    assert "RM 800" in text


def test_extraction_prompt_includes_the_buyers_last_offer():
    seen = []
    llm = make_llm(['{"price": 963}'], seen)
    extract_seller_intent(llm, "Boleh lah, RM 963 last price bro.", Decimal(820))
    assert "Buyer's last offer: RM 820" in seen[0]["messages"][1]["content"]