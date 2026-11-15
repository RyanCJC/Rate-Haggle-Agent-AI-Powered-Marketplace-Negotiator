import json
from decimal import Decimal

from langgraph.types import interrupt

from backend.app.core.calendar_rules import to_myt_iso
from backend.app.core.models import (
    Accept,
    AskQuestion,
    MakeOffer,
    NegotiationContext,
    Phase,
    Violation,
    WalkAway,
)
from backend.app.core.outbound import extract_amounts
from backend.app.core.strategy import STYLES, StrategyDecision, StrategyState, decide
from backend.app.core.validate import validate_action
from backend.app.knowledge.facts import facts_view, merge_claims, required_keys
from backend.app.knowledge.grounding import ungrounded_claims
from backend.app.knowledge.market import market_stats
from backend.app.llm.clarify import choose_clarify_step
from backend.app.llm.client import LLMError
from backend.app.llm.facts import propose_claims, verify_claims
from backend.app.llm.guards import reconcile_intent
from backend.app.llm.tasks import compose_message, extract_seller_intent, fmt_price

from .ports import CalendarError, SellerClosed
from .state import NegState

MAX_RETRIES = 2
MAX_ROUNDS = 25
MAX_ASKS = 2  # questions per negotiation
MAX_CLARIFY_STEPS = 4  # tool steps per turn
MAX_SLOT_TRIES = 3  # free slots to try when booking the pickup
MAX_TOOL_CHARS = 1500  # keep tool results from flooding the planner prompt
PRICE_BOUNDS = (Decimal("0.3"), Decimal("1.5"))  # plausible seller price, share of asking


def strategy_state(s: NegState) -> StrategyState:
    return StrategyState(
        asking_price=s["asking_price"],
        max_budget=s["max_budget"],
        our_offers=s["our_offers"],
        seller_prices=s["seller_prices"],
    )


def context(s: NegState) -> NegotiationContext:
    offers, prices = s["our_offers"], s["seller_prices"]
    return NegotiationContext(
        max_budget=s["max_budget"],
        asking_price=s["asking_price"],
        current_offer=offers[-1] if offers else None,
        seller_last_price=prices[-1] if prices else None,
        phase=Phase.NEGOTIATING,
    )


def log(s: NegState, node: str, **data) -> list[dict]:
    return [*s.get("trace", []), {"node": node, **data}]


def decision_of(s: NegState) -> StrategyDecision:
    return StrategyDecision.model_validate(s["decision"])


def fallback_message(decision: StrategyDecision) -> str:
    if decision.kind == "offer":
        return f"How about RM {fmt_price(decision.price)}?"
    if decision.kind == "accept":
        return f"Okay, RM {fmt_price(decision.price)} works for me. Deal."
    if decision.kind == "ask_question":
        return "Could you confirm your price and what is included?"
    return "Thanks for your time, I will pass for now."


def build_action(decision: StrategyDecision, message: str):
    if decision.kind == "offer":
        return MakeOffer(price=decision.price, message=message)
    if decision.kind == "accept":
        return Accept(price=decision.price, message=message)
    if decision.kind == "ask_question":
        return AskQuestion(message=message)
    return WalkAway(message=message)


def check_draft(
    decision: StrategyDecision,
    draft: str | None,
    ctx: NegotiationContext,
    facts: list[dict] | None = None,
) -> list[Violation]:
    if not draft or not draft.strip():
        return [Violation(code="no_draft", public_message="Write a message.")]
    violations = list(validate_action(build_action(decision, draft), ctx).violations)
    if decision.price is not None and decision.price not in extract_amounts(
        draft, ctx.asking_price
    ):
        violations.append(
            Violation(
                code="price_not_stated",
                public_message="State the exact price in the message.",
                private_detail=f"missing {decision.price}",
            )
        )
    if facts:
        invented = ungrounded_claims(draft, facts)
        if invented:
            names = ", ".join(sorted({c.key for c in invented}))
            violations.append(
                Violation(
                    code="ungrounded_claim",
                    public_message=(
                        f"Do not state item details that are not in the known facts ({names}). "
                        "Ask about them instead."
                    ),
                    private_detail="; ".join(c.quote for c in invented),
                )
            )
    return violations


def run_tool(name: str, s: NegState, query: str = "", knowledge=None) -> str:
    """Read-only lookups for the clarify loop."""
    if name == "get_listing":
        listing = s.get("listing")
        output = json.dumps(listing) if listing else "no listing details available"
    elif name == "get_market_stats":
        stats = market_stats(s.get("comparables") or [])
        output = stats.describe() if stats else "no comparable prices available"
    elif name == "search_knowledge":
        if knowledge is None:
            output = "knowledge base not available"
        else:
            category = (s.get("listing") or {}).get("category")
            passages = knowledge(query or "what to check before buying", category)
            output = " | ".join(passages) if passages else "no passages found"
    else:
        output = f"unknown tool {name}"
    return output[:MAX_TOOL_CHARS]


def needs_clarification(s: NegState) -> bool:
    """Only consider asking when we are about to offer and the seller was unclear or changed terms."""
    return (
        s["decision"]["kind"] == "offer"
        and s["asks"] < MAX_ASKS
        and (not s["seller_gave_price"] or s["terms_changed"])
    )


def make_nodes(llm, seller, knowledge=None, ground: bool = False, calendar=None, approve_close: bool = False):
    def plan(s: NegState):
        if len(s["our_offers"]) >= MAX_ROUNDS:
            decision = StrategyDecision(kind="walk_away", reason="round cap")
        else:
            decision = decide(strategy_state(s), STYLES[s["style"]])
        return {
            "decision": decision.model_dump(mode="json"),
            "draft": None,
            "feedback": "",
            "retries": 0,
            "validation_ok": False,
            "trace": log(
                s,
                "plan",
                kind=decision.kind,
                price=str(decision.price) if decision.price is not None else None,
                reason=decision.reason,
            ),
        }

    def clarify(s: NegState):
        trace, notes = s["trace"], list(s["notes"])
        # start from what earlier turns already looked up, so no tool runs twice
        results = [tuple(note.split(": ", 1)) for note in notes if ": " in note]
        asks_left = MAX_ASKS - s["asks"]
        for step_no in range(1, MAX_CLARIFY_STEPS + 1):
            try:
                step = choose_clarify_step(
                    llm,
                    s["seller_text"],
                    s["seller_gave_price"],
                    s["terms_changed"],
                    asks_left,
                    step_no,
                    results,
                    MAX_CLARIFY_STEPS,
                )
            except LLMError as error:
                trace = [*trace, {"node": "clarify", "step": step_no, "error": str(error)[:200]}]
                break
            trace = [*trace, {"node": "clarify", "step": step_no, "tool": step.tool}]
            if step.tool == "proceed":
                break
            if step.tool == "ask_seller":
                if asks_left > 0 and step.question.strip():
                    decision = StrategyDecision(kind="ask_question", reason="clarify")
                    return {
                        "decision": decision.model_dump(mode="json"),
                        "draft": step.question.strip(),
                        "asks": s["asks"] + 1,
                        "notes": notes,
                        "trace": trace,
                    }
                trace = [*trace, {"node": "clarify", "note": "ask refused"}]
                break
            output = run_tool(step.tool, s, step.query, knowledge)
            results.append((step.tool, output))
            notes.append(f"{step.tool}: {output}")
        else:
            trace = [*trace, {"node": "clarify", "note": "step cap reached"}]
        return {"notes": notes, "trace": trace}

    def compose(s: NegState):
        try:
            draft = compose_message(
                llm,
                decision_of(s),
                context(s),
                s["history"],
                s["style"],
                s["seller_probed"],
                s["feedback"],
                facts=s.get("facts") if ground else None,
            )
        except LLMError as error:
            return {"draft": None, "trace": log(s, "compose", error=str(error)[:200])}
        return {"draft": draft.message, "trace": log(s, "compose", attempt=s["retries"] + 1)}

    def validate(s: NegState):
        facts = s.get("facts") if ground and s.get("facts") else None
        violations = check_draft(decision_of(s), s["draft"], context(s), facts)
        ok = not violations
        update = {
            "validation_ok": ok,
            "trace": log(s, "validate", ok=ok, codes=[v.code for v in violations]),
        }
        if not ok:
            update["retries"] = s["retries"] + 1
            update["feedback"] = " ".join(v.public_message for v in violations)
        return update

    def fallback(s: NegState):
        decision = decision_of(s)
        draft = fallback_message(decision)
        if check_draft(decision, draft, context(s)):
            raise RuntimeError("fallback template failed validation: this is a bug")
        return {"draft": draft, "validation_ok": True, "trace": log(s, "fallback")}

    def execute(s: NegState):
        decision, draft = decision_of(s), s["draft"]
        history = [*s["history"], ("buyer", draft)]
        price_text = str(decision.price) if decision.price is not None else None
        if decision.kind == "accept":
            approvals = s.get("approvals", [])
            if approve_close:
                # Dynamic pause: the run stops here, saved in the checkpoint, until a verdict.
                verdict = interrupt({"gate": "close_deal", "price": price_text, "draft": draft})
                if verdict != "approve":  # anything but the exact word is a refusal
                    return {
                        "outcome": "user_declined",
                        "trace": log(s, "execute", action="accept", declined=True),
                    }
                approvals = [*approvals, "close_deal"]
            return {
                "history": history,
                "outcome": "deal",
                "final_price": decision.price,
                "approvals": approvals,
                "trace": log(s, "execute", action="accept", price=price_text),
            }
        if decision.kind == "walk_away":
            return {
                "history": history,
                "outcome": "we_walk",
                "trace": log(s, "execute", action="walk_away"),
            }
        try:
            if decision.kind == "ask_question":
                text = seller.send_message(draft)
            else:
                text = seller.send_offer(decision.price, draft)
        except SellerClosed:
            return {
                "history": history,
                "outcome": "extraction_miss",
                "trace": log(s, "execute", action=decision.kind, error="seller already closed"),
            }
        update = {
            "history": [*history, ("seller", text)],
            "seller_text": text,
            "turns": [*s["turns"], decision.price],
            "trace": log(s, "execute", action=decision.kind, price=price_text),
        }
        if decision.kind == "offer":
            update["our_offers"] = [*s["our_offers"], decision.price]
        return update

    def ground_claims(s: NegState, entry: dict) -> dict:
        """The LLM proposes claims about the item; only verified ones are kept."""
        claims_so_far = s.get("claims", [])
        category = (s.get("listing") or {}).get("category", "")
        allowed = tuple(dict.fromkeys([*required_keys(category), *(c["key"] for c in claims_so_far)]))
        try:
            proposals = propose_claims(llm, s["seller_text"], allowed)
        except LLMError as error:
            entry["facts_error"] = str(error)[:200]
            return {}
        kept, dropped = verify_claims(proposals, s["seller_text"], allowed)
        entry["claims_kept"] = [f"{c.key}={c.value}" for c in kept]
        entry["claims_dropped"] = dropped
        claims = merge_claims(claims_so_far, kept)
        return {"claims": claims, "facts": facts_view(claims, category)}

    def ingest(s: NegState):
        last_offer = s["our_offers"][-1] if s["our_offers"] else None
        try:
            intent = extract_seller_intent(llm, s["seller_text"], last_offer)
        except LLMError as error:
            return {"trace": log(s, "ingest", error=str(error)[:200])}

        raw = intent.model_dump(mode="json")
        intent, notes = reconcile_intent(intent, last_offer)
        entry: dict = {"intent": intent.model_dump(mode="json")}
        if notes:
            entry["guard_notes"] = notes
            entry["raw_intent"] = raw

        update: dict = {
            "seller_probed": intent.asks_budget,
            "seller_gave_price": intent.price is not None,
            "terms_changed": intent.terms_changed,
        }
        asking = s["asking_price"]
        if intent.price is not None:
            low, high = PRICE_BOUNDS[0] * asking, PRICE_BOUNDS[1] * asking
            if low <= intent.price <= high:
                update["seller_prices"] = [*s["seller_prices"], intent.price]
            else:
                entry["ignored_implausible_price"] = str(intent.price)
        if intent.accepted:
            update["outcome"] = "deal"
            update["final_price"] = last_offer  # our own offer, not the LLM's claim
        elif intent.walked_away:
            update["outcome"] = "seller_walks"
        if ground:
            update.update(ground_claims(s, entry))
        update["trace"] = log(s, "ingest", **entry)
        return update

    def finalize(s: NegState):
        outcome = s.get("outcome") or "timeout"
        return {"outcome": outcome, "trace": log(s, "finalize", outcome=outcome)}

    def schedule(s: NegState):
        """After a deal, book the earliest free pickup slot. A failure never undoes the deal."""
        run_id = s.get("run_id")
        if not run_id:
            pickup = {"status": "skipped", "detail": "no run id"}
            return {"pickup": pickup, "trace": log(s, "schedule", **pickup)}
        approvals = s.get("approvals", [])
        if approve_close and "close_deal" not in approvals:
            # The seller accepted our offer, so no close gate ran: confirm before booking.
            verdict = interrupt({"gate": "book_pickup", "price": str(s.get("final_price"))})
            if verdict != "approve":
                pickup = {"status": "declined"}
                return {"pickup": pickup, "trace": log(s, "schedule", **pickup)}
            approvals = [*approvals, "book_pickup"]
        key = f"{run_id}:pickup"  # the same negotiation always uses the same key
        try:
            slots = calendar.propose_slots(MAX_SLOT_TRIES)
            pickup = {"status": "no_slots"}
            for start in slots:
                result = calendar.book_slot(key, run_id, start)
                if result["status"] in ("booked", "already_booked"):
                    pickup = {"status": result["status"], "start_at": to_myt_iso(result["start_at"])}
                    break
                pickup = {"status": result["status"]}  # slot_taken or invalid: try the next
        except CalendarError as error:
            pickup = {"status": "error", "detail": str(error)[:200]}
        return {"pickup": pickup, "approvals": approvals, "trace": log(s, "schedule", **pickup)}

    return {
        "plan": plan,
        "clarify": clarify,
        "compose": compose,
        "validate": validate,
        "fallback": fallback,
        "execute": execute,
        "ingest": ingest,
        "finalize": finalize,
        "schedule": schedule,
    }


def route_after_clarify(s: NegState) -> str:
    return "validate" if s.get("draft") else "compose"  # a question skips the composer


def route_after_validate(s: NegState) -> str:
    if s["validation_ok"]:
        return "execute"
    if s["decision"]["kind"] == "ask_question":
        return "fallback"  # a rejected question is replaced by a plain template
    return "compose" if s["retries"] <= MAX_RETRIES else "fallback"


def route_after_execute(s: NegState) -> str:
    return "finalize" if s.get("outcome") else "ingest"


def route_after_ingest(s: NegState) -> str:
    return "finalize" if s.get("outcome") else "plan"