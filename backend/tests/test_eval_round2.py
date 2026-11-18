from backend.app.evaluation.policies import default_policies
from backend.app.evaluation.protocol import ASKINGS, RATIOS
from backend.app.evaluation.round2 import (
    BETAS,
    OPENINGS,
    V1_CANDIDATE,
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
    a = run_suite({"same": candidates()[V1_CANDIDATE]}, scenarios)
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