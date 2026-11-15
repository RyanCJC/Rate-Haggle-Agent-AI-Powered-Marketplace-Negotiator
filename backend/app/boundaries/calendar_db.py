from datetime import datetime

import psycopg

from backend.app.core.calendar_rules import MYT, candidate_slots, validate_slot
from backend.app.graph.ports import CalendarError


class DbCalendar:
    """Calendar on Postgres. The database enforces uniqueness, not this code.

    Two unique indexes do the work: one slot can hold one booking, and one booking key can
    hold one slot. INSERT ... ON CONFLICT DO NOTHING makes a race or a retry harmless.
    """

    def __init__(self, database_url: str):
        self.url = database_url

    def propose_slots(self, count: int = 3, from_iso: str | None = None) -> list[str]:
        now = datetime.fromisoformat(from_iso) if from_iso else datetime.now(MYT)
        try:
            with psycopg.connect(self.url) as conn:
                rows = conn.execute(
                    "SELECT start_at FROM calendar_slots WHERE start_at >= %s", (now,)
                ).fetchall()
        except psycopg.Error as error:
            raise CalendarError(str(error)) from error
        return [s.isoformat() for s in candidate_slots(now, {r[0] for r in rows}, count)]

    def book_slot(self, booking_key: str, thread_id: str, start_at: str) -> dict:
        try:
            start = datetime.fromisoformat(start_at)
        except ValueError:
            return {"status": "invalid", "detail": "start_at is not an ISO datetime"}
        problem = validate_slot(start, datetime.now(MYT))
        if problem:
            return {"status": "invalid", "detail": problem}
        try:
            with psycopg.connect(self.url) as conn:
                inserted = conn.execute(
                    "INSERT INTO calendar_slots (start_at, booking_key, thread_id) "
                    "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING RETURNING id",
                    (start, booking_key, thread_id),
                ).fetchone()
                if inserted:
                    return {"status": "booked", "start_at": start.isoformat()}
                mine = conn.execute(
                    "SELECT start_at FROM calendar_slots WHERE booking_key = %s", (booking_key,)
                ).fetchone()
        except psycopg.Error as error:
            raise CalendarError(str(error)) from error
        if mine:  # a retry: this key already holds a slot
            return {
                "status": "already_booked",
                "start_at": mine[0].isoformat(),
                "same_slot": mine[0] == start,
            }
        return {"status": "slot_taken"}  # the slot belongs to someone else

    def cancel_booking(self, booking_key: str) -> dict:
        try:
            with psycopg.connect(self.url) as conn:
                row = conn.execute(
                    "DELETE FROM calendar_slots WHERE booking_key = %s RETURNING id",
                    (booking_key,),
                ).fetchone()
        except psycopg.Error as error:
            raise CalendarError(str(error)) from error
        return {"status": "cancelled" if row else "not_found"}