import json
from decimal import Decimal

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.control import current_state, decide, pending, waiting_for
from backend.app.graph.ports import InMemoryCalendar, SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import DEV_PERSONAS, get_persona
from backend.app.sim.seller import SimSeller

ASKING = Decimal(1200)
GATES = {"close_deal", "book_pickup"}


def level2(persona, verdict, budget=1000):
    port = SimSellerPort(SimSeller(ASKING, persona, seed=0))
    calendar = InMemoryCalendar()
    graph = build_graph(
        RuleBasedLLM(), port, checkpointer=InMemorySaver(), approve_close=True, calendar=calendar
    )
    run_graph(graph, ASKING, Decimal(budget), opening_text=port.opening_text(), thread_id="t")
    questions = []
    for _ in range(5):  # at most two gates exist; the cap stops a runaway loop
        if not pending(graph, "t"):
            break
        question = waiting_for(graph, "t")
        questions.append(question)
        decide(graph, "t", verdict)
    return port, calendar, questions, current_state(graph, "t")


def uninterrupted(persona, budget=1000):
    port = SimSellerPort(SimSeller(ASKING, persona, seed=0))
    return run_graph(
        build_graph(RuleBasedLLM(), port, calendar=InMemoryCalendar()),
        ASKING,
        Decimal(budget),
        opening_text=port.opening_text(),
    )


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
def test_level2_runs_alone_and_stops_only_at_the_final_action(persona):
    port, calendar, questions, final = level2(persona, "approve")
    gates = [q["gate"] for q in questions]
    assert set(gates) <= GATES
    assert len(gates) <= 2
    expected = uninterrupted(persona)
    assert (final["outcome"], final["final_price"]) == (
        expected["outcome"],
        expected["final_price"],
    )
    if final["outcome"] == "deal":
        assert gates  # a deal never completes without a human pause
        assert final["pickup"]["status"] == "booked"
        assert port.sent  # messages went out with nobody approving them
        assert len(calendar.by_key) == 1
    else:
        assert gates == []
        assert final["pickup"] is None


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
def test_declining_the_first_gate_commits_nothing(persona):
    _, calendar, questions, final = level2(persona, "decline")
    assert calendar.by_key == {}
    if questions:
        assert questions[0]["gate"] in GATES
        if questions[0]["gate"] == "close_deal":
            assert final["outcome"] == "user_declined"
            assert final["pickup"] is None
        else:
            assert final["pickup"] == {"status": "declined"}


def test_only_the_exact_word_approve_goes_ahead():
    _, calendar, questions, _ = level2(get_persona("flexible"), "yes please")
    if questions:
        assert calendar.by_key == {}


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
def test_the_question_carries_only_public_fields(persona):
    _, _, questions, _ = level2(persona, "approve")
    for question in questions:
        assert set(question) <= {"gate", "price", "draft"}
        assert "max_budget" not in json.dumps(question)


def test_level2_is_refused_without_a_checkpointer():
    port = SimSellerPort(SimSeller(ASKING, get_persona("flexible"), seed=0))
    with pytest.raises(ValueError, match="checkpointer"):
        build_graph(RuleBasedLLM(), port, approve_close=True)


def test_the_default_graph_never_pauses():
    persona = get_persona("flexible")
    final = uninterrupted(persona)
    assert final["outcome"] == "deal"
    assert final["approvals"] == []