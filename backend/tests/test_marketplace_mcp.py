import uuid
from decimal import Decimal

import pytest

from backend.app.boundaries.ports import McpSellerPort
from backend.app.boundaries.session import McpSession, McpToolError
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

MARKETPLACE = "backend.app.boundaries.marketplace_server"
ASKING = Decimal(1200)


@pytest.fixture(scope="module")
def session():
    with McpSession(MARKETPLACE) as s:
        yield s


def direct_port(persona, seed=0):
    return SimSellerPort(SimSeller(ASKING, get_persona(persona), seed=seed))


def new_id():
    return uuid.uuid4().hex


def run(port, clarify):
    graph = build_graph(RuleBasedLLM(), port, clarify=clarify)
    return run_graph(graph, ASKING, Decimal(1000), opening_text=port.opening_text())


def test_the_server_exposes_exactly_three_tools(session):
    assert set(session.tools()) == {"open_conversation", "send_offer", "send_message"}


@pytest.mark.parametrize("persona", ["flexible", "evasive", "budget_prober", "term_changer"])
@pytest.mark.parametrize("clarify", [False, True])
def test_the_graph_over_mcp_does_exactly_what_it_does_directly(session, persona, clarify):
    direct = run(direct_port(persona), clarify)
    via_mcp = run(McpSellerPort(session, new_id(), ASKING, persona, 0), clarify)
    for key in ("history", "outcome", "final_price", "our_offers", "turns"):
        assert via_mcp[key] == direct[key], key


def test_a_repeated_turn_is_answered_again_without_reaching_the_seller_twice(session):
    cid = new_id()
    port = McpSellerPort(session, cid, ASKING, "flexible", 0)
    first = port.send_offer(Decimal(800), "hi")
    again = session.call("send_offer", conversation_id=cid, turn=0, price="800", message="hi")
    assert again["repeated"] is True
    assert again["text"] == first
    second = port.send_offer(Decimal(850), "hi")

    reference = direct_port("flexible")
    reference.opening_text()
    reference.send_offer(Decimal(800), "hi")
    assert second == reference.send_offer(Decimal(850), "hi")  # the retry cost the seller nothing


def test_out_of_order_turns_and_unknown_conversations_are_errors(session):
    cid = new_id()
    McpSellerPort(session, cid, ASKING, "flexible", 0)
    with pytest.raises(McpToolError):
        session.call("send_offer", conversation_id=cid, turn=5, price="800", message="x")
    with pytest.raises(McpToolError):
        session.call("send_offer", conversation_id="nope", turn=0, price="800", message="x")


def test_opening_an_existing_conversation_changes_nothing(session):
    cid = new_id()
    McpSellerPort(session, cid, ASKING, "flexible", 0)
    again = session.call(
        "open_conversation", conversation_id=cid, asking="1200", persona="flexible", seed=0
    )
    assert again["resumed"] is True
    assert again["opening"] is None


def test_a_restarted_marketplace_is_rebuilt_from_the_replay():
    reference = direct_port("flexible")
    reference.opening_text()
    expected = [reference.send_offer(Decimal(p), "m") for p in (800, 850, 900)]

    with McpSession(MARKETPLACE) as first:
        port = McpSellerPort(first, "c", ASKING, "flexible", 0)
        got = [port.send_offer(Decimal(p), "m") for p in (800, 850)]
    with McpSession(MARKETPLACE) as second:  # a new process: the old conversation is gone
        port = McpSellerPort(
            second, "c", ASKING, "flexible", 0, replay=[Decimal(800), Decimal(850)]
        )
        got.append(port.send_offer(Decimal(900), "m"))

    assert got == expected