from decimal import Decimal

import pytest

from backend.app.core.models import NegotiationContext
from backend.app.core.outbound import check_outbound
from backend.app.core.strategy import STYLES
from backend.app.evaluation.policies import haggle_policy
from backend.app.evaluation.runner import run_negotiation
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.client import LLMError
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import DEV_PERSONAS, get_persona
from backend.app.sim.seller import SimSeller

ASKING = Decimal(1200)


def run(llm, persona, budget, seed=0):
    seller = SimSeller(ASKING, persona, seed=seed)
    port = SimSellerPort(seller)
    final = run_graph(build_graph(llm, port), ASKING, Decimal(budget))
    return final, port, seller


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
@pytest.mark.parametrize("budget", [900, 1000, 1200])
@pytest.mark.parametrize("seed", [0, 1])
def test_graph_with_a_perfect_llm_matches_the_stage_2_harness(persona, budget, seed):
    final, _, _ = run(RuleBasedLLM(), persona, budget, seed)
    expected = run_negotiation(
        persona, "x", haggle_policy(STYLES["balanced"]), ASKING, Decimal(budget), seed
    )
    assert final["outcome"] == expected.outcome
    assert final["final_price"] == expected.price


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
def test_graph_never_exceeds_budget_or_leaks(persona):
    budget = Decimal(1000)
    final, port, seller = run(RuleBasedLLM(), persona, budget)
    if final["final_price"] is not None:
        assert final["final_price"] <= budget
        assert final["final_price"] >= seller.reservation
    ctx = NegotiationContext(max_budget=budget, asking_price=ASKING)
    for price, message in port.sent:
        assert check_outbound(message, ctx, ceiling=price) == []
        assert price <= budget


class LeakThenFix(RuleBasedLLM):
    """First draft leaks the budget; after the rejection it behaves."""

    def complete_json(self, system, user, schema, task=""):
        if task == "compose" and "rejected" not in user:
            msg = {"message": "My max budget is RM 900, so how about RM 700?"}
            return schema.model_validate(msg)
        return super().complete_json(system, user, schema, task)


class AlwaysLeaks(RuleBasedLLM):
    def complete_json(self, system, user, schema, task=""):
        if task == "compose":
            return schema.model_validate({"message": "My max budget is RM 900, deal?"})
        return super().complete_json(system, user, schema, task)


class ComposeFails(RuleBasedLLM):
    def complete_json(self, system, user, schema, task=""):
        if task == "compose":
            raise LLMError("provider down")
        return super().complete_json(system, user, schema, task)


class BadExtraction(RuleBasedLLM):
    def complete_json(self, system, user, schema, task=""):
        if task == "extract":
            return schema.model_validate({"price": 99999})
        return super().complete_json(system, user, schema, task)


def test_rejected_draft_is_retried_and_the_leak_is_never_sent():
    final, port, _ = run(LeakThenFix(), get_persona("flexible"), 900)
    assert any(t["node"] == "validate" and not t["ok"] for t in final["trace"])
    assert port.sent and all("budget" not in m.lower() for _, m in port.sent)


def test_falls_back_to_a_template_when_the_llm_keeps_failing_validation():
    final, port, _ = run(AlwaysLeaks(), get_persona("flexible"), 900)
    assert any(t["node"] == "fallback" for t in final["trace"])
    assert port.sent and all("budget" not in m.lower() for _, m in port.sent)


def test_falls_back_when_the_llm_call_itself_errors():
    final, _, _ = run(ComposeFails(), get_persona("flexible"), 1000)
    assert any(t["node"] == "fallback" for t in final["trace"])
    assert final["outcome"] in {"deal", "we_walk", "seller_walks"}


def test_implausible_extracted_prices_are_ignored():
    final, _, _ = run(BadExtraction(), get_persona("flexible"), 1000)
    assert final["seller_prices"] == [ASKING]
    assert final["outcome"] in {"extraction_miss", "we_walk"}


class AlwaysSaysAccepted(RuleBasedLLM):
    """A model that wrongly claims the seller accepted every message."""

    def complete_json(self, system, user, schema, task=""):
        if task == "extract":
            data = self._extract(user)
            data["accepted"] = True
            return schema.model_validate(data)
        return super().complete_json(system, user, schema, task)


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
def test_a_model_that_claims_acceptance_cannot_create_a_phantom_deal(persona):
    final, port, seller = run(AlwaysSaysAccepted(), persona, 1000)
    if final["outcome"] == "deal":
        last_execute = [t for t in final["trace"] if t["node"] == "execute"][-1]
        genuine = last_execute["action"] == "accept" or (port.log and port.log[-1].accepted)
        assert genuine
        assert final["final_price"] >= seller.reservation