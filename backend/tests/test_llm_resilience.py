import logging
import os
import threading
import time
from decimal import Decimal
from types import SimpleNamespace

import httpx2
import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from openai import APIStatusError, APITimeoutError
from pydantic import BaseModel

from backend.app.api.main import create_app
from backend.app.api.runs import MemoryRuns
from backend.app.api.service import Service
from backend.app.boundaries.recorder import CallRecorder
from backend.app.boundaries.session import McpSession
from backend.app.core.models import NegotiationContext, Phase
from backend.app.core.strategy import StrategyDecision
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.nodes import check_draft, fallback_message
from backend.app.graph.ports import InMemoryCalendar, SimSellerPort
from backend.app.llm.client import LLMClient, LLMRejectedError, LLMUnavailableError
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

MARKETPLACE = "backend.app.boundaries.marketplace_server"
ASKING = Decimal(1200)
BUDGET = Decimal(1000)


class Answer(BaseModel):
    a: int


def _http_error(status_code: int, message: str = "boom", retry_after: str | None = None):
    req = httpx2.Request("POST", "http://x")
    headers = {}
    if retry_after is not None:
        headers["retry-after"] = retry_after
    response = httpx2.Response(status_code, request=req, headers=headers)
    return APIStatusError(message, response=response, body=None)


class CapturingOpenAI:
    """Fake OpenAI client: queue of replies or exceptions; records prompts and injected sleeps."""

    def __init__(self, queue, sleeps, prompts):
        self.queue = list(queue)
        self.sleeps = sleeps
        self.prompts = prompts

    def create(self, **kwargs):
        self.prompts.append(kwargs.get("messages"))
        item = self.queue.pop(0) if self.queue else '{"a": 1}'
        if isinstance(item, BaseException):
            raise item
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=item))],
            usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3),
        )


def make_client(queue, sleeps, prompts, max_retries=3, timeout=5.0):
    fake = CapturingOpenAI(queue, sleeps, prompts)
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=fake.create)))
    clock_t = [0.0]

    def now():
        return clock_t[0]

    def record_sleep(delay):
        sleeps.append(delay)
        # advance fake time so the 13/minute rate-limit window drains in tests
        clock_t[0] += delay + 0.01

    return LLMClient(model="m", client=client, max_retries=max_retries, timeout=timeout,
                     sleep=record_sleep, clock=now)


# ---------------------------------------------------------------- client level

def test_503_twice_then_success_uses_two_retries():
    sleeps, prompts = [], []
    queue = [_http_error(503), _http_error(503)] + ['{"a": 1}'] * 5
    llm = make_client(queue, sleeps, prompts)
    assert llm.complete_json("sys", "u", Answer, task="compose").a == 1
    assert len(sleeps) == 2  # exactly two retries happened
    assert all(delay > 0 for delay in sleeps)


def test_503_always_stops_at_the_limit():
    sleeps = []
    llm = make_client([_http_error(503)] * 4, sleeps, [], max_retries=3)
    with pytest.raises(LLMUnavailableError):
        llm.complete_json("sys", "u", Answer, task="compose")
    assert len(sleeps) == 3  # three retries, then the last attempt raises


def test_timeout_is_transient():
    sleeps = []
    llm = make_client([APITimeoutError(httpx2.Request("POST", "http://x")), '{"a": 1}'], sleeps, [])
    assert llm.complete_json("sys", "u", Answer, task="compose").a == 1
    assert len(sleeps) == 1


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_rejected_statuses_are_not_retried(status):
    sleeps = []
    llm = make_client([_http_error(status)], sleeps, [])
    with pytest.raises(LLMRejectedError):
        llm.complete_json("sys", "u", Answer, task="compose")
    assert sleeps == []  # no retry at all


def test_retry_after_is_honoured_by_the_injected_sleep():
    sleeps = []
    response = httpx2.Response(503, request=httpx2.Request("POST", "http://x"),
                               headers={"retry-after": "7"})
    llm = make_client([APIStatusError("x", response=response, body=None), '{"a": 1}'], sleeps, [])
    assert llm.complete_json("sys", "u", Answer, task="compose").a == 1
    assert sleeps == [7.0]


def test_no_budget_in_retry_logs_or_prompts(caplog):
    sleeps, prompts = [], []
    queue = [_http_error(503), _http_error(503)] + ['{"message": "How about RM 800?"}'] * 10
    llm = make_client(queue, sleeps, prompts)
    port = SimSellerPort(SimSeller(ASKING, get_persona("flexible"), seed=0))
    with caplog.at_level(logging.WARNING, logger="haggle.llm"):
        run_graph(build_graph(llm, port), ASKING, BUDGET, opening_text=port.opening_text())
    retry_logs = [rec.getMessage() for rec in caplog.records if "retrying" in rec.getMessage()]
    assert retry_logs, "expected retry warning lines"
    assert all("1000" not in line for line in retry_logs)
    assert all("1000" not in str(prompt) for prompt in prompts)


# ---------------------------------------------------------------- service level

def make(llm, marketplace=None, recorder=None):
    saver = InMemorySaver()
    runs = MemoryRuns()
    calendar = InMemoryCalendar()
    service = Service(saver, calendar, runs, llm_factory=lambda: llm,
                      marketplace=marketplace, recorder=recorder)
    return create_app(service, poll_interval=0.02, stream_seconds=1.0), saver, runs, calendar


def start(client, **overrides):
    body = {"asking": 1200, "budget": 1000, "persona": "flexible", "autonomy": "auto", **overrides}
    response = client.post("/negotiations", json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def wait_status(client, run_id, wanted, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get(f"/negotiations/{run_id}").json()
        if snap["status"] in wanted:
            return snap
        time.sleep(0.02)
    raise AssertionError(f"still {snap['status']!r}, wanted {wanted}")


# After a failed run is retried, the snapshot keeps reporting "failed" (stale error) until the
# retry drive completes and clears the error. Wait for the clear instead.
def wait_recovered(client, run_id, timeout=30):
    deadline = time.monotonic() + timeout
    snap = {}
    while time.monotonic() < deadline:
        snap = client.get(f"/negotiations/{run_id}").json()
        if snap.get("error_kind") is None:
            return snap
        time.sleep(0.02)
    raise AssertionError(f"run did not recover: {snap!r}")


class ExtractFails(RuleBasedLLM):
    """Reading the seller's reply always fails after retries."""

    def complete_json(self, system, user, schema, task=""):
        if task == "extract":
            raise LLMUnavailableError("unavailable")
        return super().complete_json(system, user, schema, task)


class ExtractFailsOnce(RuleBasedLLM):
    """The first read of the seller's reply fails, the next one works."""

    def __init__(self):
        super().__init__()
        self.failures = 0

    def complete_json(self, system, user, schema, task=""):
        if task == "extract" and self.failures == 0:
            self.failures += 1
            raise LLMUnavailableError("call failed after 3 attempts: APIStatusError")
        return super().complete_json(system, user, schema, task)


def test_ingest_failure_fails_the_run_with_llm_unavailable():
    llm = ExtractFails()
    app, _, _, _ = make(llm)
    with TestClient(app) as client:
        run_id = start(client)
        done = wait_status(client, run_id, {"failed"})
    assert done["status"] == "failed"
    assert done["error_kind"] == "llm_unavailable"
    assert done["error"] == ("The AI model was unavailable. Nothing was sent to the seller. "
                             "Your progress is saved.")
    assert "UnavailableError" not in done["error"]
    assert "APIStatusError" not in done["error"]


def test_retry_resumes_a_failed_run_and_completes():
    llm = ExtractFailsOnce()
    app, _, _, _ = make(llm)
    with TestClient(app) as client:
        run_id = start(client)
        done = wait_status(client, run_id, {"failed"})
        assert done["error_kind"] == "llm_unavailable"
        assert client.post(f"/negotiations/{run_id}/retry").status_code == 202
        finished = wait_recovered(client, run_id)
    assert finished["status"] == "finished"
    assert finished["outcome"] in ("deal", "we_walk", "seller_walks")
    assert finished["error_kind"] is None
    assert finished["error"] is None


def test_retry_409_for_finished_and_unknown_and_non_retryable():
    llm = RuleBasedLLM()
    app, _, _, _ = make(llm)
    with TestClient(app) as client:
        run_id = start(client)
        wait_status(client, run_id, {"finished"})
        assert client.post(f"/negotiations/{run_id}/retry").status_code == 409
        assert client.post("/negotiations/does-not-exist/retry").status_code == 404

    class RejectedExtract(RuleBasedLLM):
        def complete_json(self, system, user, schema, task=""):
            if task == "extract":
                raise LLMRejectedError("400 bad request")
            return super().complete_json(system, user, schema, task)

    app, _, _, _ = make(RejectedExtract())
    with TestClient(app) as client:
        run_id = start(client)
        done = wait_status(client, run_id, {"failed"})
        assert done["error_kind"] == "llm_rejected"
        assert client.post(f"/negotiations/{run_id}/retry").status_code == 409


def test_retry_409_while_a_run_is_busy():
    block = threading.Event()

    class Blocking(RuleBasedLLM):
        def complete_json(self, system, user, schema, task=""):
            block.wait(5)
            return super().complete_json(system, user, schema, task)

    llm = Blocking()
    app, _, _, _ = make(llm)
    with TestClient(app) as client:
        run_id = start(client)
        snap = None
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            snap = client.get(f"/negotiations/{run_id}").json()
            if snap["status"] == "running":
                break
            time.sleep(0.02)
        assert snap is not None and snap["status"] == "running", snap
        assert client.post(f"/negotiations/{run_id}/retry").status_code == 409
        block.set()
        wait_status(client, run_id, {"finished", "failed"})


def test_two_concurrent_retries_run_the_graph_once():
    llm = ExtractFailsOnce()
    app, _, _, _ = make(llm)
    with TestClient(app) as client:
        run_id = start(client)
        wait_status(client, run_id, {"failed"})
        results: list[int] = []

        def post():
            results.append(client.post(f"/negotiations/{run_id}/retry").status_code)

        t1 = threading.Thread(target=post)
        t2 = threading.Thread(target=post)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
        assert sorted(results) == [202, 409], results
        finished = wait_recovered(client, run_id)
    assert finished["status"] == "finished"
    assert llm.failures == 1  # the failed node ran exactly once more (the resume)


# ---------------------------------------------------------------- marketplace channel

@pytest.fixture
def mcp_session():
    old = os.environ.get("MARKETPLACE_CHANNEL")
    os.environ["MARKETPLACE_CHANNEL"] = "on"
    recorder = CallRecorder()
    try:
        with McpSession(MARKETPLACE, recorder=recorder) as session:
            yield session, recorder
    finally:
        if old is None:
            os.environ.pop("MARKETPLACE_CHANNEL", None)
        else:
            os.environ["MARKETPLACE_CHANNEL"] = old


def test_marketplace_retry_does_not_resend_the_draft(mcp_session):
    session, recorder = mcp_session
    llm = ExtractFailsOnce()
    app, _, _, _ = make(llm, marketplace=session, recorder=recorder)
    with TestClient(app) as client:
        body = {"asking": 1200, "budget": 1000, "persona": "flexible", "mode": "copilot",
                "channel": "marketplace", "autonomy": "auto"}
        response = client.post("/negotiations", json=body)
        assert response.status_code == 201, response.text
        run_id = response.json()["id"]
        snap = wait_status(client, run_id, {"waiting_for_approval"})
        assert snap["question"]["gate"] == "seller_reply"
        assert client.post(f"/negotiations/{run_id}/send", json={}).status_code == 202
        done = wait_status(client, run_id, {"failed"})
        assert done["error_kind"] == "llm_unavailable"
        sends = [c for c in recorder.for_run(run_id)
                 if c["tool"] in ("send_offer", "send_message")]
        assert len(sends) == 1 and sends[0]["ok"] is True
        assert client.post(f"/negotiations/{run_id}/retry").status_code == 202
        wait_recovered(client, run_id)
        sends = [c for c in recorder.for_run(run_id)
                 if c["tool"] in ("send_offer", "send_message")]
        assert len(sends) == 1  # the retry did not repeat the already-sent draft


# ---------------------------------------------------------------- Step 4 fallback

def test_compose_falls_back_to_template_with_the_planned_price():
    class ComposeAlwaysUnavailable(RuleBasedLLM):
        def complete_json(self, system, user, schema, task=""):
            if task == "compose":
                raise LLMUnavailableError("unavailable")
            return super().complete_json(system, user, schema, task)

    seller = SimSeller(ASKING, get_persona("flexible"), seed=0)
    port = SimSellerPort(seller)
    final = run_graph(build_graph(ComposeAlwaysUnavailable(), port), ASKING, BUDGET,
                      opening_text=port.opening_text())
    compose_entries = [t for t in final["trace"] if t["node"] == "compose"]
    assert compose_entries and compose_entries[-1].get("fallback") == "llm_unavailable"
    assert port.sent, "the fallback draft was sent to the seller"
    message = port.sent[-1][1]
    import re as _re
    match = _re.search(r"RM\s*([\d,]+(?:\.\d+)?)", message)
    assert match, f"no price in fallback message: {message!r}"
    price_from_msg = Decimal(match.group(1).replace(",", ""))
    plan_prices = [Decimal(t["price"]) for t in final["trace"] if t["node"] == "plan"]
    assert price_from_msg in plan_prices, f"{price_from_msg} not in {plan_prices}"
    assert message == fallback_message(StrategyDecision(kind="offer", price=price_from_msg))
    ctx = NegotiationContext(max_budget=BUDGET, asking_price=ASKING,
                             current_offer=price_from_msg, seller_last_price=ASKING, phase=Phase.NEGOTIATING)
    assert check_draft(StrategyDecision(kind="offer", price=price_from_msg), message, ctx) == []
