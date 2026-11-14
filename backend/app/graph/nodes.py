import json
from decimal import Decimal

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
from backend.app.llm.clarify import choose_clarify_step
from backend.app.llm.client import LLMError
from backend.app.llm.guards import reconcile_intent
from backend.app.llm.tasks import compose_message, extract_seller_intent, fmt_price

from .ports import SellerClosed
from .state import NegState

MAX_RETRIES = 2
MAX_ROUNDS = 25
MAX_ASKS = 2  # questions per negotiation
MAX_CLARIFY_STEPS = 4  # tool steps per turn
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
    decision: StrategyDecision, draft: str | None, ctx: NegotiationContext
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
    return violations


def run_tool(name: str, s: NegState) -> str:
    """Read-only lookups for the clarify loop. In Stage 4 these read real facts."""
    if name == "get_listing":
        listing = s.get("listing")
        return json.dumps(listing) if listing else "no listing details available"
    if name == "get_market_stats":
        prices = sorted(s.get("comparables") or [])
        if not prices:
            return "no comparable prices available"
        median = prices[len(prices) // 2]
        return f"{len(prices)} similar items: lowest {prices[0]}, median {median}, highest {prices[-1]}"
    return f"unknown tool {name}"


def needs_clarification(s: NegState) -> bool:
    """Only consider asking when we are about to offer and the seller was unclear or changed terms."""
    return (
        s["decision"]["kind"] == "offer"
        and s["asks"] < MAX_ASKS
        and (not s["seller_gave_price"] or s["terms_changed"])
    )


def make_nodes(llm, seller):
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
        trace, notes, results = s["trace"], list(s["notes"]), []
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
            output = run_tool(step.tool, s)
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
            )
        except LLMError as error:
            return {"draft": None, "trace": log(s, "compose", error=str(error)[:200])}
        return {"draft": draft.message, "trace": log(s, "compose", attempt=s["retries"] + 1)}

    def validate(s: NegState):
        violations = check_draft(decision_of(s), s["draft"], context(s))
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
            return {
                "history": history,
                "outcome": "deal",
                "final_price": decision.price,
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
        update["trace"] = log(s, "ingest", **entry)
        return update

    def finalize(s: NegState):
        outcome = s.get("outcome") or "timeout"
        return {"outcome": outcome, "trace": log(s, "finalize", outcome=outcome)}

    return {
        "plan": plan,
        "clarify": clarify,
        "compose": compose,
        "validate": validate,
        "fallback": fallback,
        "execute": execute,
        "ingest": ingest,
        "finalize": finalize,
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