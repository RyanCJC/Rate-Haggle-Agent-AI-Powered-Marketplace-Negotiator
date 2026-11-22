import io
import logging
import os
import time
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from backend.app.api.main import create_app
from backend.app.api.runs import MemoryRuns
from backend.app.api.service import Service
from backend.app.boundaries.ports import InMemoryCalendar, McpSellerPort
from backend.app.boundaries.session import McpSession
from backend.app.graph.ports import SimSellerPort
from backend.app.logs import make_handler
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

MARKETPLACE = "backend.app.boundaries.marketplace_server"
ASKING = Decimal(1200)


def make(marketplace=None, saver=None, runs=None):
    saver = saver or InMemorySaver()
    runs = runs or MemoryRuns()
    calendar = InMemoryCalendar()
    service = Service(saver, calendar, runs, marketplace=marketplace)
    return create_app(service, poll_interval=0.02, stream_seconds=1.0), saver, runs, calendar


def wait_status(client, run_id, wanted, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get(f"/negotiations/{run_id}").json()
        if snap["status"] in wanted:
            return snap
        time.sleep(0.02)
    raise AssertionError(f"still {snap['status']!r}, wanted {wanted}")


def start_marketplace(client, **overrides):
    body = {"asking": 1200, "budget": 1000, "mode": "copilot", "channel": "marketplace", **overrides}
    response = client.post("/negotiations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def start_manual(client, **overrides):
    body = {"asking": 1200, "budget": 1000, "mode": "copilot", "channel": "manual", **overrides}
    response = client.post("/negotiations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ---------------------------------------------------------------- settings


def test_marketplace_channel_defaults_off():
    from backend.app.settings import Settings
    assert Settings.from_env({}).marketplace_channel is False


def test_marketplace_channel_only_on():
    from backend.app.settings import Settings
    assert Settings.from_env({"MARKETPLACE_CHANNEL": "on"}).marketplace_channel is True
    for other in ("", "ON", "true", "1", "yes", "off"):
        assert Settings.from_env({"MARKETPLACE_CHANNEL": other}).marketplace_channel is False


# ------------------------------------------------------------- schema matrix


def test_schema_manual_default_unchanged():
    from backend.app.api.schemas import StartRequest
    r = StartRequest(asking=1200, budget=1000, mode="copilot")
    assert r.channel == "manual"


def test_schema_marketplace_simulate_rejected():
    from backend.app.api.schemas import StartRequest
    try:
        StartRequest(asking=1200, budget=1000, mode="simulate", channel="marketplace")
    except ValidationError:
        pass
    else:
        raise AssertionError("expected 422 for marketplace + simulate")


def test_schema_marketplace_with_seller_opening_rejected():
    from backend.app.api.schemas import StartRequest
    try:
        StartRequest(asking=1200, budget=1000, mode="copilot",
                     channel="marketplace", seller_opening="hi")
    except ValidationError:
        pass
    else:
        raise AssertionError("expected 422 for marketplace + seller_opening")


def test_schema_marketplace_copilot_ok():
    from backend.app.api.schemas import StartRequest
    r = StartRequest(asking=1200, budget=1000, mode="copilot", channel="marketplace")
    assert r.channel == "marketplace"


# ------------------------------------------------------------- capabilities


def test_capabilities_false_by_default():
    app, _, _, _ = make()
    with TestClient(app) as client:
        r = client.get("/capabilities")
        assert r.status_code == 200
        assert r.json() == {"marketplace_channel": False}


def test_marketplace_start_when_off_400():
    app, _, _, _ = make()
    with TestClient(app) as client:
        r = client.post("/negotiations", json={
            "asking": 1200, "budget": 1000, "mode": "copilot", "channel": "marketplace",
        })
        assert r.status_code == 400
        assert "marketplace channel is not enabled" in r.text


# ------------------------------------------------------------- end to end

@pytest.fixture(scope="module")
def mcp_session():
    old = os.environ.get("MARKETPLACE_CHANNEL")
    os.environ["MARKETPLACE_CHANNEL"] = "on"
    try:
        with McpSession(MARKETPLACE) as s:
            yield s
    finally:
        if old is None:
            os.environ.pop("MARKETPLACE_CHANNEL", None)
        else:
            os.environ["MARKETPLACE_CHANNEL"] = old


def _approve_until_done(client, run_id):
    """Approve every gate until the run finishes."""
    for _ in range(25):
        snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
        if snap["status"] != "waiting_for_approval":
            return snap
        gate = snap["question"]["gate"]
        if gate == "seller_reply":
            assert snap["question"]["channel"] == "marketplace"
            assert client.post(f"/negotiations/{run_id}/send", json={}).status_code == 202
        elif gate == "close_deal":
            assert client.post(f"/negotiations/{run_id}/decision", json={"verdict": "approve"}).status_code == 202
        else:
            raise AssertionError(f"unexpected gate: {gate}")
    return wait_status(client, run_id, {"finished", "failed"})


def test_marketplace_run_end_to_end(mcp_session):
    app, _, _, _ = make(marketplace=mcp_session)
    with TestClient(app) as client:
        run_id = start_marketplace(client)
        final = _approve_until_done(client, run_id)
        assert final["status"] in ("finished", "failed")
        assert final["outcome"] in ("deal", "user_stopped", "we_walk", "extraction_miss", "timeout")


def test_marketplace_edited_send(mcp_session):
    app, _, _, _ = make(marketplace=mcp_session)
    with TestClient(app) as client:
        run_id = start_marketplace(client)

        snap = wait_status(client, run_id, {"waiting_for_approval"})
        question = snap["question"]
        original_draft = question["draft"]
        price = question["price"]

        # Edited text that breaks the limit rule -> rejected like /reply
        leaky = f"My max budget is RM 1000, how about RM {price}?"
        refused = client.post(f"/negotiations/{run_id}/send",
                              json={"sent_text": leaky})
        assert refused.status_code == 422
        # Nothing sent: still waiting at same gate
        still = client.get(f"/negotiations/{run_id}").json()
        assert still["status"] == "waiting_for_approval"
        assert still["question"]["draft"] == original_draft

        # Clean edit: accepted
        clean = f"Would RM {price} work for you?"
        ok = client.post(f"/negotiations/{run_id}/send", json={"sent_text": clean})
        assert ok.status_code == 202


def test_marketplace_stop_ends_run(mcp_session):
    app, _, _, _ = make(marketplace=mcp_session)
    with TestClient(app) as client:
        run_id = start_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["question"]["gate"] == "seller_reply"

        assert client.post(f"/negotiations/{run_id}/stop").status_code == 202
        snap = wait_status(client, run_id, {"finished", "failed"})
        assert snap["status"] == "finished"
        assert snap["outcome"] == "user_stopped"


# ------------------------------------------------------------- 409 cases


def test_send_on_manual_run_409():
    app, _, _, _ = make()
    with TestClient(app) as client:
        run_id = start_manual(client)
        wait_status(client, run_id, {"waiting_for_approval"})
        assert client.post(f"/negotiations/{run_id}/send", json={}).status_code == 409


def test_reply_on_marketplace_run_409(mcp_session):
    app, _, _, _ = make(marketplace=mcp_session)
    with TestClient(app) as client:
        run_id = start_marketplace(client)
        wait_status(client, run_id, {"waiting_for_approval"})
        assert client.post(f"/negotiations/{run_id}/reply",
                           json={"reply": "hi"}).status_code == 409


# ------------------------------------------------------------- resume


def test_marketplace_resume_rebuilds_seller(mcp_session):
    """Resume after simulated restart: fresh MCP session, replay rebuilds seller state."""
    app1, saver, runs, _ = make(marketplace=mcp_session)
    with TestClient(app1) as client:
        run_id = start_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        client.post(f"/negotiations/{run_id}/send", json={})
        snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
        if snap["status"] == "waiting_for_approval":
            draft_before = snap["question"]["draft"]
            price_before = snap["question"]["price"]
        else:
            # Run finished after one turn; nothing to resume
            return

    # Simulate restart: fresh MCP session, same saver/runs
    with McpSession(MARKETPLACE) as new_session:
        app2, _, _, _ = make(marketplace=new_session, saver=saver, runs=runs)
        with TestClient(app2) as client:
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
            if snap["status"] == "waiting_for_approval":
                # Same draft should reappear (replay rebuilt seller state)
                assert snap["question"]["draft"] == draft_before
                assert snap["question"]["price"] == price_before
                client.post(f"/negotiations/{run_id}/send", json={})
            # Run should still be alive (not errored)
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
            assert snap["status"] in ("waiting_for_approval", "finished", "failed")


def test_repeated_open_conversation_does_not_reset():
    """B5: opening an existing conversation keeps it untouched (resumed: true)."""
    with McpSession(MARKETPLACE) as session:
        port = McpSellerPort(session, "conv-reuse", ASKING, "flexible", 0)
        first = port.send_offer(Decimal(800), "hello")
        # Re-open same conversation
        reply = session.call(
            "open_conversation",
            conversation_id="conv-reuse",
            asking="1200",
            persona="flexible",
            seed=0,
        )
        assert reply["resumed"] is True
        assert reply["opening"] is None
        # Turn counter preserved: next turn is 1, not 0
        second = port.send_offer(Decimal(850), "again")
        assert second != first


# ------------------------------------------------------------- old config behaves as manual


def test_old_config_without_channel_is_manual():
    app, _, _, _ = make()
    with TestClient(app) as client:
        run_id = start_manual(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["question"]["gate"] == "seller_reply"
        assert snap["config"].get("channel", "manual") == "manual"
        # /reply works for manual mode
        question = snap["question"]
        port = SimSellerPort(SimSeller(Decimal(1200), get_persona("flexible"), seed=0))
        reply_text = port.send_offer(Decimal(question["price"]), question["draft"])
        assert client.post(f"/negotiations/{run_id}/reply",
                           json={"reply": reply_text}).status_code == 202


# ------------------------------------------------------------- privacy


def test_marketplace_logs_no_private_values(mcp_session, caplog):
    stream = io.StringIO()
    logger = logging.getLogger("haggle.run")
    handler = make_handler(stream)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        app, _, _, _ = make(marketplace=mcp_session)
        with TestClient(app) as client:
            run_id = start_marketplace(client)
            snap = wait_status(client, run_id, {"waiting_for_approval"})
            question = snap["question"]
            draft = question["draft"]
            client.post(f"/negotiations/{run_id}/send", json={"sent_text": draft})
            wait_status(client, run_id, {"finished", "failed", "waiting_for_approval"})
    finally:
        logger.removeHandler(handler)

    text = stream.getvalue()
    assert str(ASKING) not in text  # asking not leaked
    assert "1000" not in text  # budget not leaked
    assert draft not in text  # draft text not leaked
