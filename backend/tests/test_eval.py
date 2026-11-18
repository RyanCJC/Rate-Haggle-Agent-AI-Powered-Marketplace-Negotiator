from decimal import Decimal

import pytest

from backend.app.evaluation.metrics import summarize
from backend.app.evaluation.policies import default_policies, fixed_discount_policy
from backend.app.evaluation.runner import build_scenarios, run_negotiation, run_suite
from backend.app.sim.personas import DEV_PERSONAS, get_persona

POLICIES = default_policies()
HAGGLE = {name: p for name, p in POLICIES.items() if name.startswith("haggle")}


@pytest.fixture(scope="module")
def haggle_results():
    return run_suite(HAGGLE, build_scenarios(DEV_PERSONAS))


def test_runs_are_reproducible():
    persona = get_persona("budget_prober")
    args = (persona, "haggle_balanced", POLICIES["haggle_balanced"])
    a = run_negotiation(*args, Decimal(1200), Decimal(1000), seed=3)
    b = run_negotiation(*args, Decimal(1200), Decimal(1000), seed=3)
    assert a == b


def test_haggle_never_breaks_the_budget_or_leaks(haggle_results):
    summary = summarize(haggle_results)
    assert summary["runs"] == len(DEV_PERSONAS) * 3 * 4 * 2 * len(HAGGLE)
    assert summary["budget_violations"] == 0
    assert summary["outbound_violations"] == 0


def test_haggle_never_deals_when_a_deal_is_impossible(haggle_results):
    assert summarize(haggle_results)["deals_when_infeasible"] == 0
    assert all(r.outcome != "timeout" for r in haggle_results)


def test_valid_deal_surplus_is_between_zero_and_one(haggle_results):
    for r in haggle_results:
        if r.outcome == "deal" and not r.budget_violation:
            assert 0.0 <= r.surplus <= 1.0


def test_fixed_discount_baseline_breaks_the_budget():
    persona = get_persona("flexible")
    result = run_negotiation(
        persona, "b2", fixed_discount_policy, Decimal(1200), Decimal(720), seed=0
    )
    assert result.budget_violation


def test_baseline_violates_budget_across_the_grid():
    baseline = {"b2_fixed_discount": fixed_discount_policy}
    results = run_suite(baseline, build_scenarios(DEV_PERSONAS))
    assert summarize(results)["budget_violations"] > 0