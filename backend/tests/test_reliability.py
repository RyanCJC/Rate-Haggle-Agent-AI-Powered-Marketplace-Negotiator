import asyncio
import os

import psycopg
import pytest
from dotenv import load_dotenv

from backend.app.api.main import checkpoint_pool, stream
from backend.app.api.service import NotFound

load_dotenv()
needs_db = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")


class FakeRequest:
    async def is_disconnected(self) -> bool:
        return False


class VanishingService:
    """Answers once, then behaves like a run that was deleted."""

    def __init__(self):
        self.calls = 0

    def snapshot(self, run_id: str) -> dict:
        self.calls += 1
        if self.calls > 1:
            raise NotFound(run_id)
        return {"trace": [{"node": "plan"}], "status": "running", "question": None}


def collect(service) -> list[str]:
    async def run():
        return [chunk async for chunk in stream(FakeRequest(), service, "r1", 0, 0.01, 5)]

    return asyncio.run(run())


def test_stream_ends_cleanly_when_the_run_is_deleted():
    chunks = collect(VanishingService())
    assert "event: trace" in chunks[0]
    assert chunks[-1].startswith("event: done")
    assert '"lost"' in chunks[-1]


def test_stream_still_ends_normally_for_a_finished_run():
    class Finished:
        def snapshot(self, run_id: str) -> dict:
            return {"trace": [], "status": "finished", "question": None}

    chunks = collect(Finished())
    assert len(chunks) == 1 and '"finished"' in chunks[0]


@needs_db
def test_the_pool_replaces_a_connection_the_database_closed():
    url = os.environ["DATABASE_URL"]
    with checkpoint_pool(url) as pool:
        with pool.connection() as conn:
            pid = conn.info.backend_pid
        with psycopg.connect(url, autocommit=True) as killer:
            killer.execute("select pg_terminate_backend(%s)", (pid,))
        with pool.connection() as conn:  # the dead connection is detected and replaced
            assert conn.execute("select 1 as one").fetchone()["one"] == 1