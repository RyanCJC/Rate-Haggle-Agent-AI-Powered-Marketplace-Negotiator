from backend.app.graph.ports import CalendarError

from .session import McpSession, McpToolError


class McpCalendarPort:
    """Calendar port that talks to the calendar MCP server. Same interface as the others."""

    def __init__(self, session: McpSession):
        self.session = session

    def _call(self, tool: str, **arguments) -> dict:
        try:
            return self.session.call(tool, **arguments)
        except McpToolError as error:
            raise CalendarError(str(error)) from error

    def propose_slots(self, count: int = 3, from_iso: str | None = None) -> list[str]:
        arguments: dict = {"count": count}
        if from_iso:
            arguments["from_iso"] = from_iso
        return self._call("propose_slots", **arguments)["slots"]

    def book_slot(self, booking_key: str, thread_id: str, start_at: str) -> dict:
        return self._call(
            "book_slot", booking_key=booking_key, thread_id=thread_id, start_at=start_at
        )

    def cancel_booking(self, booking_key: str) -> dict:
        return self._call("cancel_booking", booking_key=booking_key)