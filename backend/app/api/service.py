import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from backend.app.core.calendar_rules import to_myt_iso
from backend.app.core.pickup import describe_slot, pickup_message, prefer_hours
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
from backend.app.graph.ports import CalendarError, SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.memory.context import memory_notes
from backend.app.memory.models import DealRecord
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

class Unavailable(Exception):
    """A dependency (the calendar) could not be reached."""


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

    def __init__(
        self, saver, calendar, runs, llm_factory=RuleBasedLLM, workers: int = 8, memory=None
    ):
        self.saver = saver
        self.calendar = calendar
        self.runs = runs
        self.memory = memory  # profile memory (optional): remembers finished copilot deals
        self.memory_failures = 0  # memory trouble is counted, never allowed to fail a run
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

    # -- pickup (copilot) -------------------------------------------------------------------
    def pickup_options(self, run_id: str, count: int = 5) -> dict:
        """Free slots plus a ready-to-send message for the seller. Code writes the message."""
        config, values = self._deal_state(run_id)
        booked = values.get("pickup")
        if booked and booked.get("status") == "booked":
            return {"slots": [], "labels": [], "message": None, "pickup": booked}
        window = self._pickup_hours(config)
        try:
            # With a time-of-day preference, look at more free slots so preferred ones are found.
            slots = self.calendar.propose_slots(count if window == "any" else min(count * 3, 24))
        except CalendarError as error:
            raise Unavailable("the calendar is unavailable, try again") from error
        slots = prefer_hours(slots, window, count)
        return {
            "slots": slots,
            "labels": [describe_slot(s) for s in slots],
            "message": pickup_message(values["final_price"], slots),
            "pickup": None,
        }

    def book_pickup(self, run_id: str, start_at: str) -> dict:
        """Book the time the seller agreed to, through the same idempotent boundary."""
        config, _ = self._deal_state(run_id)
        key = f"{run_id}:pickup"  # the same negotiation always uses the same key
        with self._lock(run_id):
            try:
                result = self.calendar.book_slot(key, run_id, start_at)
            except CalendarError as error:
                raise Unavailable("the calendar is unavailable, try again") from error
            status = result["status"]
            if status == "invalid":
                raise Rejected([result.get("detail") or "that time cannot be booked"])
            if status == "slot_taken":
                raise Conflict("that time was just taken: pick another")
            pickup = {"status": "booked", "start_at": to_myt_iso(result["start_at"])}
            self._store_pickup(config, run_id, pickup)  # also heals a crash after booking
            if status == "already_booked" and not result.get("same_slot"):
                raise Conflict(
                    f"a pickup is already booked for {describe_slot(pickup['start_at'])}: "
                    "cancel it first"
                )
            return pickup

    def cancel_pickup(self, run_id: str) -> dict:
        config, _ = self._deal_state(run_id)
        with self._lock(run_id):
            try:
                result = self.calendar.cancel_booking(f"{run_id}:pickup")
            except CalendarError as error:
                raise Unavailable("the calendar is unavailable, try again") from error
            self._store_pickup(config, run_id, None)
            return {"status": result["status"]}

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
            "memory_notes": values.get("memory_notes", []),
        }

    # -- internals --------------------------------------------------------------------------

    def _config(self, run_id: str) -> dict:
        config = self.runs.get(run_id)
        if config is None:
            raise NotFound(run_id)
        return config

    def _deal_state(self, run_id: str):
        """The config and stored values of a finished copilot deal, or a refusal."""
        config = self._config(run_id)
        if config.get("mode", "simulate") != "copilot":
            raise Conflict("pickup coordination is only for copilot negotiations")
        if run_id in self._busy:
            raise Conflict("the negotiation is busy")
        state = self._graph(config, None).get_state(make_config(run_id))
        if state.next or state.values.get("outcome") != "deal":
            raise Conflict("there is no agreed deal to arrange a pickup for")
        return config, state.values

    def _store_pickup(self, config: dict, run_id: str, pickup: dict | None) -> None:
        """Write the result into the stored run, so a reload or restart still sees it."""
        self._graph(config, None).update_state(
            make_config(run_id), {"pickup": pickup}, as_node="finalize"
        )

    def _remember(self, run_id: str, config: dict) -> None:
        """A finished copilot run is kept in the profile's memory. Practice runs are not: a
        simulated deal says nothing true about this person. Never raises."""
        profile_id = config.get("profile_id")
        if self.memory is None or not profile_id or config.get("mode") != "copilot":
            return
        try:
            state = self._graph(config, None).get_state(make_config(run_id))
            values = state.values
            if state.next or not values.get("outcome"):
                return
            self.memory.record_deal(
                profile_id,
                DealRecord(
                    run_id=run_id,
                    item_title=config.get("item_title") or "",
                    category=config.get("category"),
                    asking=Decimal(config["asking"]),
                    final_price=values.get("final_price"),
                    outcome=values["outcome"],
                    mode="copilot",
                    rounds=len(values.get("our_offers", [])),
                ),
            )
        except Exception:  # noqa: BLE001 - memory is a convenience: it never breaks a negotiation
            self.memory_failures += 1

    def _memory_for_start(self, config: dict):
        """Prompt lines about similar past deals (numbers only) and the prices they mention."""
        profile_id = config.get("profile_id")
        title = (config.get("item_title") or "").strip()
        if self.memory is None or not profile_id or not title or config.get("mode") != "copilot":
            return None, None
        try:
            deals = self.memory.similar_deals(profile_id, title, config.get("category"), limit=2)
        except Exception:  # noqa: BLE001
            self.memory_failures += 1
            return None, None
        lines, prices = memory_notes(deals)
        return lines or None, prices or None

    def _pickup_hours(self, config: dict) -> str:
        profile_id = config.get("profile_id")
        if self.memory is None or not profile_id:
            return "any"
        try:
            return self.memory.get_preferences(profile_id).pickup_hours
        except Exception:  # noqa: BLE001
            self.memory_failures += 1
            return "any"

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
                    notes, prices = self._memory_for_start(config)
                    run_graph(
                        graph,
                        asking,
                        budget,
                        style=config["style"],
                        opening_text=port.opening_text(),
                        thread_id=run_id,
                        listing=listing,
                        comparables=comparables,
                        memory_notes=notes,
                        memory_prices=prices,
                    )
                else:
                    if copilot:
                        port = ManualSellerPort()  # nothing to rebuild: the checkpoint holds it all
                    else:
                        # A restart-safe path: rebuild the seller from the offers in the checkpoint.
                        persona, seed = get_persona(config["persona"]), config["seed"]
                        offers = current_state(self._graph(config, None), run_id)["our_offers"]
                        port = SimSellerPort.restore(
                            asking, persona, seed, offers, with_opening=True
                        )
                    graph = self._graph(config, port)
                    if mode in ("decide", "reply", "stop"):
                        decide(graph, run_id, payload)
                    else:
                        approve(graph, run_id)
                self._remember(run_id, config)
        except Exception as error:  # noqa: BLE001 - a failed run is reported, never lost
            self._errors[run_id] = f"{type(error).__name__}: {str(error)[:200]}"
        finally:
            self._release(run_id)