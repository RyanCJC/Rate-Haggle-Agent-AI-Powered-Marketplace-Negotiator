"""Thread-safe ring buffer of MCP call records.

Never records message content (prices, turn numbers, server/tool names only).
Argument whitelist: `turn`, `price`, `start`, `slot`, `kind`, plus `conversation`
(first 8 chars of the conversation_id). Anything else is dropped, never summarized.
"""

from __future__ import annotations

import threading
from collections import deque
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

# Argument names the recorder is allowed to keep. Anything not in this set is
# dropped, never summarized. message/asking/budget/URLs/keys are never recorded.
WHITELISTED_ARGS = {"turn", "price", "start", "slot", "kind", "start_at", "from_iso", "count"}


def _whitelist_args(arguments: dict) -> dict:
    kept: dict = {}
    for name in WHITELISTED_ARGS:
        if name not in arguments:
            continue
        value = arguments[name]
        if name == "price":
            try:
                kept[name] = float(Decimal(str(value)))
            except (ValueError, TypeError, InvalidOperation):
                pass  # non-numeric prices are dropped, never recorded
            continue
        kept[name] = value
    if "conversation_id" in arguments:
        kept["conversation"] = str(arguments["conversation_id"])[:8]
    return kept


class CallRecorder:
    """Fixed-size ring buffer of MCP call records, oldest-first."""

    def __init__(self, maxlen: int = 500):
        self._lock = threading.Lock()
        self._buffer: deque = deque(maxlen=maxlen)

    def record(
        self,
        run_id: str | None,
        server: str,
        tool: str,
        ok: bool,
        ms: int,
        error: str | None,
        arguments: dict,
    ) -> None:
        entry = {
            "ts": datetime.now(UTC).isoformat(),
            "run": run_id,
            "server": server,
            "tool": tool,
            "ok": ok,
            "ms": ms,
            "error": error,
            "args": _whitelist_args(arguments),
        }
        with self._lock:
            self._buffer.append(entry)

    def for_run(self, run_id: str) -> list[dict]:
        with self._lock:
            return [entry for entry in self._buffer if entry["run"] == run_id]

    def recent(self) -> list[dict]:
        with self._lock:
            return list(self._buffer)