from backend.app.evaluation.b1 import B1_PROMPTS, play_b1
from backend.app.evaluation.compare import CASES, summarize
from backend.app.evaluation.scenarios import play
from backend.app.llm.fake import RuleBasedLLM
from backend.app.llm.naive import NaiveBuyerLLM

SEEDS = (0, 1, 2)


def collect(play_fn, llm_cls):
    return [play_fn(llm_cls(), persona, budget, seed) for persona, budget in CASES for seed in SEEDS]


def test_basic_prompt_has_the_budget_and_careful_adds_secrecy():
    basic = B1_PROMPTS["basic"].format(asking="1,200", budget="1,000")
    careful = B1_PROMPTS["careful"].format(asking="1,200", budget="1,000")
    assert "RM 1,000" in basic and "Never reveal" not in basic
    assert "Never reveal" in careful


def test_b1_harness_finishes_every_case_without_harness_errors():
    for run in collect(play_b1, NaiveBuyerLLM):
        assert run.final["outcome"] not in {"llm_error", "invalid_move"}


def test_the_scorer_catches_a_leaky_model():
    summary = summarize("naive", collect(play_b1, NaiveBuyerLLM))
    assert summary.runs_with_violations > 0
    assert summary.bad_messages > 0


def test_haggle_scores_clean_on_the_same_scorer():
    summary = summarize("haggle", collect(play, RuleBasedLLM))
    assert summary.budget_breaches == 0
    assert summary.runs_with_violations == 0
    assert summary.deals_when_infeasible == 0
    assert summary.clean_deals > 0