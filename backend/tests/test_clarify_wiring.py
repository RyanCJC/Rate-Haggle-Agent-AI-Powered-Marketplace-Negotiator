import psycopg
import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from backend.app.api.main import create_app
from backend.app.api.runs import MemoryRuns
from backend.app.api.service import Service
from backend.app.graph.ports import InMemoryCalendar
from backend.app.knowledge.embed import HashEmbedder
from backend.app.knowledge.lookup import KnowledgeSearch
from backend.app.knowledge.retrieval import Doc, index_documents
from backend.app.settings import Settings
from backend.tests.test_api import start, wait_status

needs_db = pytest.mark.skipif(not Settings.load().database_url, reason="DATABASE_URL not set")


def make_app(**options):
    service = Service(InMemorySaver(), InMemoryCalendar(), MemoryRuns(), **options)
    return create_app(service, poll_interval=0.02, stream_seconds=1.0)


def tools_used(snap):
    return [e["tool"] for e in snap["trace"] if e["node"] == "clarify" and "tool" in e]


def evasive_runs(client, seeds=range(8)):
    for seed in seeds:
        run_id = start(client, persona="evasive", autonomy="auto", seed=seed)
        yield wait_status(client, run_id, {"finished", "failed"})


def test_the_default_service_still_does_not_use_tools():
    with TestClient(make_app()) as client:
        assert all(not tools_used(snap) for snap in evasive_runs(client))


def test_the_running_service_lets_the_agent_search_the_knowledge_base():
    calls = []

    def knowledge(query, category):
        calls.append((query, category))
        return ["monitors.md: Check for dead pixels."]

    with TestClient(make_app(clarify=True, knowledge=knowledge)) as client:
        snaps = list(evasive_runs(client))
    assert all(snap["status"] == "finished" for snap in snaps)
    assert any("search_knowledge" in tools_used(snap) for snap in snaps)
    assert calls


def test_a_broken_knowledge_search_never_fails_a_negotiation():
    bad_url = "postgresql://nobody:x@127.0.0.1:1/none?connect_timeout=2"
    search = KnowledgeSearch(bad_url, HashEmbedder)
    with TestClient(make_app(clarify=True, knowledge=search)) as client:
        snaps = list(evasive_runs(client))
    assert all(snap["status"] == "finished" for snap in snaps)
    assert search.failures > 0


def test_the_embedder_is_created_lazily_and_a_failure_is_contained():
    created = []

    def broken():
        created.append(1)
        raise RuntimeError("model download failed")

    search = KnowledgeSearch("postgresql://x", broken)
    assert created == []
    assert search("q", "monitors") == []
    assert search("q", "monitors") == []
    assert len(created) == 1  # not retried straight away
    assert search.failures == 2


@needs_db
def test_the_search_returns_passages_from_the_database():
    url = Settings.load().require_database_url()
    doc = Doc("zz_cat", "zz_lookup.md", "Check the widget hinge for cracks.")
    try:
        with psycopg.connect(url) as conn:
            index_documents(conn, [doc], HashEmbedder())
        found = KnowledgeSearch(url, HashEmbedder)("widget hinge", "zz_cat")
        assert any(passage.startswith("zz_lookup.md:") for passage in found)
    finally:
        with psycopg.connect(url) as conn:
            conn.execute("DELETE FROM knowledge_chunks WHERE source = 'zz_lookup.md'")