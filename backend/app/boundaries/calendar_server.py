"""Calendar boundary: the only way the agent reserves time.

Run it with:  python -m backend.app.boundaries.calendar_server   (needs DATABASE_URL)
Stdout is the protocol channel, so nothing in here may print.
"""

import functools
import json
import os

from mcp.server.mcpserver import MCPServer

from backend.app.boundaries.calendar_db import DbCalendar

mcp = MCPServer("haggle-calendar")


@functools.cache
def _calendar() -> DbCalendar:
    return DbCalendar(os.environ["DATABASE_URL"])


@mcp.tool()
def propose_slots(count: int = 3, from_iso: str | None = None) -> str:
    """List the earliest free pickup slots: hourly, starting 10:00 to 19:00 Malaysia time,
    at least 24 hours ahead. from_iso overrides 'now' (for tests)."""
    return json.dumps({"slots": _calendar().propose_slots(count, from_iso)})


@mcp.tool()
def book_slot(booking_key: str, thread_id: str, start_at: str) -> str:
    """Book a pickup slot (start_at is an ISO datetime with timezone).

    booking_key makes the call idempotent: booking again with the same key never creates a
    second booking and returns the slot the key already holds. Statuses: booked,
    already_booked, slot_taken, invalid."""
    return json.dumps(_calendar().book_slot(booking_key, thread_id, start_at))


@mcp.tool()
def cancel_booking(booking_key: str) -> str:
    """Cancel the booking held by this key. Cancelling twice is harmless (not_found)."""
    return json.dumps(_calendar().cancel_booking(booking_key))


if __name__ == "__main__":
    mcp.run()