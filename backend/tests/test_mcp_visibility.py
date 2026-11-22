import json
import os
import threading
import time
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.api.main import create_app
from backend.app.api.runs import MemoryRuns
from backend.app.api.service import Service
from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.boundaries.recorder import CallRecorder
from backend.app.boundaries.session import McpSession, McpToolError
from backend.app.graph.ports import InMemoryCalendar
from backend.app.logs import run_id_var

MARKETPLACE = "backend.app.boundaries.marketplace_server"
CALENDAR = "backend.app.boundaries.calendar_server"
ASKING = Decimal(1200)


def make(calendar=None, marketplace=None, recorder=None):
    if marketplace is not None:
        os.environ["MARKETPLACE_CHANNEL"] = "on"
    saver = InMemorySaver()
    runs = MemoryRuns()
    service = Service(
        saver,
        calendar or InMemoryCalendar(),
        runs,
        marketplace=marketplace,
        recorder=recorder,
    )
    app = create_app(service, poll_interval=0.02, stream_seconds=1.0)
    app.state.calendar_session = calendar
    app.state.marketplace_session = marketplace
    return app, saver, runs, service


def start_copilot_marketplace(client, **overrides):
    body = {
        "asking": 1200,
        "budget": 1000,
        "persona": "flexible",
        "style": "balanced",
        "autonomy": "approve_close",
        "mode": "copilot",
        "channel": "marketplace",
        **overrides,
    }
    response = client.post("/negotiations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def start_copilot_manual(client, **overrides):
    body = {
        "asking": 1200,
        "budget": 1000,
        "persona": "flexible",
        "style": "balanced",
        "autonomy": "approve_close",
        "mode": "copilot",
        "channel": "manual",
        **overrides,
    }
    response = client.post("/negotiations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def wait_status(client, run_id, wanted, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get(f"/negotiations/{run_id}").json()
        if snap["status"] in wanted:
            return snap
        time.sleep(0.02)
    raise AssertionError(f"still {snap['status']!r}, wanted {wanted}")


# ---------------------------------------------------------------- recorder unit


def test_recorder_orders_and_caps():
    recorder = CallRecorder(maxlen=10)
    recorder.record("r1", "calendar", "propose_slots", True, 5, None, {})
    recorder.record("r1", "marketplace", "send_offer", True, 7, None, {"turn": 1, "price": "800"})
    recorder.record("r2", "calendar", "book_slot", False, 3, "CalendarError", {"start": "x"})
    recorder.record("r1", "marketplace", "send_message", True, 4, None, {"turn": 2})

    r1 = recorder.for_run("r1")
    assert len(r1) == 3
    assert r1[0]["run"] == "r1"
    assert r1[0]["server"] == "calendar"
    assert r1[0]["tool"] == "propose_slots"
    assert r1[0]["ok"] is True
    assert r1[0]["ms"] == 5
    assert r1[0]["error"] is None
    assert r1[0]["args"] == {}
    assert r1[1]["run"] == "r1"
    assert r1[1]["server"] == "marketplace"
    assert r1[1]["tool"] == "send_offer"
    assert r1[1]["args"] == {"turn": 1, "price": 800.0}
    assert r1[2]["tool"] == "send_message"
    assert r1[2]["args"] == {"turn": 2}

    r2 = recorder.for_run("r2")
    assert len(r2) == 1
    assert r2[0]["run"] == "r2"
    assert r2[0]["tool"] == "book_slot"
    assert r2[0]["ok"] is False
    assert r2[0]["error"] == "CalendarError"
    assert r2[0]["args"] == {"start": "x"}

    # ring buffer keeps all entries when under maxlen
    assert len(recorder.recent()) == 4


def test_recorder_whitelist_drops_private_args():
    recorder = CallRecorder()
    recorder.record(
        "r1",
        "marketplace",
        "send_offer",
        True,
        1,
        None,
        {
            "turn": 0,
            "price": "800",
            "message": "SECRET-BUYER-TEXT",
            "conversation_id": "aaaa-bbbb-cccc-dddd",
        },
    )
    entry = recorder.for_run("r1")[0]
    assert entry["args"] == {"turn": 0, "price": 800.0, "conversation": "aaaa-bbb"}
    assert "message" not in entry["args"]
    assert "conversation_id" not in entry["args"]


def test_recorder_thread_safety_smoke():
    recorder = CallRecorder()
    errors = []

    def worker():
        try:
            for i in range(50):
                recorder.record("r1", "marketplace", "send_offer", True, i, None, {"turn": i})
        except Exception as error:  # noqa: BLE001 - collecting failures across threads
            errors.append(error)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors, errors
    assert len(recorder.recent()) == 500


# ---------------------------------------------------------------- session


@pytest.fixture(scope="module")
def mcp_session():
    os.environ["MARKETPLACE_CHANNEL"] = "on"
    recorder = CallRecorder()
    with McpSession(MARKETPLACE, recorder=recorder) as session:
        yield session, recorder
    os.environ.pop("MARKETPLACE_CHANNEL", None)


def test_session_records_success_and_failure(mcp_session):
    session, recorder = mcp_session
    before = len(recorder.recent())

    # a successful call is recorded
    session.call("open_conversation", conversation_id="c1", asking="1200", persona="flexible", seed=0)
    after = recorder.recent()
    assert len(after) == before + 1
    entry = after[-1]
    assert entry["server"] == "marketplace"
    assert entry["tool"] == "open_conversation"
    assert entry["ok"] is True
    assert entry["error"] is None
    assert entry["ms"] >= 0
    assert entry["run"] is None  # no run context outside a negotiation
    assert entry["args"] == {"conversation": "c1"}

    # a failed call is recorded with the error type AND still raises
    before_fail = len(
        [e for e in recorder.recent() if e["ok"] is False and e["tool"] == "send_offer"]
    )
    with pytest.raises(McpToolError):
        session.call("send_offer", conversation_id="nope", turn=0, price="800", message="x")
    failed = [e for e in recorder.recent() if e["ok"] is False and e["tool"] == "send_offer"]
    assert len(failed) == before_fail + 1
    entry = failed[-1]
    assert entry["ok"] is False
    assert entry["error"] == "McpToolError"
    assert "nonexistent_tool" not in entry["error"]
    assert "bar" not in entry["error"]


def test_session_list_tools_returns_params_and_is_cached(mcp_session):
    session, recorder = mcp_session
    before = len(recorder.recent())

    tools = session.list_tools()
    assert isinstance(tools, list)
    names = {t["name"] for t in tools}
    assert "open_conversation" in names
    assert "send_offer" in names
    assert "send_message" in names
    assert "get_conversation" in names
    for tool in tools:
        assert set(tool) == {"name", "description", "params"}
        for param in tool["params"]:
            assert set(param) == {"name", "type", "required"}
            assert isinstance(param["required"], bool)

    # second call returns the same (cached) and does not touch the recorder
    tools2 = session.list_tools()
    assert tools2 == tools
    assert len(recorder.recent()) == before


# ---------------------------------------------------------------- endpoints


def test_connections_marketplace_off(mcp_session):
    app, _, _, _service = make(marketplace=None, recorder=CallRecorder())
    with TestClient(app) as client:
        response = client.get("/connections")
        assert response.status_code == 200
        body = response.json()
        assert len(body["servers"]) == 2
        calendar = body["servers"][0]
        assert calendar["id"] == "calendar"
        assert calendar["name"] == "haggle-calendar"
        assert calendar["transport"] == "stdio"
        marketplace = body["servers"][1]
        assert marketplace["id"] == "marketplace"
        assert marketplace["name"] == "haggle-marketplace"
        assert marketplace["transport"] == "stdio"
        assert marketplace["status"] == "off"
        assert marketplace["tools"] == []


def test_connections_marketplace_on(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        response = client.get("/connections")
        assert response.status_code == 200
        body = response.json()
        assert len(body["servers"]) == 2
        marketplace = body["servers"][1]
        assert marketplace["id"] == "marketplace"
        assert marketplace["name"] == "haggle-marketplace"
        assert marketplace["transport"] == "stdio"
        assert marketplace["status"] == "connected"
        assert isinstance(marketplace["tools"], list)
        assert len(marketplace["tools"]) >= 3


def test_mcp_calls_for_run(mcp_session):
    app, _, _runs, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
        assert snap["status"] == "waiting_for_approval"
        assert snap["question"]["gate"] == "seller_reply"
        assert snap["question"]["channel"] == "marketplace"
        # send the first offer to trigger the MCP send_offer call
        client.post(f"/negotiations/{run_id}/send", json={})
        wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
        # wait for the send_offer call to be recorded (it runs on a thread pool)
        send_offers = []
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            calls = client.get(f"/negotiations/{run_id}/mcp-calls").json()["calls"]
            send_offers = [
                c
                for c in calls
                if c["tool"] == "send_offer" and c["server"] == "marketplace" and c["run"] == run_id
            ]
            if send_offers:
                break
            time.sleep(0.05)
        assert len(send_offers) >= 1
        for call in send_offers:
            assert call["ok"] is True
            assert call["ms"] >= 0
            assert call["error"] is None
            assert call["args"].get("turn") is not None


def test_mcp_calls_unknown_run_404(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        response = client.get("/negotiations/does-not-exist/mcp-calls")
        assert response.status_code == 404


def test_mcp_calls_isolation_between_runs(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_a = start_copilot_marketplace(client)
        snap_a = wait_status(client, run_a, {"waiting_for_approval", "finished", "failed"})
        if snap_a["status"] == "waiting_for_approval":
            client.post(f"/negotiations/{run_a}/send", json={})
        snap_a = wait_status(client, run_a, {"waiting_for_approval", "finished", "failed"})

        run_b = start_copilot_marketplace(client)
        snap_b = wait_status(client, run_b, {"waiting_for_approval", "finished", "failed"})
        if snap_b["status"] == "waiting_for_approval":
            client.post(f"/negotiations/{run_b}/send", json={})
            wait_status(client, run_b, {"waiting_for_approval", "finished", "failed"})

        calls_a = client.get(f"/negotiations/{run_a}/mcp-calls").json()["calls"]
        calls_b = client.get(f"/negotiations/{run_b}/mcp-calls").json()["calls"]
        assert all(c["run"] == run_a for c in calls_a)
        assert all(c["run"] == run_b for c in calls_b)
        assert len(calls_a) >= 1
        assert len(calls_b) >= 1


def test_seller_view_transcript(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"
        assert snap["question"]["gate"] == "seller_reply"
        assert snap["question"]["channel"] == "marketplace"

        response = client.get(f"/negotiations/{run_id}/seller-view")
        assert response.status_code == 200
        body = response.json()
        assert body["found"] is True
        assert "asking" in body
        assert body["persona"] == "flexible"
        assert isinstance(body["messages"], list)
        # messages may be empty at the first gate (clarify ran, no seller reply yet)
        if body["messages"]:
            # opening message first
            assert body["messages"][0]["from"] == "seller"
            # no hidden floor / internal state keys
            flat = json.dumps(body)
            assert "reservation" not in flat
            assert "patience" not in flat


def test_seller_view_409_for_non_marketplace_run(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_manual(client)
        response = client.get(f"/negotiations/{run_id}/seller-view")
        assert response.status_code == 409
        assert "marketplace" in response.text.lower()


def test_seller_view_404_unknown_run(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        response = client.get("/negotiations/does-not-exist/seller-view")
        assert response.status_code == 404


def test_get_conversation_not_recorded(mcp_session):
    session, recorder = mcp_session
    before = len(recorder.recent())
    session.call("get_conversation", conversation_id="whatever")
    assert len(recorder.recent()) == before


def test_full_marketplace_run_logs_send_offer(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
        for _ in range(5):
            if snap["status"] != "waiting_for_approval":
                break
            client.post(f"/negotiations/{run_id}/send", json={})
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})

        calls = client.get(f"/negotiations/{run_id}/mcp-calls").json()["calls"]
        send_offers = [
            c
            for c in calls
            if c["tool"] == "send_offer"
            and c["server"] == "marketplace"
            and c["run"] == run_id
            and c["ok"] is True
        ]
        assert len(send_offers) >= 1


# ---------------------------------------------------------------- item 2a: privacy


def test_recorder_privacy_no_secret_values(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client, listing_text="ZZLISTING-TOKEN item")
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"
        client.post(f"/negotiations/{run_id}/send", json={"sent_text": "ZZPRIVATE-TOKEN"})
        wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})

        all_entries = mcp_session[1].recent()
        calls_response = client.get(f"/negotiations/{run_id}/mcp-calls").json()["calls"]
        connections_response = client.get("/connections").json()

        all_json = json.dumps(all_entries + calls_response + connections_response["servers"])
        assert "ZZPRIVATE-TOKEN" not in all_json
        assert "ZZLISTING-TOKEN" not in all_json
        assert "987654" not in all_json

        for entry in all_entries + calls_response:
            for key in entry.get("args", {}):
                assert key in {"turn", "price", "start", "slot", "kind", "conversation"}, key
            if "conversation" in entry.get("args", {}):
                assert len(entry["args"]["conversation"]) <= 8


# ---------------------------------------------------------------- item 2b: run attribution outside a run


def test_run_attribution_outside_a_run(mcp_session):
    session, recorder = mcp_session
    before = len(recorder.recent())
    session.call("open_conversation", conversation_id="outside-run", asking="100", persona="flexible", seed=1)
    after = recorder.recent()
    assert len(after) == before + 1
    entry = after[-1]
    assert entry["run"] is None
    assert entry["server"] == "marketplace"
    assert entry["tool"] == "open_conversation"


# ---------------------------------------------------------------- item 2c: calendar pickup attribution


def test_calendar_pickup_attributed_to_run(mcp_session):
    calendar_session = McpSession(CALENDAR, recorder=mcp_session[1])
    calendar_session.start()
    McpCalendarPort(calendar_session)
    # propose_slots will fail (no database), but the call is still recorded with run_id
    token = run_id_var.set("run-cal-1")
    try:
        calendar_session.call("propose_slots", count=2, conversation_id="run-cal-1")
    except McpToolError:
        pass
    finally:
        run_id_var.reset(token)
    calls = mcp_session[1].recent()
    calendar_calls = [c for c in calls if c["server"] == "calendar" and c["run"] == "run-cal-1"]
    assert len(calendar_calls) >= 1
    tools = {c["tool"] for c in calendar_calls}
    assert "propose_slots" in tools
    for c in calendar_calls:
        assert c["run"] == "run-cal-1"
    calendar_session.close()


# ---------------------------------------------------------------- item 2d: DOWN status


def test_connections_marketplace_down(mcp_session):
    # Create a separate session and close it to simulate a dead marketplace
    down_session = McpSession(MARKETPLACE)
    down_session.start()
    down_session.close()
    app, _, _, _service = make(marketplace=None, recorder=CallRecorder())
    app.state.marketplace_session = down_session
    with TestClient(app) as client:
        response = client.get("/connections")
        assert response.status_code == 200
        body = response.json()
        marketplace = body["servers"][1]
        assert marketplace["id"] == "marketplace"
        assert marketplace["name"] == "haggle-marketplace"
        assert marketplace["status"] == "down"
        assert marketplace["tools"] == []
        calendar = body["servers"][0]
        assert calendar["id"] == "calendar"
        assert calendar["name"] == "haggle-calendar"


# ---------------------------------------------------------------- item 2e: seller view keys


def test_seller_view_exact_keys(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"

        response = client.get(f"/negotiations/{run_id}/seller-view")
        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"found", "asking", "persona", "messages"}
        assert body["found"] is True
        assert isinstance(body["messages"], list)
        for msg in body["messages"]:
            assert set(msg.keys()) == {"turn", "from", "text", "price"}
            flat = json.dumps(msg)
            assert "reservation" not in flat.lower()
            assert "floor" not in flat.lower()
            assert "patience" not in flat.lower()


# ---------------------------------------------------------------- item 2f: error recording


def test_error_recording_type_name(mcp_session):
    session, recorder = mcp_session
    before = len([e for e in recorder.recent() if e["run"] is None])

    with pytest.raises(McpToolError):
        session.call("nonexistent_tool", foo="bar")
    failed = [e for e in recorder.recent() if e["run"] is None]
    assert len(failed) == before + 1
    entry = failed[-1]
    assert entry["ok"] is False
    assert entry["error"] == "McpToolError"
    assert "nonexistent_tool" not in entry["error"]
    assert "bar" not in entry["error"]

    with pytest.raises(McpToolError):
        session.call("send_offer", conversation_id="nope", turn="not-an-int", price="x", message="y")
    failed2 = [e for e in recorder.recent() if e["run"] is None]
    assert len(failed2) == before + 2
    entry2 = failed2[-1]
    assert entry2["ok"] is False
    assert entry2["error"] == "McpToolError"


# ---------------------------------------------------------------- item 2a: seller-view opening message


def test_seller_view_opening_after_run(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"
        assert snap["question"]["gate"] == "seller_reply"
        assert snap["question"]["channel"] == "marketplace"

        # Drive through 3 turns
        for _ in range(3):
            client.post(f"/negotiations/{run_id}/send", json={})
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
            if snap["status"] != "waiting_for_approval":
                break

        response = client.get(f"/negotiations/{run_id}/seller-view")
        assert response.status_code == 200
        body = response.json()
        assert body["found"] is True
        assert len(body["messages"]) >= 1
        # messages[0] should be the seller's opening (turn 0)
        assert body["messages"][0]["turn"] == 0
        assert body["messages"][0]["from"] == "seller"
        assert body["messages"][0]["price"] is None
        assert isinstance(body["messages"][0]["text"], str)
        assert len(body["messages"][0]["text"]) > 0


def test_seller_view_opening_after_restart(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"

        # Drive through 3 turns
        for _ in range(3):
            client.post(f"/negotiations/{run_id}/send", json={})
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
            if snap["status"] != "waiting_for_approval":
                break

        # Get snapshot before restart to capture the opening text
        sv_before = client.get(f"/negotiations/{run_id}/seller-view").json()
        assert sv_before["found"] is True
        assert len(sv_before["messages"]) >= 1
        opening_text = sv_before["messages"][0]["text"]
        assert sv_before["messages"][0]["turn"] == 0
        assert sv_before["messages"][0]["from"] == "seller"

        # Simulate restart: new McpSession, replay the conversation
        new_session = McpSession(MARKETPLACE, recorder=mcp_session[1])
        new_session.start()
        try:
            new_session.call(
                "open_conversation",
                conversation_id=run_id,
                asking="1200",
                persona="flexible",
                seed=0,
                replay_json=json.dumps([None if t is None else str(t) for t in [820, 835, 860]]),
            )
            sv_after = client.get(f"/negotiations/{run_id}/seller-view").json()
            assert sv_after["found"] is True
            assert len(sv_after["messages"]) >= 1
            # After restart with replay, messages[0] should still be the seller's opening
            assert sv_after["messages"][0]["turn"] == 0
            assert sv_after["messages"][0]["from"] == "seller"
            assert sv_after["messages"][0]["text"] == opening_text
        finally:
            new_session.close()


def test_seller_view_exact_keys_after_multiple_turns(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"

        # Drive through 3 turns
        for _ in range(3):
            client.post(f"/negotiations/{run_id}/send", json={})
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
            if snap["status"] != "waiting_for_approval":
                break

        response = client.get(f"/negotiations/{run_id}/seller-view")
        assert response.status_code == 200
        body = response.json()
        assert body["found"] is True
        assert isinstance(body["messages"], list)
        for msg in body["messages"]:
            assert set(msg.keys()) == {"turn", "from", "text", "price"}
            flat = json.dumps(msg)
            assert "reservation" not in flat.lower()
            assert "floor" not in flat.lower()
            assert "patience" not in flat.lower()


def test_seller_view_turns_are_contiguous(mcp_session):
    app, _, _, _service = make(marketplace=mcp_session[0], recorder=mcp_session[1])
    with TestClient(app) as client:
        run_id = start_copilot_marketplace(client)
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["status"] == "waiting_for_approval"

        # Drive through 3 offers
        for _ in range(3):
            client.post(f"/negotiations/{run_id}/send", json={})
            snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
            if snap["status"] != "waiting_for_approval":
                break

        response = client.get(f"/negotiations/{run_id}/seller-view")
        assert response.status_code == 200
        body = response.json()
        assert body["found"] is True
        turns = [msg["turn"] for msg in body["messages"]]
        assert turns == [0, 1, 2, 3, 4, 5, 6], turns
        for msg in body["messages"]:
            assert set(msg.keys()) == {"turn", "from", "text", "price"}


# ---------------------------------------------------------------- item 2c: recorder whitelist


def test_recorder_calendar_args():
    recorder = CallRecorder()
    cases = [
        ("propose_slots", {"count": 3, "from_iso": "2026-12-01T10:00:00+08:00", "message": "secret text", "budget": 987654}),
        ("book_slot", {"booking_key": "RUN:pickup", "thread_id": "RUN", "start_at": "2026-12-02T10:00:00+08:00", "message": "secret text", "budget": 987654}),
        ("cancel_booking", {"booking_key": "RUN:pickup", "message": "secret text", "budget": 987654}),
    ]
    for tool, args in cases:
        recorder.record("run-x", "calendar", tool, True, 1, None, args)
    calls = recorder.for_run("run-x")
    assert len(calls) == 3
    propose = calls[0]
    book = calls[1]
    cancel = calls[2]
    assert propose["args"] == {"count": 3, "from_iso": "2026-12-01T10:00:00+08:00"}
    assert book["args"] == {"start_at": "2026-12-02T10:00:00+08:00"}
    assert cancel["args"] == {}
    for c in calls:
        assert "conversation" not in c["args"]
        assert "message" not in c["args"]
        assert "budget" not in c["args"]
        assert "booking_key" not in c["args"]
        assert "thread_id" not in c["args"]


def test_recorder_price_normalization():
    recorder = CallRecorder()
    cases = [
        ("send_offer", {"turn": 0, "price": "820", "message": "hi"}),
        ("send_offer", {"turn": 1, "price": Decimal(835), "message": "hello"}),
        ("send_offer", {"turn": 2, "price": 820, "message": "int"}),
        ("send_offer", {"turn": 3, "price": "abc", "message": "bad"}),
        ("send_offer", {"turn": 4, "price": None, "message": "none"}),
    ]
    for tool, args in cases:
        recorder.record("run-x", "marketplace", tool, True, 1, None, args)
    calls = recorder.for_run("run-x")
    assert len(calls) == 5
    assert calls[0]["args"]["price"] == 820.0
    assert isinstance(calls[0]["args"]["price"], float)
    assert calls[1]["args"]["price"] == 835.0
    assert isinstance(calls[1]["args"]["price"], float)
    assert calls[2]["args"]["price"] == 820.0
    assert isinstance(calls[2]["args"]["price"], float)
    assert "price" not in calls[3]["args"]
    assert "price" not in calls[4]["args"]
    payload = json.dumps([c["args"] for c in calls])
    assert "820.0" in payload
    assert "835.0" in payload
    assert '"abc"' not in payload