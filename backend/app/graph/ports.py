from datetime import datetime
from decimal import Decimal
from typing import Protocol

from backend.app.core.calendar_rules import MYT, candidate_slots, validate_slot
from backend.app.sim.seller import SellerReply, SimSeller


class SellerClosed(Exception):
    """The seller already ended the negotiation (we missed it)."""


class SellerPort(Protocol):
    def send_offer(self, price: Decimal, message: str) -> str: ...

    def send_message(self, message: str) -> str: ...


class SimSellerPort:
    """Adapter that lets the graph talk to the simulator. In Stage 5 this becomes MCP."""

    def __init__(self, seller: SimSeller):
        self.seller = seller
        self.log: list[SellerReply] = []  # ground truth, for scoring extraction
        self.sent: list[tuple[Decimal | None, str]] = []  # (price or None for a question, text)

    def opening_text(self) -> str:
        return self.seller.opening().text

    def send_offer(self, price: Decimal, message: str) -> str:
        if self.seller.done:
            raise SellerClosed
        self.sent.append((price, message))
        reply = self.seller.respond(price)
        self.log.append(reply)
        return reply.text

    def send_message(self, message: str) -> str:
        """A question with no offer attached. It still uses up some of the seller's patience."""
        if self.seller.done:
            raise SellerClosed
        self.sent.append((None, message))
        reply = self.seller.respond(None)
        self.log.append(reply)
        return reply.text

    @classmethod
    def restore(cls, asking, persona, seed, turns, with_opening: bool = False):
        """Rebuild a simulator after a restart by replaying every turn already sent.

        `turns` is a list of prices, with None standing for a question.
        """
        seller = SimSeller(asking, persona, seed=seed)
        port = cls(seller)
        if with_opening:
            seller.opening()
        for turn in turns:
            if turn is None:
                port.send_message("(replayed)")
            else:
                port.send_offer(turn, "(replayed)")
        return port
    

class ScriptedSellerPort:
    """Replays fixed seller texts. For tests and demos where the wording matters."""

    def __init__(self, replies: list[str]):
        self.replies = list(replies)
        self.sent: list[tuple[Decimal | None, str]] = []

    def _next(self) -> str:
        if not self.replies:
            raise SellerClosed
        return self.replies.pop(0)

    def send_offer(self, price: Decimal, message: str) -> str:
        self.sent.append((price, message))
        return self._next()

    def send_message(self, message: str) -> str:
        self.sent.append((None, message))
        return self._next()


class CalendarError(Exception):
    """The calendar could not be reached or failed. The negotiation result is unaffected."""


class InMemoryCalendar:
    """Calendar for tests and offline runs. Same behaviour as the database one."""

    def __init__(self, taken: list[datetime] | None = None):
        self.taken: set[datetime] = set(taken or [])
        self.by_key: dict[str, datetime] = {}

    def propose_slots(self, count: int = 3, from_iso: str | None = None) -> list[str]:
        now = datetime.fromisoformat(from_iso) if from_iso else datetime.now(MYT)
        return [s.isoformat() for s in candidate_slots(now, self.taken, count)]

    def book_slot(self, booking_key: str, thread_id: str, start_at: str) -> dict:
        try:
            start = datetime.fromisoformat(start_at)
        except ValueError:
            return {"status": "invalid", "detail": "start_at is not an ISO datetime"}
        problem = validate_slot(start, datetime.now(MYT))
        if problem:
            return {"status": "invalid", "detail": problem}
        if booking_key in self.by_key:
            existing = self.by_key[booking_key]
            return {
                "status": "already_booked",
                "start_at": existing.isoformat(),
                "same_slot": existing == start,
            }
        if start in self.taken:
            return {"status": "slot_taken"}
        self.taken.add(start)
        self.by_key[booking_key] = start
        return {"status": "booked", "start_at": start.isoformat()}

    def cancel_booking(self, booking_key: str) -> dict:
        start = self.by_key.pop(booking_key, None)
        if start is None:
            return {"status": "not_found"}
        self.taken.discard(start)
        return {"status": "cancelled"}
    

class HumanStopped(Exception):
    """The human ended the negotiation instead of relaying a seller reply."""