from __future__ import annotations

import asyncio
import concurrent.futures
import contextlib
import json
import sys
import threading
import time
from pathlib import Path
from typing import Self

from mcp import Client, StdioServerParameters

from backend.app.boundaries.recorder import CallRecorder
from backend.app.logs import run_id_var

ROOT = Path(__file__).resolve().parents[3]  # repo root
LIST_TOOLS = "__list_tools__"
LIST_TOOLS_FULL = "__list_tools_full__"

# Inspection tools are not recorded: they would pollute the call log with noise.
UNLOGGED = {"get_conversation"}


class McpToolError(RuntimeError):
    """The tool ran and failed (a bad argument, an out-of-order turn, a timeout)."""


class McpSession:
    """A synchronous handle on one MCP server running as a child process.

    The graph is synchronous and MCP is async, so one background thread owns an event loop,
    and one long-lived task owns the connection (anyio requires a connection to be opened and
    closed by the same task). Callers hand it work through a queue.
    """

    def __init__(
        self,
        module: str,
        timeout: float = 30.0,
        env: dict[str, str] | None = None,
        recorder: CallRecorder | None = None,
    ):
        self._params = StdioServerParameters(
            command=sys.executable,
            args=["-m", module],
            env={"PYTHONPATH": str(ROOT), **(env or {})},  # nothing else: no secrets by default
            cwd=str(ROOT),
        )
        # Last dotted part of the module, with the trailing "_server" stripped:
        # backend.app.boundaries.calendar_server -> "calendar"
        self._server = module.rsplit(".", 1)[-1].removesuffix("_server")
        self._timeout = timeout
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, daemon=True)
        self._ready: concurrent.futures.Future = concurrent.futures.Future()
        self._queue: asyncio.Queue | None = None
        self._main: concurrent.futures.Future | None = None
        self._recorder = recorder

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
        if tool == LIST_TOOLS_FULL:
            tools = []
            for t in (await client.list_tools()).tools:
                schema = t.input_schema or {}
                props = schema.get("properties", {}) or {}
                required = set(schema.get("required", []) or [])
                params = [
                    {
                        "name": name,
                        "type": prop.get("type") or "any",
                        "required": name in required,
                    }
                    for name, prop in props.items()
                ]
                tools.append(
                    {"name": t.name, "description": t.description or "", "params": params}
                )
            return tools
        result = await client.call_tool(tool, arguments)
        text = result.content[0].text if result.content else ""
        if result.is_error:
            raise McpToolError(f"{tool}: {text}")
        return json.loads(text)

    def _record(
        self,
        tool: str,
        arguments: dict,
        ok: bool,
        ms: int,
        error: str | None,
    ) -> None:
        if self._recorder is None:
            return
        run_id = run_id_var.get()
        if run_id == "-":
            run_id = None
        self._recorder.record(
            run_id=run_id,
            server=self._server,
            tool=tool,
            ok=ok,
            ms=ms,
            error=error,
            arguments=arguments,
        )

    def call(self, tool: str, **arguments):
        if tool in UNLOGGED:
            # Inspection tools are deliberately not recorded (avoids polling noise).
            future: concurrent.futures.Future = concurrent.futures.Future()
            self._loop.call_soon_threadsafe(self._queue.put_nowait, (tool, arguments, future))
            return future.result(timeout=self._timeout)
        start = time.monotonic()
        future: concurrent.futures.Future = concurrent.futures.Future()
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (tool, arguments, future))
        try:
            result = future.result(timeout=self._timeout)
        except BaseException as error:
            ms = int((time.monotonic() - start) * 1000)
            self._record(tool, arguments, ok=False, ms=ms, error=type(error).__name__)
            if isinstance(error, TimeoutError):
                raise McpToolError(f"{tool}: no reply within {self._timeout}s") from error
            raise
        ms = int((time.monotonic() - start) * 1000)
        self._record(tool, arguments, ok=True, ms=ms, error=None)
        return result

    def tools(self) -> list[str]:
        return self.call(LIST_TOOLS)

    def list_tools(self) -> list[dict]:
        """Return full tool descriptors (name, description, params) without recording.

        Uses the same queue/loop as call() but bypasses the recorder so polling
        /connections does not flood the call log.
        """
        future: concurrent.futures.Future = concurrent.futures.Future()
        self._loop.call_soon_threadsafe(
            self._queue.put_nowait, (LIST_TOOLS_FULL, {}, future)
        )
        try:
            return future.result(timeout=self._timeout)
        except TimeoutError as error:
            raise McpToolError(f"list_tools: no reply within {self._timeout}s") from error

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
