from decimal import Decimal

from backend.app.evaluation.policies import default_policies
from backend.app.evaluation.protocol import ASKINGS, RATIOS
from backend.app.evaluation.round2 import (
    BETAS,
    NEW_BALANCED,
    OPENINGS,
    V1_CANDIDATE,
    V1_PARAMS,
    candidates,
    evaluate,
    pick_winner,
)
from backend.app.evaluation.runner import build_scenarios, run_suite
from backend.app.sim.personas import DEV_PERSONAS, TEST_PERSONAS


def test_grid_has_nine_candidates_and_contains_the_round_1_style():
    grid = candidates()
    assert len(grid) == len(OPENINGS) * len(BETAS) == 9
    assert V1_CANDIDATE in grid


def test_the_round_1_candidate_behaves_exactly_like_the_round_1_headline():
    scenarios = build_scenarios(DEV_PERSONAS, ASKINGS, RATIOS, (0,))

    # (a) V1_CANDIDATE pins the round-1 parameters explicitly: opening 0.70, beta 1.5,
    # opening_cap 0.85, all other fields as in round 1 (the StrategyParams defaults before
    # commit 3807010 softened them to 0.75 / 0.90).
    assert V1_PARAMS.opening_ratio == Decimal("0.70")
    assert V1_PARAMS.beta == 1.5
    assert V1_PARAMS.opening_cap == Decimal("0.85")
    assert V1_PARAMS.horizon == 6
    assert V1_PARAMS.walk_away_ratio == Decimal("0.92")
    assert V1_PARAMS.patience == 3
    assert V1_PARAMS.max_step_ratio == Decimal("0.08")
    assert V1_PARAMS.budget_cushion == Decimal("0.97")
    assert V1_CANDIDATE == "cand_open70_beta1.5"

    # (b) NEW_BALANCED (opening 0.80, beta 1.5, cap 0.90, outside the round-2 grid) behaves
    # exactly like the current default haggle_balanced on the same scenarios. Both are run
    # under the same policy key so the compared dumps reflect behaviour, not the policy name.
    a = run_suite({"same": NEW_BALANCED}, scenarios)
    b = run_suite({"same": default_policies()["haggle_balanced"]}, scenarios)
    assert [r.model_dump() for r in a] == [r.model_dump() for r in b]


def test_new_dev_sellers_are_impatient_and_the_test_split_is_untouched():
    new = [p for p in DEV_PERSONAS if p.name.startswith("walker_")]
    assert sorted(p.max_rounds for p in new) == [2, 3, 4]
    assert all(p.split == "dev" and "impatient" in p.tags for p in new)
    assert [p.name for p in TEST_PERSONAS] == [
        "firm_pressure", "flexible_prober", "stubborn_ms", "quick_walker",
    ]


def test_winner_rule_skips_rule_breakers_and_breaks_ties_by_rounds():
    rows = [
        {"name": "a", "score": 0.60, "violation_rate": 0.0, "rounds": 4.0},
        {"name": "b", "score": 0.70, "violation_rate": 0.1, "rounds": 3.0},
        {"name": "c", "score": 0.60, "violation_rate": 0.0, "rounds": 3.0},
        {"name": "d", "score": None, "violation_rate": 0.0, "rounds": 2.0},
    ]
    assert pick_winner(rows)["name"] == "c"
    assert pick_winner([rows[1]]) is None


def test_no_candidate_breaks_a_rule_on_dev():
    results = run_suite(candidates(), build_scenarios(DEV_PERSONAS, (1200,), RATIOS, (0,)))
    rows = evaluate(results, DEV_PERSONAS)
    assert len(rows) == 9
    assert all(row["violation_rate"] == 0 for row in rows)


def test_v2_is_exactly_the_candidate_the_dev_tuning_selected():
    scenarios = build_scenarios(DEV_PERSONAS, ASKINGS, RATIOS, (0,))
    winner = candidates()["cand_open78_beta1.0"]
    a = run_suite({"same": winner}, scenarios)
    b = run_suite({"same": default_policies()["haggle_balanced_v2"]}, scenarios)
    assert [r.model_dump() for r in a] == [r.model_dump() for r in b]