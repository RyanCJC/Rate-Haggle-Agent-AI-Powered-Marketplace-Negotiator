import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import psycopg
import pytest
from dotenv import load_dotenv

from backend.app.boundaries.calendar_db import DbCalendar
from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.boundaries.session import McpSession
from backend.app.graph.ports import InMemoryCalendar

load_dotenv()
URL = os.getenv("DATABASE_URL")
CALENDAR = "backend.app.boundaries.calendar_server"
A = "2031-03-04T10:00:00+08:00"
B = "2031-03-04T11:00:00+08:00"


def clean():
    with psycopg.connect(URL) as conn:
        conn.execute("DELETE FROM calendar_slots WHERE booking_key LIKE 'test-%'")


@pytest.fixture(scope="module")
def mcp_session():
    with McpSession(CALENDAR, env={"DATABASE_URL": URL}) as session:
        yield session


@pytest.fixture(params=["memory", "db", "mcp"])
def calendar(request):
    if request.param == "memory":
        yield InMemoryCalendar()
        return
    if not URL:
        pytest.skip("DATABASE_URL not set")
    clean()
    if request.param == "db":
        yield DbCalendar(URL)
    else:
        yield McpCalendarPort(request.getfixturevalue("mcp_session"))
    clean()


@pytest.fixture
def db_calendar():
    if not URL:
        pytest.skip("DATABASE_URL not set")
    clean()
    yield DbCalendar(URL)
    clean()


def test_booking_then_retrying_the_same_booking_changes_nothing(calendar):
    assert calendar.book_slot("test-1", "t", A)["status"] == "booked"
    again = calendar.book_slot("test-1", "t", A)
    assert again["status"] == "already_booked"
    assert again["same_slot"] is True


def test_a_key_can_never_hold_a_second_slot(calendar):
    calendar.book_slot("test-1", "t", A)
    reply = calendar.book_slot("test-1", "t", B)
    assert reply["status"] == "already_booked"
    assert reply["same_slot"] is False
    assert datetime.fromisoformat(reply["start_at"]) == datetime.fromisoformat(A)


def test_a_taken_slot_cannot_be_booked_by_another_key(calendar):
    calendar.book_slot("test-1", "t", A)
    assert calendar.book_slot("test-2", "t", A)["status"] == "slot_taken"


def test_bad_slots_are_refused(calendar):
    assert calendar.book_slot("test-1", "t", "2031-03-04T10:30:00+08:00")["status"] == "invalid"
    assert calendar.book_slot("test-1", "t", "2031-03-04T22:00:00+08:00")["status"] == "invalid"
    assert calendar.book_slot("test-1", "t", "not a time")["status"] == "invalid"


def test_cancelling_frees_the_slot_and_is_safe_to_repeat(calendar):
    calendar.book_slot("test-1", "t", A)
    assert calendar.cancel_booking("test-1")["status"] == "cancelled"
    assert calendar.cancel_booking("test-1")["status"] == "not_found"
    assert calendar.book_slot("test-2", "t", A)["status"] == "booked"


def test_proposed_slots_skip_what_is_booked(calendar):
    start = "2031-03-03T09:30:00+08:00"
    assert calendar.propose_slots(3, start)[0] == A
    calendar.book_slot("test-1", "t", A)
    assert calendar.propose_slots(3, start)[:2] == [B, "2031-03-04T12:00:00+08:00"]


def test_eight_racers_for_one_slot_produce_exactly_one_booking(db_calendar):
    def attempt(i):
        return db_calendar.book_slot(f"test-race-{i}", "t", A)["status"]

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert sorted(results) == ["booked"] + ["slot_taken"] * 7


def test_five_simultaneous_retries_of_one_booking_produce_one_row(db_calendar):
    def attempt(_):
        return db_calendar.book_slot("test-same", "t", A)["status"]

    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(attempt, range(5)))
    assert results.count("booked") == 1
    assert results.count("already_booked") == 4
    with psycopg.connect(URL) as conn:
        count = conn.execute(
            "SELECT count(*) FROM calendar_slots WHERE booking_key = 'test-same'"
        ).fetchone()[0]
    assert count == 1