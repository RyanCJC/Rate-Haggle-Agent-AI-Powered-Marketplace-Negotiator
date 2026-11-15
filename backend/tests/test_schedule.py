from datetime import datetime
from decimal import Decimal

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import CalendarError, InMemoryCalendar, SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

ASKING = Decimal(1200)


def play(persona, budget, calendar, thread_id=None, seed=0):
    port = SimSellerPort(SimSeller(ASKING, get_persona(persona), seed=seed))
    graph = build_graph(RuleBasedLLM(), port, calendar=calendar)
    return run_graph(
        graph, ASKING, Decimal(budget), opening_text=port.opening_text(), thread_id=thread_id
    )


def test_a_deal_books_a_pickup_slot():
    calendar = InMemoryCalendar()
    final = play("flexible", 1000, calendar, thread_id="run-1")
    assert final["outcome"] == "deal"
    assert final["pickup"]["status"] == "booked"
    assert list(calendar.by_key) == ["run-1:pickup"]
    assert any(t["node"] == "schedule" for t in final["trace"])


def test_no_deal_books_nothing():
    calendar = InMemoryCalendar()
    final = play("firm", 900, calendar)
    assert final["outcome"] != "deal"
    assert final["pickup"] is None
    assert calendar.by_key == {}


def test_running_the_same_negotiation_again_does_not_book_twice():
    calendar = InMemoryCalendar()
    first = play("flexible", 1000, calendar, thread_id="run-2")
    second = play("flexible", 1000, calendar, thread_id="run-2")
    assert first["pickup"]["status"] == "booked"
    assert second["pickup"]["status"] == "already_booked"
    assert second["pickup"]["start_at"] == first["pickup"]["start_at"]
    assert len(calendar.by_key) == 1


class LosesTheFirstRace(InMemoryCalendar):
    """Someone else grabs the first slot between 'propose' and 'book'."""

    def __init__(self):
        super().__init__()
        self.attempts = 0

    def book_slot(self, booking_key, thread_id, start_at):
        self.attempts += 1
        if self.attempts == 1:
            self.taken.add(datetime.fromisoformat(start_at))
        return super().book_slot(booking_key, thread_id, start_at)


def test_a_lost_race_falls_through_to_the_next_free_slot():
    calendar = LosesTheFirstRace()
    final = play("flexible", 1000, calendar, thread_id="run-3")
    assert final["pickup"]["status"] == "booked"
    assert calendar.attempts == 2


class CalendarIsDown(InMemoryCalendar):
    def propose_slots(self, count=3, from_iso=None):
        raise CalendarError("calendar is down")


def test_a_calendar_outage_never_undoes_the_deal():
    final = play("flexible", 1000, CalendarIsDown())
    assert final["outcome"] == "deal"
    assert final["final_price"] is not None
    assert final["pickup"]["status"] == "error"