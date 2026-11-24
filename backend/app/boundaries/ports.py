import json
from datetime import datetime
from decimal import Decimal

from langgraph.types import interrupt

from backend.app.core.calendar_rules import MYT, candidate_slots, validate_slot
from backend.app.graph.ports import HumanStopped, SellerClosed

from .session import McpSession


class McpSellerPort:
    """Seller port that talks to the marketplace MCP server. Same interface as SimSellerPort."""

    def __init__(
        self,
        session: McpSession,
        conversation_id: str,
        asking: Decimal,
        persona: str,
        seed: int = 0,
        replay: list[Decimal | None] | tuple = (),
    ):
        self.session = session
        self.conversation_id = conversation_id
        self.turn = len(replay)  # the next turn number; continues where a restart left off
        reply = session.call(
            "open_conversation",
            conversation_id=conversation_id,
            asking=str(asking),
            persona=persona,
            seed=seed,
            replay_json=json.dumps([None if t is None else str(t) for t in replay]),
        )
        self.opening = reply["opening"]

    def opening_text(self) -> str | None:
        return self.opening

    def send_offer(self, price: Decimal, message: str) -> str:
        reply = self.session.call(
            "send_offer",
            conversation_id=self.conversation_id,
            turn=self.turn,
            price=str(price),
            message=message,
        )
        return self._finish(reply)

    def send_message(self, message: str) -> str:
        reply = self.session.call(
            "send_message", conversation_id=self.conversation_id, turn=self.turn, message=message
        )
        return self._finish(reply)

    def _finish(self, reply: dict) -> str:
        if reply["closed"]:
            raise SellerClosed
        self.turn += 1
        return reply["text"]


class ApprovedMcpSellerPort:
    """Seller port for Copilot marketplace mode: pauses at the seller_reply gate for human
    approval before every outgoing draft, then sends through the MCP marketplace server.

    Satisfies the SellerPort protocol: opening_text, send_offer, send_message. Wraps an
    McpSellerPort and adds interrupt + resume, mirroring ManualSellerPort.
    """

    def __init__(
        self,
        session: McpSession,
        conversation_id: str,
        asking: Decimal,
        persona: str,
        seed: int = 0,
        replay: list[Decimal | None] | tuple = (),
    ):
        self._inner = McpSellerPort(
            session=session,
            conversation_id=conversation_id,
            asking=asking,
            persona=persona,
            seed=seed,
            replay=replay,
        )
        self.sent_text: str | None = None

    def opening_text(self) -> str | None:
        return self._inner.opening_text()

    def _ask(self, kind: str, price, draft: str) -> str:
        self.sent_text = None  # reset so an edit from an earlier turn is never reused
        answer = interrupt(
            {
                "gate": "seller_reply",
                "kind": kind,
                "price": None if price is None else str(price),
                "draft": draft,
                "channel": "marketplace",
            }
        )
        if not isinstance(answer, dict) or answer.get("action") not in ("reply", "stop"):
            raise ValueError("a seller reply or a stop is needed here")
        if answer["action"] == "stop":
            raise HumanStopped
        self.sent_text = (answer.get("sent_text") or "").strip() or None
        return str(answer.get("reply", ""))

    def send_offer(self, price: Decimal, message: str) -> str:
        self._ask("offer", price, message)
        actual = self.sent_text if self.sent_text is not None else message
        return self._inner.send_offer(price, actual)

    def send_message(self, message: str) -> str:
        self._ask("question", None, message)
        actual = self.sent_text if self.sent_text is not None else message
        return self._inner.send_message(actual)


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