import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from langgraph.checkpoint.postgres import PostgresSaver
from starlette.middleware.cors import CORSMiddleware

from backend.app.api.runs import PgRuns
from backend.app.api.schemas import Decision, StartRequest
from backend.app.api.service import Conflict, NotFound, Service
from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.boundaries.session import McpSession
from backend.app.llm.client import LLMClient
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona

CALENDAR = "backend.app.boundaries.calendar_server"
STREAM_SECONDS = 900  # one stream never lives longer than this; the client reconnects
ENDING = {"finished", "failed", "lost", "stalled"}


def call(fn, *args):
    """Run a service call and turn its errors into HTTP errors."""
    try:
        return fn(*args)
    except NotFound:
        raise HTTPException(404, "unknown negotiation") from None
    except Conflict as error:
        raise HTTPException(409, str(error)) from None


def sse(name: str, data, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {name}\ndata: {json.dumps(jsonable_encoder(data))}\n\n"


async def stream(
    request: Request, service: Service, run_id: str, start: int, interval: float, seconds: float
):
    sent, announced = start, None
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if await request.is_disconnected():
            return
        snap = await run_in_threadpool(service.snapshot, run_id)
        trace = snap["trace"]
        while sent < len(trace):
            yield sse("trace", trace[sent], sent)
            sent += 1
        if snap["status"] == "waiting_for_approval" and announced != sent:
            announced = sent
            yield sse("gate", snap["question"])
        if snap["status"] in ENDING:
            yield sse("done", {"status": snap["status"]})
            return
        await asyncio.sleep(interval)


def create_app(
    service: Service | None = None,
    poll_interval: float = 0.4,
    stream_seconds: float = STREAM_SECONDS,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if service is not None:
            app.state.service = service
            yield
            return
        load_dotenv()
        url = os.environ["DATABASE_URL"]
        live = os.getenv("HAGGLE_LLM") == "live"
        with (
            PostgresSaver.from_conn_string(url) as saver,
            McpSession(CALENDAR, env={"DATABASE_URL": url}) as session,
        ):
            saver.setup()
            app.state.service = Service(
                saver,
                McpCalendarPort(session),
                PgRuns(url),
                llm_factory=LLMClient if live else RuleBasedLLM,
            )
            yield

    app = FastAPI(title="Haggle", lifespan=lifespan)
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"],
                       allow_headers=["*"])

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/negotiations", status_code=201)
    def start(body: StartRequest, request: Request):
        try:
            get_persona(body.persona)
        except Exception:  # noqa: BLE001 - any lookup failure means an unknown persona
            raise HTTPException(422, f"unknown persona: {body.persona}") from None
        config = {
            "asking": str(body.asking),
            "budget": str(body.budget),
            "persona": body.persona,
            "style": body.style,
            "autonomy": body.autonomy,
            "seed": body.seed,
        }
        return {"id": request.app.state.service.start(config)}

    @app.get("/negotiations/{run_id}")
    def snapshot(run_id: str, request: Request):
        return call(request.app.state.service.snapshot, run_id)

    @app.post("/negotiations/{run_id}/decision", status_code=202)
    def decision(run_id: str, body: Decision, request: Request):
        call(request.app.state.service.decide_run, run_id, body.verdict)
        return {"accepted": True}

    @app.post("/negotiations/{run_id}/resume", status_code=202)
    def resume(run_id: str, request: Request):
        call(request.app.state.service.resume_run, run_id)
        return {"accepted": True}

    @app.get("/negotiations/{run_id}/events")
    async def events(run_id: str, request: Request):
        svc = request.app.state.service
        await run_in_threadpool(call, svc.snapshot, run_id)  # 404 before streaming starts
        last = request.headers.get("last-event-id", "")
        first = int(last) + 1 if last.isdigit() else 0
        return StreamingResponse(
            stream(request, svc, run_id, first, poll_interval, stream_seconds),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache"},
        )

    return app


app = create_app()