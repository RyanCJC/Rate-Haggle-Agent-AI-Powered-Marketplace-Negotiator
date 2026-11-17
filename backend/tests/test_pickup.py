import time
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.api.main import create_app
from backend.app.api.runs import MemoryRuns
from backend.app.api.service import Service
from backend.app.core.calendar_rules import MYT, to_myt_iso
from backend.app.core.pickup import describe_slot, pickup_message
from backend.app.graph.ports import CalendarError, InMemoryCalendar

REPLIES = ["Lowest I can go is RM 991.", "I can do RM 905 at best.", "Lowest I can go is RM 880."]
SOON = (
    (datetime.now(MYT) + timedelta(hours=1))
    .replace(hour=12, minute=0, second=0, microsecond=0)
    .isoformat()
)


class CalendarIsDown(InMemoryCalendar):
    def propose_slots(self, count=3, from_iso=None):
        raise CalendarError("calendar is down")

    def book_slot(self, booking_key, thread_id, start_at):
        raise CalendarError("calendar is down")


def make(calendar=None, saver=None, runs=None):
    saver = saver or InMemorySaver()
    runs = runs or MemoryRuns()
    calendar = calendar if calendar is not None else InMemoryCalendar()
    service = Service(saver, calendar, runs)
    return create_app(service, poll_interval=0.02, stream_seconds=1.0), saver, runs, calendar


def wait_status(client, run_id, wanted, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get(f"/negotiations/{run_id}").json()
        if snap["status"] in wanted:
            return snap
        time.sleep(0.02)
    raise AssertionError(f"still {snap['status']!r}, wanted {wanted}")


def start(client):
    body = {"asking": 1200, "budget": 1000, "mode": "copilot"}
    response = client.post("/negotiations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def deal(client):
    """A copilot negotiation relayed to an agreed, approved deal at RM 880."""
    run_id = start(client)
    for text in REPLIES:
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["question"]["gate"] == "seller_reply"
        sent = client.post(f"/negotiations/{run_id}/reply", json={"reply": text})
        assert sent.status_code == 202, sent.text
    snap = wait_status(client, run_id, {"waiting_for_approval"})
    assert snap["question"]["gate"] == "close_deal"
    sent = client.post(f"/negotiations/{run_id}/decision", json={"verdict": "approve"})
    assert sent.status_code == 202, sent.text
    final = wait_status(client, run_id, {"finished"})
    assert final["outcome"] == "deal"
    return run_id


def options(client, run_id):
    return client.get(f"/negotiations/{run_id}/pickup/options").json()


@pytest.mark.parametrize(
    ("iso", "expected"),
    [
        ("2031-03-04T15:00:00+08:00", "Tue 4 Mar, 3 pm"),
        ("2031-03-04T07:00:00+00:00", "Tue 4 Mar, 3 pm"),
        ("2031-03-04T10:00:00+08:00", "Tue 4 Mar, 10 am"),
        ("2031-03-04T12:00:00+08:00", "Tue 4 Mar, 12 pm"),
    ],
)
def test_slots_are_described_in_malaysia_time(iso, expected):
    assert describe_slot(iso) == expected


def test_the_message_groups_times_by_day():
    slots = ["2031-03-04T15:00:00+08:00", "2031-03-04T16:00:00+08:00", "2031-03-05T11:00:00+08:00"]
    assert pickup_message(Decimal(880), slots) == (
        "Great, RM 880 it is. Could we do pickup on Tue 4 Mar at 3 pm or 4 pm, "
        "or Wed 5 Mar at 11 am? Let me know which time works for you."
    )


def test_the_message_handles_prices_and_no_slots():
    assert pickup_message(Decimal(880), []) is None
    assert pickup_message(Decimal("880.5"), ["2031-03-04T15:00:00+08:00"]).startswith(
        "Great, RM 880.5 it is."
    )
    assert pickup_message(Decimal(1200), ["2031-03-04T15:00:00+08:00"]).startswith(
        "Great, RM 1,200 it is."
    )


def test_options_list_free_slots_and_a_message_for_the_seller():
    app, *_ = make()
    with TestClient(app) as client:
        data = options(client, deal(client))
    assert len(data["slots"]) == 5
    assert len(data["labels"]) == 5
    assert data["pickup"] is None
    assert "RM 880" in data["message"]
    assert "1000" not in data["message"]
    assert "1,000" not in data["message"]
    for iso in data["slots"]:
        assert datetime.fromisoformat(iso) >= datetime.now(MYT) + timedelta(hours=23)


def test_booking_stores_the_pickup_with_the_run():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = deal(client)
        slot = options(client, run_id)["slots"][0]
        response = client.post(f"/negotiations/{run_id}/pickup", json={"start_at": slot})
        assert response.status_code == 200, response.text
        assert response.json() == {"status": "booked", "start_at": to_myt_iso(slot)}
        snap = client.get(f"/negotiations/{run_id}").json()
    assert snap["pickup"] == {"status": "booked", "start_at": to_myt_iso(slot)}
    assert snap["status"] == "finished"
    assert snap["outcome"] == "deal"
    assert list(calendar.by_key) == [f"{run_id}:pickup"]


def test_booking_again_is_harmless_and_a_different_time_is_refused():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = deal(client)
        slots = options(client, run_id)["slots"]
        url = f"/negotiations/{run_id}/pickup"
        first = client.post(url, json={"start_at": slots[0]})
        again = client.post(url, json={"start_at": slots[0]})
        other = client.post(url, json={"start_at": slots[1]})
        snap = client.get(f"/negotiations/{run_id}").json()
    assert first.status_code == again.status_code == 200
    assert first.json() == again.json()
    assert other.status_code == 409
    assert "cancel it first" in other.json()["detail"]
    assert snap["pickup"]["start_at"] == to_myt_iso(slots[0])
    assert len(calendar.by_key) == 1


def test_a_taken_slot_is_refused_and_nothing_is_booked():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = deal(client)
        slot = options(client, run_id)["slots"][0]
        calendar.taken.add(datetime.fromisoformat(slot))  # someone else gets it first
        response = client.post(f"/negotiations/{run_id}/pickup", json={"start_at": slot})
        snap = client.get(f"/negotiations/{run_id}").json()
    assert response.status_code == 409
    assert "taken" in response.json()["detail"]
    assert snap["pickup"] is None
    assert calendar.by_key == {}


@pytest.mark.parametrize(
    "start_at",
    ["2031-03-04T03:00:00+08:00", "not a date", "2031-03-04T10:00:00", SOON],
    ids=["night", "not-a-date", "no-timezone", "too-soon"],
)
def test_times_that_cannot_be_booked_are_refused(start_at):
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = deal(client)
        response = client.post(f"/negotiations/{run_id}/pickup", json={"start_at": start_at})
        snap = client.get(f"/negotiations/{run_id}").json()
    assert response.status_code == 422
    assert response.json()["detail"]
    assert snap["pickup"] is None
    assert calendar.by_key == {}


def test_cancelling_frees_the_slot_and_allows_a_new_booking():
    app, _, _, calendar = make()
    with TestClient(app) as client:
        run_id = deal(client)
        slots = options(client, run_id)["slots"]
        url = f"/negotiations/{run_id}/pickup"
        assert client.post(url, json={"start_at": slots[0]}).status_code == 200
        assert client.delete(url).json() == {"status": "cancelled"}
        assert client.get(f"/negotiations/{run_id}").json()["pickup"] is None
        assert calendar.by_key == {}
        assert client.delete(url).json() == {"status": "not_found"}
        assert client.post(url, json={"start_at": slots[1]}).status_code == 200
    assert list(calendar.by_key) == [f"{run_id}:pickup"]


def test_pickup_needs_a_finished_copilot_deal():
    app, *_ = make()
    with TestClient(app) as client:
        practice = client.post("/negotiations", json={"asking": 1200, "budget": 1000}).json()["id"]
        wait_status(client, practice, {"waiting_for_approval"})
        assert client.get(f"/negotiations/{practice}/pickup/options").status_code == 409

        waiting = start(client)
        wait_status(client, waiting, {"waiting_for_approval"})
        body = {"start_at": "2031-03-04T10:00:00+08:00"}
        assert client.get(f"/negotiations/{waiting}/pickup/options").status_code == 409
        assert client.post(f"/negotiations/{waiting}/pickup", json=body).status_code == 409
        assert client.delete(f"/negotiations/{waiting}/pickup").status_code == 409

        stopped = start(client)
        wait_status(client, stopped, {"waiting_for_approval"})
        assert client.post(f"/negotiations/{stopped}/stop").status_code == 202
        wait_status(client, stopped, {"finished"})
        assert client.get(f"/negotiations/{stopped}/pickup/options").status_code == 409

        assert client.get("/negotiations/nope/pickup/options").status_code == 404


def test_the_pickup_survives_a_restart():
    saver, runs, calendar = InMemorySaver(), MemoryRuns(), InMemoryCalendar()
    first, *_ = make(calendar, saver, runs)
    with TestClient(first) as client:
        run_id = deal(client)
        slot = options(client, run_id)["slots"][0]
        assert client.post(f"/negotiations/{run_id}/pickup", json={"start_at": slot}).status_code == 200
    second, *_ = make(calendar, saver, runs)  # a new process: shares only the stored state
    with TestClient(second) as client:
        snap = client.get(f"/negotiations/{run_id}").json()
        assert snap["pickup"]["status"] == "booked"
        data = options(client, run_id)
        assert data["slots"] == []
        assert data["pickup"]["status"] == "booked"
        again = client.post(f"/negotiations/{run_id}/pickup", json={"start_at": slot})
        assert again.status_code == 200
    assert len(calendar.by_key) == 1


def test_a_calendar_outage_gives_503_and_leaves_the_deal_alone():
    app, *_ = make(CalendarIsDown())
    with TestClient(app) as client:
        run_id = deal(client)  # a copilot negotiation never needs the calendar
        assert client.get(f"/negotiations/{run_id}/pickup/options").status_code == 503
        body = {"start_at": "2031-03-04T10:00:00+08:00"}
        assert client.post(f"/negotiations/{run_id}/pickup", json=body).status_code == 503
        snap = client.get(f"/negotiations/{run_id}").json()
    assert snap["outcome"] == "deal"
    assert snap["final_price"] == "880"
    assert snap["pickup"] is None