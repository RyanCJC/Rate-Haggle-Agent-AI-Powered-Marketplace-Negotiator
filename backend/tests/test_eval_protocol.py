from decimal import Decimal

from backend.app.evaluation.metrics import (
    bootstrap_ci,
    clustered_scores,
    paired_difference,
    run_score,
    summarize,
)
from backend.app.evaluation.policies import capped_ladder_policy, default_policies
from backend.app.evaluation.protocol import (
    ASKINGS,
    BASELINES,
    HEADLINE,
    RATIOS,
    split_refusal,
)
from backend.app.evaluation.report import render_report
from backend.app.evaluation.runner import RunResult, build_scenarios, run_suite
from backend.app.sim.personas import DEV_PERSONAS


def result(
    policy="p", persona="firm", asking=1200, budget=1000, seed=0, outcome="deal", price=900,
    feasible=True, budget_violation=False, outbound=0, surplus=0.5,
):
    return RunResult(
        persona=persona, split="dev", policy=policy, asking=Decimal(asking),
        budget=Decimal(budget), seed=seed, reservation=Decimal(900), outcome=outcome,
        price=None if price is None else Decimal(price), rounds=3, feasible=feasible,
        budget_violation=budget_violation, outbound_violations=outbound, probes_seen=0,
        surplus=surplus,
    )


def test_run_score_counts_every_failure_as_zero():
    assert run_score(result(surplus=0.5)) == 0.5
    assert run_score(result(outcome="we_walk", price=None, surplus=None)) == 0.0
    assert run_score(result(budget_violation=True, surplus=0.9)) == 0.0
    assert run_score(result(outbound=1, surplus=0.9)) == 0.0
    assert run_score(result(feasible=False, surplus=0.9)) == 0.0


def test_bootstrap_ci_is_deterministic_and_brackets_the_mean():
    values = [0.1, 0.4, 0.5, 0.9]
    first, second = bootstrap_ci(values), bootstrap_ci(values)
    assert first == second
    mean, low, high = first
    assert low <= mean <= high
    flat = bootstrap_ci([0.3] * 5)
    assert flat[1] == flat[2] and abs(flat[0] - 0.3) < 1e-9
    assert bootstrap_ci([]) is None


def test_paired_difference_compares_the_same_negotiations():
    better = [result(policy="a", seed=s, surplus=0.6) for s in range(3)]
    worse = [result(policy="b", seed=s, surplus=0.4) for s in range(3)]
    d = paired_difference(better, worse)
    assert abs(d["mean_diff"] - 0.2) < 1e-9
    assert (d["wins"], d["ties"], d["losses"]) == (3, 0, 0)
    same = paired_difference(better, better)
    assert same["mean_diff"] == 0 and same["ties"] == 3
    assert paired_difference(better, [])["mean_diff"] is None  # nothing to pair


def test_confidence_intervals_resample_cases_not_runs():
    runs = [result(persona="firm", seed=s) for s in range(5)]
    runs += [result(persona="flexible", seed=s) for s in range(5)]
    assert len(clustered_scores(runs)) == 2  # two independent cases, ten runs


def test_b3_is_budget_aware_and_still_closes_deals():
    results = run_suite(
        {"b3": capped_ladder_policy}, build_scenarios(DEV_PERSONAS, ASKINGS, RATIOS, (0,))
    )
    summary = summarize(results)
    assert summary["budget_violations"] == 0
    assert summary["outbound_violations"] == 0
    assert summary["deals_when_infeasible"] == 0
    assert summary["deal_rate_feasible"] > 0


def test_headline_policy_stays_clean_on_the_final_grid():
    policy = {HEADLINE: default_policies()[HEADLINE]}
    results = run_suite(policy, build_scenarios(DEV_PERSONAS, ASKINGS, RATIOS, (0, 1)))
    summary = summarize(results)
    assert summary["violation_rate"] == 0
    assert summary["deals_when_infeasible"] == 0


def test_report_has_every_section():
    results = run_suite(
        default_policies(), build_scenarios(DEV_PERSONAS[:2], (1200,), (0.85, 1.0), (0,))
    )
    meta = {
        "commit": "abc1234", "dirty": False, "personas": ["firm", "flexible"],
        "askings": (1200,), "ratios": (0.85, 1.0), "seeds": 1,
    }
    text = render_report(results, "dev", HEADLINE, BASELINES, meta)
    for needle in ("## Policies", "headline", "b3_capped_ladder", "paired", "## Caveats", "abc1234"):
        assert needle in text


def test_the_test_split_is_scored_once_on_committed_code():
    assert split_refusal("dev", False, False, True, True) is None
    assert "--final" in split_refusal("test", False, False, False, False)
    assert split_refusal("test", True, False, False, False) is None
    assert "already scored" in split_refusal("test", True, False, True, False)
    assert split_refusal("test", True, True, True, False) is None
    assert "commit" in split_refusal("test", True, False, False, True)
    assert split_refusal("test", True, True, False, True) is None