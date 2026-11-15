from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import json
import sys
import threading
from pathlib import Path
from typing import Self

from mcp import Client, StdioServerParameters

ROOT = Path(__file__).resolve().parents[3]  # repo root
LIST_TOOLS = "__list_tools__"


class McpToolError(RuntimeError):
    """The tool ran and failed (a bad argument, an out-of-order turn, a timeout)."""


class McpSession:
    """A synchronous handle on one MCP server running as a child process.

    The graph is synchronous and MCP is async, so one background thread owns an event loop,
    and one long-lived task owns the connection (anyio requires a connection to be opened and
    closed by the same task). Callers hand it work through a queue.
    """

    def __init__(self, module: str, timeout: float = 30.0, env: dict[str, str] | None = None):
        self._params = StdioServerParameters(
            command=sys.executable,
            args=["-m", module],
            env={"PYTHONPATH": str(ROOT), **(env or {})},  # nothing else: no secrets by default
            cwd=str(ROOT),
        )
        self._timeout = timeout
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, daemon=True)
        self._ready: concurrent.futures.Future = concurrent.futures.Future()
        self._queue: asyncio.Queue | None = None
        self._main: concurrent.futures.Future | None = None

    def start(self) -> Self:
        self._thread.start()
        self._main = asyncio.run_coroutine_threadsafe(self._run(), self._loop)
        self._ready.result(timeout=self._timeout)
        return self

    async def _run(self) -> None:
        self._queue = asyncio.Queue()
        try:
            async with Client(self._params) as client:
                self._ready.set_result(None)
                while True:
                    item = await self._queue.get()
                    if item is None:
                        break
                    tool, arguments, future = item
                    try:
                        future.set_result(await self._invoke(client, tool, arguments))
                    except Exception as error:  # noqa: BLE001 - the caller gets every failure
                        future.set_exception(error)
        except Exception as error:  # noqa: BLE001 - a failed start is reported to start()
            if not self._ready.done():
                self._ready.set_exception(error)

    @staticmethod
    async def _invoke(client: Client, tool: str, arguments: dict):
        if tool == LIST_TOOLS:
            return [t.name for t in (await client.list_tools()).tools]
        result = await client.call_tool(tool, arguments)
        text = result.content[0].text if result.content else ""
        if result.is_error:
            raise McpToolError(f"{tool}: {text}")
        return json.loads(text)

    def call(self, tool: str, **arguments):
        future: concurrent.futures.Future = concurrent.futures.Future()
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (tool, arguments, future))
        try:
            return future.result(timeout=self._timeout)
        except TimeoutError as error:
            raise McpToolError(f"{tool}: no reply within {self._timeout}s") from error

    def tools(self) -> list[str]:
        return self.call(LIST_TOOLS)

    def close(self) -> None:
        if self._queue is not None and self._main is not None and not self._main.done():
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)
            with contextlib.suppress(Exception):
                self._main.result(timeout=self._timeout)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=5)

    def __enter__(self) -> Self:
        return self.start()

    def __exit__(self, *exc) -> None:
        self.close()