import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from backend.app.graph.builder import build_graph, make_config, run_graph
from backend.app.graph.control import (
    approve,
    current_state,
    decide,
    pending,
    question_of,
    waiting_for,
)
from backend.app.graph.manual import ManualSellerPort
from backend.app.graph.nodes import check_draft, context, decision_of
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller


class NotFound(Exception):
    """No such negotiation."""


class Conflict(Exception):
    """The request is valid but not possible right now."""


class Rejected(Exception):
    """The request was refused by the message rules; `messages` says why."""

    def __init__(self, messages: list[str]):
        super().__init__("; ".join(messages))
        self.messages = messages


def listing_of(config: dict) -> tuple[dict | None, list[Decimal] | None]:
    """What the graph is told about the item. Copilot always gets a listing, even an empty one:
    then every item detail is unknown, so the agent states none."""
    if config.get("mode", "simulate") != "copilot":
        return None, None
    listing = {
        "title": config.get("item_title") or "",
        "description": config.get("listing_text") or "",
        "category": config.get("category") or "",
    }
    comparables = [Decimal(c) for c in config.get("comparables") or []] or None
    return listing, comparables

class Service:
    """Runs negotiations in the background. All state lives in the checkpointer and the
    runs store, never in this object, so a restarted server loses nothing."""

    def __init__(self, saver, calendar, runs, llm_factory=RuleBasedLLM, workers: int = 8):
        self.saver = saver
        self.calendar = calendar
        self.runs = runs
        self.llm = llm_factory()
        self._pool = ThreadPoolExecutor(max_workers=workers)
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}
        self._busy: set[str] = set()
        self._errors: dict[str, str] = {}

    # -- commands ---------------------------------------------------------------------------

    def start(self, config: dict) -> str:
        run_id = uuid.uuid4().hex
        self.runs.create(run_id, config)
        self._reserve(run_id)
        self._pool.submit(self._drive, run_id, "start", None)
        return run_id

    def decide_run(self, run_id: str, verdict: str) -> None:
        config = self._config(run_id)
        self._reserve(run_id)
        try:
            question = waiting_for(self._graph(config, None), run_id)
            if question is None:
                raise Conflict("nothing is waiting for approval")
            if question.get("gate") == "seller_reply":
                raise Conflict("the agent is waiting for the seller's reply: use /reply")
        except Exception:
            self._release(run_id)
            raise
        self._pool.submit(self._drive, run_id, "decide", verdict)

    def reply_run(self, run_id: str, reply: str, sent_text: str | None) -> None:
        """Copilot: the human pasted the seller's reply (and maybe edited what they sent)."""
        state = self._reserve_for_reply(run_id)
        if sent_text:
            problems = check_draft(decision_of(state.values), sent_text, context(state.values))
            if problems:
                self._release(run_id)
                raise Rejected([p.public_message for p in problems])
        payload = {"action": "reply", "reply": reply, "sent_text": sent_text}
        self._pool.submit(self._drive, run_id, "reply", payload)

    def stop_run(self, run_id: str) -> None:
        """Copilot: the human ends the negotiation instead of relaying a reply."""
        self._reserve_for_reply(run_id)
        self._pool.submit(self._drive, run_id, "stop", {"action": "stop"})

    def resume_run(self, run_id: str) -> None:
        config = self._config(run_id)
        self._reserve(run_id)
        try:
            graph = self._graph(config, None)
            if not pending(graph, run_id) or waiting_for(graph, run_id) is not None:
                raise Conflict("nothing to resume")
        except Exception:
            self._release(run_id)
            raise
        self._pool.submit(self._drive, run_id, "resume", None)

    # -- reading ----------------------------------------------------------------------------

    def snapshot(self, run_id: str) -> dict:
        config = self._config(run_id)
        busy_before = run_id in self._busy
        # ONE read of the stored state: values, pending steps and the question always agree.
        state = self._graph(config, None).get_state(make_config(run_id))
        values, waiting, question = state.values, state.next, question_of(state)
        busy = busy_before or run_id in self._busy  # running at either moment counts as running
        error = self._errors.get(run_id)
        if error:
            status = "failed"
        elif busy:
            status = "running"
        elif not values:
            status = "lost"
        elif question:
            status = "waiting_for_approval"
        elif waiting:
            status = "stalled"  # cut off mid-step: POST /resume continues it
        else:
            status = "finished"
        final_price = values.get("final_price")
        return {
            "id": run_id,
            "status": status,
            "config": config,
            "error": error,
            "question": question,
            "outcome": values.get("outcome"),
            "final_price": None if final_price is None else str(final_price),
            "pickup": values.get("pickup"),
            "approvals": values.get("approvals", []),
            "history": values.get("history", []),
            "our_offers": [str(p) for p in values.get("our_offers", [])],
            "seller_prices": [str(p) for p in values.get("seller_prices", [])],
            "trace": values.get("trace", []),
             "facts": values.get("facts", []),
        }

    # -- internals --------------------------------------------------------------------------

    def _config(self, run_id: str) -> dict:
        config = self.runs.get(run_id)
        if config is None:
            raise NotFound(run_id)
        return config

    def _graph(self, config: dict, port):
        simulate = config.get("mode", "simulate") == "simulate"
        return build_graph(
            self.llm,
            port,
            checkpointer=self.saver,
            approve_close=config["autonomy"] == "approve_close",
            calendar=self.calendar if simulate else None,  # copilot never books anything
            ground=not simulate,  # copilot states only what the listing or seller said
        )

    def _reserve(self, run_id: str) -> None:
        with self._guard:
            if run_id in self._busy:
                raise Conflict("the negotiation is busy")
            self._busy.add(run_id)

    def _release(self, run_id: str) -> None:
        with self._guard:
            self._busy.discard(run_id)

    def _lock(self, run_id: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(run_id, threading.Lock())

    def _reserve_for_reply(self, run_id: str):
        """Reserve the run and return its stored state. Only a copilot run that is waiting at a
        seller_reply question qualifies."""
        config = self._config(run_id)
        if config.get("mode", "simulate") != "copilot":
            raise Conflict("this negotiation is not in copilot mode")
        self._reserve(run_id)
        try:
            state = self._graph(config, None).get_state(make_config(run_id))
            question = question_of(state)
            if not question or question.get("gate") != "seller_reply":
                raise Conflict("the agent is not waiting for a seller reply")
        except Exception:
            self._release(run_id)
            raise
        return state

    def _drive(self, run_id: str, mode: str, payload) -> None:
        """Run the graph until it pauses or finishes. The one path for every command."""
        try:
            with self._lock(run_id):
                config = self.runs.get(run_id)
                asking, budget = Decimal(config["asking"]), Decimal(config["budget"])
                copilot = config.get("mode", "simulate") == "copilot"
                if mode == "start":
                    if copilot:
                        port = ManualSellerPort(config.get("seller_opening"))
                    else:
                        persona = get_persona(config["persona"])
                        port = SimSellerPort(SimSeller(asking, persona, seed=config["seed"]))
                    graph = self._graph(config, port)
                    listing, comparables = listing_of(config)
                    run_graph(
                        graph,
                        asking,
                        budget,
                        style=config["style"],
                        opening_text=port.opening_text(),
                        thread_id=run_id,
                        listing=listing,
                        comparables=comparables,
                    )
                    return
                if copilot:
                    port = ManualSellerPort()  # nothing to rebuild: the checkpoint holds it all
                else:
                    # A restart-safe path: rebuild the seller from the offers in the checkpoint.
                    persona, seed = get_persona(config["persona"]), config["seed"]
                    offers = current_state(self._graph(config, None), run_id)["our_offers"]
                    port = SimSellerPort.restore(asking, persona, seed, offers, with_opening=True)
                graph = self._graph(config, port)
                if mode in ("decide", "reply", "stop"):
                    decide(graph, run_id, payload)
                else:
                    approve(graph, run_id)
        except Exception as error:  # noqa: BLE001 - a failed run is reported, never lost
            self._errors[run_id] = f"{type(error).__name__}: {str(error)[:200]}"
        finally:
            self._release(run_id)