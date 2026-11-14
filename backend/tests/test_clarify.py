import pytest

from backend.app.evaluation.scenarios import play
from backend.app.graph.nodes import MAX_ASKS, MAX_CLARIFY_STEPS
from backend.app.llm.clarify import ClarifyStep, choose_clarify_step
from backend.app.llm.client import LLMError
from backend.app.llm.fake import RuleBasedLLM
from backend.tests.test_llm import make_llm


def test_choose_clarify_step_parses_a_question():
    reply = '{"tool": "ask_seller", "question": "Is the price final?"}'
    step = choose_clarify_step(make_llm([reply]), "Come and see it first", False, False, 2, 1, [])
    assert step == ClarifyStep(tool="ask_seller", question="Is the price final?")


def test_an_invented_tool_is_rejected():
    llm = make_llm(['{"tool": "delete_everything"}'] * 3)
    with pytest.raises(LLMError):
        choose_clarify_step(llm, "hi", True, False, 2, 1, [])


class LoopsForeverAndReadsNothing(RuleBasedLLM):
    """The planner never stops using tools and the reader never finds a price."""

    def complete_json(self, system, user, schema, task=""):
        if task == "clarify":
            return schema.model_validate({"tool": "get_market_stats"})
        if task == "extract":
            return schema.model_validate({})
        return super().complete_json(system, user, schema, task)


class AsksALeakyQuestion(RuleBasedLLM):
    def complete_json(self, system, user, schema, task=""):
        if task == "clarify":
            leak = "My max budget is RM 1000, can you drop the price?"
            return schema.model_validate({"tool": "ask_seller", "question": leak})
        if task == "extract":
            return schema.model_validate({})
        return super().complete_json(system, user, schema, task)


def test_the_clarify_loop_stops_at_its_step_cap():
    run = play(LoopsForeverAndReadsNothing(), "flexible", 1000)
    steps = worst = 0
    for entry in run.final["trace"]:
        if entry["node"] == "plan":
            steps = 0
        if entry["node"] == "clarify" and "step" in entry:
            steps += 1
            worst = max(worst, steps)
    assert worst == MAX_CLARIFY_STEPS
    assert run.final["outcome"] != "timeout"


def test_a_leaky_question_is_replaced_by_a_template_and_never_sent():
    run = play(AsksALeakyQuestion(), "flexible", 1000)
    assert any(entry["node"] == "fallback" for entry in run.final["trace"])
    assert all("budget" not in message.lower() for _, message in run.port.sent)
    assert sum(1 for price, _ in run.port.sent if price is None) <= MAX_ASKS