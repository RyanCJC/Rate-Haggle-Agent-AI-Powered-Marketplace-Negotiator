from decimal import Decimal

from backend.app.core.models import NegotiationContext
from backend.app.core.strategy import StrategyDecision
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.knowledge.grounding import ungrounded_claims
from backend.app.llm.fake import RuleBasedLLM
from backend.app.llm.tasks import build_compose_prompt
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller


def fact(key, value, status="claimed"):
    return {"key": key, "value": value, "status": status, "source": "listing", "evidence": None}


def keys(text, facts):
    return [c.key for c in ungrounded_claims(text, facts)]


def test_a_supported_detail_passes():
    facts = [fact("refresh_rate", "144")]
    assert keys("Since it has 144Hz, how about RM 900?", facts) == []


def test_an_invented_defect_is_caught_when_no_fact_mentions_it():
    assert keys("It has dead pixels so RM 900.", [fact("warranty", "none", "missing")]) == ["defects"]


def test_a_question_is_not_a_claim():
    assert keys("Does it have any scratches?", []) == []


def test_opposites_do_not_match():
    facts = [fact("defects", "no scratches")]
    assert keys("There are scratches on it.", facts) == ["defects"]
    assert keys("No scratches, good. RM 900.", facts) == []


def test_a_wrong_number_is_caught_and_a_shorter_phrasing_is_allowed():
    assert keys("A 144Hz panel is worth more.", [fact("refresh_rate", "60")]) == ["refresh_rate"]
    warranty = [fact("warranty", "6 months warranty left")]
    assert keys("With 6 months warranty I can do RM 900.", warranty) == []


def test_conflicting_values_are_both_known():
    facts = [fact("warranty", "6 months warranty / 3 months warranty", "conflicting")]
    assert keys("With 3 months warranty I can do RM 900.", facts) == []


def test_asking_for_accessories_is_never_flagged():
    assert keys("Please include the box and charger.", []) == []


def test_the_prompt_words_facts_by_status_and_lists_unknowns():
    facts = [
        fact("refresh_rate", "144", "confirmed"),
        fact("warranty", "6 months", "claimed"),
        fact("defects", "no scratches / scratches", "conflicting"),
        fact("age", None, "missing"),
    ]
    ctx = NegotiationContext(max_budget=Decimal(1000), asking_price=Decimal(1200))
    decision = StrategyDecision(kind="offer", price=Decimal(900), reason="x")
    _, user = build_compose_prompt(decision, ctx, [], "balanced", False, "", facts)
    assert "Known facts about the item" in user
    assert "confirmed by more than one source" in user
    assert "the listing says" in user
    assert "sources disagree" in user
    assert "Unknown (never claim these" in user and "age" in user


def test_the_prompt_has_no_facts_section_without_facts():
    ctx = NegotiationContext(max_budget=Decimal(1000), asking_price=Decimal(1200))
    decision = StrategyDecision(kind="offer", price=Decimal(900), reason="x")
    _, user = build_compose_prompt(decision, ctx, [], "balanced", False, "")
    assert "Known facts" not in user


class InventsDefects(RuleBasedLLM):
    """A composer that always adds an invented flaw to push the price down."""

    def complete_json(self, system, user, schema, task=""):
        reply = super().complete_json(system, user, schema, task)
        if task == "compose":
            return schema.model_validate({"message": reply.message + " The scratches on it worry me."})
        return reply


LISTING = {
    "id": "1",
    "title": "Monitor",
    "category": "monitors",
    "asking_price": "1200",
    "description": "27 inch 144Hz, 6 months warranty left, no scratches",
}


def run(ground):
    port = SimSellerPort(SimSeller(Decimal(1200), get_persona("flexible"), seed=0))
    graph = build_graph(InventsDefects(), port, ground=ground)
    return run_graph(graph, Decimal(1200), Decimal(1000), listing=LISTING), port


def test_without_grounding_the_invented_flaw_goes_out():
    _, port = run(ground=False)
    assert any("scratches" in message for _, message in port.sent)


def test_with_grounding_the_invented_flaw_is_blocked_and_replaced_by_a_template():
    final, port = run(ground=True)
    assert all("scratch" not in message.lower() for _, message in port.sent)
    codes = [c for t in final["trace"] if t["node"] == "validate" for c in t["codes"]]
    assert "ungrounded_claim" in codes
    assert any(t["node"] == "fallback" for t in final["trace"])