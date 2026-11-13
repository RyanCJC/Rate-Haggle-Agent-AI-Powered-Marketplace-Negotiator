from decimal import Decimal

from .models import (
    Accept,
    MakeOffer,
    NegotiationContext,
    Phase,
    ValidationResult,
    Violation,
)
from .outbound import check_outbound

ALLOWED_BY_PHASE: dict[Phase, set[str]] = {
    Phase.OPENING: {"make_offer", "ask_question", "walk_away", "wait"},
    Phase.NEGOTIATING: {"make_offer", "ask_question", "accept", "walk_away", "wait"},
    Phase.CLOSING: {"accept", "ask_question", "walk_away", "wait"},
    Phase.DONE: set(),
}


def validate_action(action, ctx: NegotiationContext) -> ValidationResult:
    """Deterministic gate. Nothing the LLM proposes runs unless this returns ok."""
    violations: list[Violation] = []

    if action.kind not in ALLOWED_BY_PHASE[ctx.phase]:
        violations.append(
            Violation(
                code="phase_not_allowed",
                public_message="That action is not allowed right now.",
                private_detail=f"{action.kind} in {ctx.phase.value}",
            )
        )
        return ValidationResult(violations=violations)

    if isinstance(action, (MakeOffer, Accept)):
        price = action.price

        if price > ctx.max_budget:
            violations.append(
                Violation(
                    code="over_budget",
                    public_message="That price is above what you are allowed to pay.",
                    private_detail=f"{price} > {ctx.max_budget}",
                )
            )

        if price > ctx.asking_price:
            violations.append(
                Violation(
                    code="above_asking",
                    public_message="Never offer more than the seller is asking.",
                    private_detail=f"{price} > {ctx.asking_price}",
                )
            )

    if isinstance(action, MakeOffer) and ctx.current_offer is not None and action.price < ctx.current_offer:
        violations.append(
            Violation(
                code="offer_decreases",
                public_message="An offer cannot be lower than your previous offer.",
                private_detail=f"{action.price} < {ctx.current_offer}",
            )
        )

    if isinstance(action, Accept) and (ctx.seller_last_price is None or action.price != ctx.seller_last_price):
        violations.append(
            Violation(
                code="accept_mismatch",
                public_message="You can only accept the seller's latest standing price.",
                private_detail=f"{action.price} vs {ctx.seller_last_price}",
            )
        )

    message = getattr(action, "message", None)
    if message:
        if isinstance(action, (MakeOffer, Accept)):
            ceiling = action.price
        else:
            ceiling = ctx.current_offer if ctx.current_offer is not None else Decimal(0)
        violations.extend(check_outbound(message, ctx, ceiling))

    return ValidationResult(violations=violations)