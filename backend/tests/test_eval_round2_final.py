from backend.app.evaluation.policies import default_policies
from backend.app.evaluation.protocol import (
    RATIOS,
    ROUND2_BASELINES,
    ROUND2_HEADLINE,
    split_refusal,
)
from backend.app.evaluation.report import render_report
from backend.app.evaluation.round2 import criteria_section
from backend.app.evaluation.runner import build_scenarios, run_suite
from backend.app.sim.personas import DEV_PERSONAS, TEST2_PERSONAS, get_persona

# reservation_ratio, concede_share, close_gap, max_rounds, lowball_ratio
PLAN = {
    "short_fuse": (0.82, 0.35, 0.03, 2, 0.50),
    "brisk_mid": (0.78, 0.25, 0.03, 3, 0.55),
    "brisk_firm": (0.88, 0.12, 0.02, 3, 0.60),
    "moderate": (0.84, 0.20, 0.03, 5, 0.55),
    "patient_soft": (0.75, 0.30, 0.03, 8, 0.50),
    "patient_firm": (0.90, 0.10, 0.02, 8, 0.60),
}


def test_round_2_sellers_match_the_plan_exactly():
    actual = {
        p.name: (p.reservation_ratio, p.concede_share, p.close_gap, p.max_rounds, p.lowball_ratio)
        for p in TEST2_PERSONAS
    }
    assert actual == PLAN
    assert all(p.split == "test2" for p in TEST2_PERSONAS)
    assert sum("impatient" in p.tags for p in TEST2_PERSONAS) == 3
    assert get_persona("short_fuse").split == "test2"


def test_test2_is_scored_once_on_committed_code():
    assert "--final" in split_refusal("test2", False, False, False, False)
    assert split_refusal("test2", True, False, False, False) is None
    assert "already scored" in split_refusal("test2", True, False, True, False)
    assert "commit" in split_refusal("test2", True, False, False, True)
    assert split_refusal("test2", True, True, True, True) is None


def test_round_2_report_sections_render():
    # Dev sellers on purpose: test2 must only ever be scored by scripts/run_eval.py --final.
    results = run_suite(
        default_policies(), build_scenarios(DEV_PERSONAS, (1200,), RATIOS, (0,))
    )
    meta = {
        "commit": "abc1234", "dirty": False, "personas": [p.name for p in DEV_PERSONAS],
        "askings": (1200,), "ratios": RATIOS, "seeds": 1,
    }
    text = render_report(results, "test2", ROUND2_HEADLINE, ROUND2_BASELINES, meta)
    assert f"{ROUND2_HEADLINE} (headline)" in text
    section = criteria_section(results, DEV_PERSONAS)
    for needle in ("success criteria", "impatient sellers", "violation rate is 0", "met"):
        assert needle in section