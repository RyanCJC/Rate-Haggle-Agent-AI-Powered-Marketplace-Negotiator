import json
import os
import queue
import subprocess
import sys
import threading
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import InMemoryCalendar, SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

load_dotenv()
URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="DATABASE_URL not set")

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "scripts" / "crash_worker.py"
ENV = {**os.environ, "PYTHONPATH": str(ROOT)}


def expected_result():
    """The same negotiation run in one piece, with no gates and no crashes."""
    port = SimSellerPort(SimSeller(Decimal(1200), get_persona("flexible"), seed=0))
    graph = build_graph(RuleBasedLLM(), port, calendar=InMemoryCalendar())
    return run_graph(graph, Decimal(1200), Decimal(1000), opening_text=port.opening_text())


def wait_for(proc, marker, timeout=90):
    found: queue.Queue = queue.Queue()

    def reader():
        for line in proc.stdout:
            if marker in line:
                found.put(line)
                return
        found.put(None)

    threading.Thread(target=reader, daemon=True).start()
    line = found.get(timeout=timeout)
    assert line, "the worker ended before it printed the marker"
    return line


def kill_while_paused(thread):
    """Start a worker, wait until it is paused at a gate, then kill it for real."""
    proc = subprocess.Popen(
        [sys.executable, str(WORKER), "start", "--thread", thread],
        cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        line = wait_for(proc, "PAUSED")
    finally:
        proc.kill()  # SIGKILL, or TerminateProcess on Windows: nothing gets to clean up
        proc.wait(timeout=30)
        proc.stdout.close()
    return json.loads(line.split(" ", 1)[1])


def resume(thread, *extra):
    return subprocess.run(
        [sys.executable, str(WORKER), "resume", "--thread", thread, *extra],
        cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=120, check=False,
    )


def result_of(done):
    lines = [x for x in done.stdout.splitlines() if x.startswith("RESULT ")]
    assert lines, f"no RESULT line (exit {done.returncode})\n{done.stdout}\n{done.stderr}"
    return json.loads(lines[0][len("RESULT "):])


def booked_rows(thread):
    with psycopg.connect(URL) as conn:
        return conn.execute(
            "SELECT start_at FROM calendar_slots WHERE booking_key = %s", (f"{thread}:pickup",)
        ).fetchall()


@pytest.fixture
def thread():
    name = f"test-kill-{uuid.uuid4().hex[:8]}"
    yield name
    with psycopg.connect(URL) as conn:
        conn.execute("DELETE FROM calendar_slots WHERE booking_key LIKE %s", (f"{name}%",))
    with PostgresSaver.from_conn_string(URL) as saver:
        cleanup = getattr(saver, "delete_thread", None)
        if cleanup:
            cleanup(name)


def test_killed_while_waiting_for_approval_resumes_and_books_exactly_once(thread):
    question = kill_while_paused(thread)
    assert question["gate"] == "close_deal"
    assert booked_rows(thread) == []  # nothing is booked while the human has not answered

    result = result_of(resume(thread, "--verdict", "approve"))
    expected = expected_result()
    assert result["outcome"] == expected["outcome"] == "deal"
    assert Decimal(result["final_price"]) == expected["final_price"]
    assert result["pickup"]["status"] == "booked"
    assert result["approvals"] == ["close_deal"]
    assert len(booked_rows(thread)) == 1

    again = result_of(resume(thread))  # resuming a finished run changes nothing
    assert again == result
    assert len(booked_rows(thread)) == 1


def test_a_decline_survives_the_kill_and_books_nothing(thread):
    kill_while_paused(thread)
    result = result_of(resume(thread, "--verdict", "no"))
    assert result["outcome"] == "user_declined"
    assert result["pickup"] is None
    assert booked_rows(thread) == []


def test_a_crash_right_after_the_booking_never_books_twice(thread):
    kill_while_paused(thread)

    crashed = resume(thread, "--verdict", "approve", "--die-after-booking")
    assert crashed.returncode == 137  # it died inside the booking step
    rows = booked_rows(thread)
    assert len(rows) == 1  # the booking had already committed
    first_slot = rows[0][0]

    result = result_of(resume(thread))  # the checkpoint still says "not booked yet"
    assert result["outcome"] == "deal"
    assert result["pickup"]["status"] == "already_booked"
    assert datetime.fromisoformat(result["pickup"]["start_at"]) == first_slot
    assert len(booked_rows(thread)) == 1