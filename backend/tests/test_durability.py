import logging
import os
import uuid
from decimal import Decimal

import pytest
from dotenv import load_dotenv
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.control import approve, current_state, edit_draft, pending
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.llm.tasks import fmt_price
from backend.app.sim.personas import DEV_PERSONAS, get_persona
from backend.app.sim.seller import SimSeller

load_dotenv()
ASKING = Decimal(1200)
SEED = 0


def start(persona, budget, saver, thread="t1"):
    port = SimSellerPort(SimSeller(ASKING, persona, seed=SEED))
    graph = build_graph(RuleBasedLLM(), port, checkpointer=saver, approve_each_message=True)
    run_graph(graph, ASKING, Decimal(budget), thread_id=thread)
    return graph, port


def finish(graph, thread, limit=60):
    for _ in range(limit):
        if not pending(graph, thread):
            break
        approve(graph, thread)
    return current_state(graph, thread)


def uninterrupted(persona, budget):
    port = SimSellerPort(SimSeller(ASKING, persona, seed=SEED))
    return run_graph(build_graph(RuleBasedLLM(), port), ASKING, Decimal(budget))


def test_pauses_before_sending_anything():
    graph, port = start(get_persona("flexible"), 1000, InMemorySaver())
    assert pending(graph, "t1") == ("execute",)
    assert port.sent == []
    assert current_state(graph, "t1")["draft"]


@pytest.mark.parametrize("persona", DEV_PERSONAS, ids=lambda p: p.name)
def test_approving_every_message_gives_the_same_result(persona):
    graph, _ = start(persona, 1000, InMemorySaver())
    final = finish(graph, "t1")
    expected = uninterrupted(persona, 1000)
    assert final["outcome"] == expected["outcome"]
    assert final["final_price"] == expected["final_price"]


def test_user_edits_are_validated_too():
    graph, port = start(get_persona("flexible"), 1000, InMemorySaver())
    price = fmt_price(Decimal(current_state(graph, "t1")["decision"]["price"]))

    leaky = f"My max budget is RM 1000, how about RM {price}?"
    assert edit_draft(graph, "t1", leaky)
    assert current_state(graph, "t1")["draft"] != leaky

    clean = f"Would RM {price} work for you?"
    assert edit_draft(graph, "t1", clean) == []
    approve(graph, "t1")
    assert port.sent[0][1] == clean


def test_resume_after_a_restart_matches_an_uninterrupted_run():
    persona = get_persona("budget_prober")
    saver = InMemorySaver()  # stands in for the database: the only thing that survives
    graph1, _ = start(persona, 1000, saver)
    approve(graph1, "t1")
    approve(graph1, "t1")
    offers = current_state(graph1, "t1")["our_offers"]
    assert len(offers) == 2

    port2 = SimSellerPort.restore(ASKING, persona, SEED, offers)
    graph2 = build_graph(RuleBasedLLM(), port2, checkpointer=saver, approve_each_message=True)
    final = finish(graph2, "t1")

    expected = uninterrupted(persona, 1000)
    assert (final["outcome"], final["final_price"]) == (
        expected["outcome"],
        expected["final_price"],
    )
    assert isinstance(final["max_budget"], Decimal)
    assert all(isinstance(price, Decimal) for price in final["our_offers"])


def test_checkpointing_state_raises_no_serialization_warnings(caplog):
    with caplog.at_level(logging.WARNING):
        graph, _ = start(get_persona("flexible"), 1000, InMemorySaver())
        finish(graph, "t1")
    words = ("unregistered", "blocked", "deserializ")
    assert [r.message for r in caplog.records if any(w in r.message.lower() for w in words)] == []


needs_db = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")


@needs_db
def test_postgres_checkpoint_survives_a_brand_new_connection():
    from langgraph.checkpoint.postgres import PostgresSaver

    url = os.environ["DATABASE_URL"]
    thread = f"test-{uuid.uuid4()}"
    persona = get_persona("budget_prober")

    with PostgresSaver.from_conn_string(url) as saver:
        saver.setup()
        graph1, _ = start(persona, 1000, saver, thread)
        approve(graph1, thread)
        offers = current_state(graph1, thread)["our_offers"]

    with PostgresSaver.from_conn_string(url) as saver2:  # a new connection, as after a crash
        port2 = SimSellerPort.restore(ASKING, persona, SEED, offers)
        graph2 = build_graph(RuleBasedLLM(), port2, checkpointer=saver2, approve_each_message=True)
        final = finish(graph2, thread)
        expected = uninterrupted(persona, 1000)
        assert (final["outcome"], final["final_price"]) == (
            expected["outcome"],
            expected["final_price"],
        )
        cleanup = getattr(saver2, "delete_thread", None)
        if cleanup:
            cleanup(thread)