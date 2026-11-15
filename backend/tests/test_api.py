import json
import os
import time

import psycopg
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres import PostgresSaver

from backend.app.api.main import create_app
from backend.app.api.runs import MemoryRuns
from backend.app.api.service import Service
from backend.app.graph.ports import InMemoryCalendar

load_dotenv()
URL = os.environ.get("DATABASE_URL")


def make(saver=None, runs=None, calendar=None):
    saver = saver or InMemorySaver()
    runs = runs or MemoryRuns()
    calendar = calendar or InMemoryCalendar()
    service = Service(saver, calendar, runs)
    return create_app(service, poll_interval=0.02, stream_seconds=1.0), saver, runs, calendar


def start(client, **overrides):
    body = {"asking": 1200, "budget": 1000, "persona": "flexible", **overrides}
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


def read_events(client, path, headers=None):
    events, name, data, ident = [], None, None, None
    with client.stream("GET", path, headers=headers or {}) as response:
        for line in response.iter_lines():
            if line.startswith("id: "):
                ident = int(line[4:])
            elif line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
            elif line == "" and name:
                events.append((name, ident, data))
                name, data, ident = None, None, None
    return events


def test_level2_run_waits_at_the_gate_then_books_after_approval():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = start(client)
        snap = wait_status(client, run_id, {"waiting_for_approval", "finished", "failed"})
        assert snap["status"] == "waiting_for_approval"
        assert snap["question"]["gate"] == "close_deal"
        assert snap["history"] and snap["pickup"] is None
        assert calendar.by_key == {}

        assert client.post(f"/negotiations/{run_id}/decision", json={"verdict": "approve"}
                           ).status_code == 202
        done = wait_status(client, run_id, {"finished", "failed"})
        assert done["outcome"] == "deal"
        assert done["pickup"]["status"] == "booked"
        assert done["approvals"] == ["close_deal"]
        assert list(calendar.by_key) == [f"{run_id}:pickup"]


def test_declining_books_nothing():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = start(client)
        wait_status(client, run_id, {"waiting_for_approval"})
        client.post(f"/negotiations/{run_id}/decision", json={"verdict": "decline"})
        done = wait_status(client, run_id, {"finished", "failed"})
        assert done["outcome"] == "user_declined"
        assert calendar.by_key == {}


def test_auto_mode_never_pauses():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = start(client, autonomy="auto")
        done = wait_status(client, run_id, {"finished", "failed"})
        assert done["outcome"] == "deal"
        assert done["pickup"]["status"] == "booked"
        assert len(calendar.by_key) == 1


def test_a_walk_away_run_has_no_gate():
    app, *_ = make()
    with TestClient(app) as client:
        run_id = start(client, persona="firm")
        done = wait_status(client, run_id, {"finished", "failed", "waiting_for_approval"})
        assert done["status"] == "finished"
        assert done["outcome"] == "we_walk"


def test_bad_requests_are_refused():
    app, *_ = make()
    with TestClient(app) as client:
        assert client.post("/negotiations", json={"asking": 1200, "budget": -5}).status_code == 422
        assert client.post("/negotiations", json={"asking": 1200, "budget": 900,
                                                  "autonomy": "wild"}).status_code == 422
        assert client.post("/negotiations", json={"asking": 1200, "budget": 900,
                                                  "persona": "nobody"}).status_code == 422
        assert client.get("/negotiations/nope").status_code == 404
        assert client.post("/negotiations/nope/decision", json={"verdict": "approve"}
                           ).status_code == 404
        run_id = start(client, autonomy="auto")
        wait_status(client, run_id, {"finished", "failed"})
        assert client.post(f"/negotiations/{run_id}/decision", json={"verdict": "approve"}
                           ).status_code == 409
        assert client.post(f"/negotiations/{run_id}/decision", json={"verdict": "maybe"}
                           ).status_code == 422


def test_the_event_stream_replays_the_trace_and_ends():
    app, *_ = make()
    with TestClient(app) as client:
        run_id = start(client, autonomy="auto")
        wait_status(client, run_id, {"finished"})
        snap = client.get(f"/negotiations/{run_id}").json()

        events = read_events(client, f"/negotiations/{run_id}/events")
        trace = [e for e in events if e[0] == "trace"]
        assert [e[1] for e in trace] == list(range(len(snap["trace"])))
        assert events[-1] == ("done", None, {"status": "finished"})

        resumed = read_events(client, f"/negotiations/{run_id}/events",
                              headers={"Last-Event-ID": "3"})
        assert next(e[1] for e in resumed if e[0] == "trace") == 4


def test_the_stream_stays_open_at_the_gate_and_announces_it():
    # TestClient waits for a stream to end, so these apps give streams a 1 second lifetime.
    app, *_ = make()
    with TestClient(app) as client:
        run_id = start(client)
        wait_status(client, run_id, {"waiting_for_approval"})
        events = read_events(client, f"/negotiations/{run_id}/events")
        names = [e[0] for e in events]
        assert names[-1] == "gate"  # then it idles until the stream lifetime runs out
        assert "done" not in names
        assert events[-1][2]["gate"] == "close_deal"


def test_a_second_server_instance_finishes_what_the_first_left_waiting():
    saver, runs, calendar = InMemorySaver(), MemoryRuns(), InMemoryCalendar()
    first, *_ = make(saver, runs, calendar)
    with TestClient(first) as client:
        run_id = start(client)
        wait_status(client, run_id, {"waiting_for_approval"})

    second, *_ = make(saver, runs, calendar)  # a new process: shares only the stored state
    with TestClient(second) as client:
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["question"]["gate"] == "close_deal"
        client.post(f"/negotiations/{run_id}/decision", json={"verdict": "approve"})
        done = wait_status(client, run_id, {"finished", "failed"})
        assert done["outcome"] == "deal"
        assert len(calendar.by_key) == 1


@pytest.mark.skipif(not URL, reason="DATABASE_URL not set")
def test_the_real_stack_on_postgres_and_the_calendar_server():
    run_id = None
    try:
        with TestClient(create_app(poll_interval=0.05)) as client:
            run_id = start(client, autonomy="auto")
            done = wait_status(client, run_id, {"finished", "failed"}, timeout=90)
            assert done["status"] == "finished", done["error"]
            assert done["pickup"]["status"] == "booked"
            assert done["pickup"]["start_at"].endswith("+08:00")
    finally:
        if run_id:
            with psycopg.connect(URL) as conn:
                conn.execute("DELETE FROM calendar_slots WHERE booking_key = %s",
                             (f"{run_id}:pickup",))
                conn.execute("DELETE FROM runs WHERE id = %s", (run_id,))
            with PostgresSaver.from_conn_string(URL) as saver:
                cleanup = getattr(saver, "delete_thread", None)
                if cleanup:
                    cleanup(run_id)


def test_a_snapshot_reads_the_stored_state_exactly_once(monkeypatch):
    from langgraph.pregel import Pregel

    app, *_ = make()
    with TestClient(app) as client:
        run_id = start(client, autonomy="auto")
        wait_status(client, run_id, {"finished"})

        calls = []
        original = Pregel.get_state

        def counting(self, *args, **kwargs):
            calls.append(1)
            return original(self, *args, **kwargs)

        monkeypatch.setattr(Pregel, "get_state", counting)
        assert client.get(f"/negotiations/{run_id}").status_code == 200
        assert len(calls) == 1  # three separate reads could mix two different checkpoints