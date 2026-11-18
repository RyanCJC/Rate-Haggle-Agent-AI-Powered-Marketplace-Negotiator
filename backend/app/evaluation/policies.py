from collections.abc import Callable
from decimal import ROUND_DOWN, Decimal

from backend.app.core.strategy import (
    STYLES,
    StrategyDecision,
    StrategyParams,
    StrategyState,
    decide,
)

Policy = Callable[[StrategyState], StrategyDecision]

FIXED_STEPS = (Decimal("0.85"), Decimal("0.90"), Decimal("0.95"))


def haggle_policy(params: StrategyParams) -> Policy:
    def policy(state: StrategyState) -> StrategyDecision:
        return decide(state, params)

    return policy


def fixed_discount_policy(state: StrategyState) -> StrategyDecision:
    """Baseline B2: ignores the budget. Offers 85%, 90%, 95% of asking, then gives up."""
    asking = state.asking_price
    last = state.seller_last
    if last is not None and state.round >= 1 and last <= asking * FIXED_STEPS[-1]:
        return StrategyDecision(kind="accept", price=last, reason="seller within 95% of asking")
    if state.round >= len(FIXED_STEPS):
        return StrategyDecision(kind="walk_away", reason="out of fixed steps")
    price = (asking * FIXED_STEPS[state.round]).quantize(Decimal(1), rounding=ROUND_DOWN)
    return StrategyDecision(kind="offer", price=price, reason=f"fixed step {state.round}")


def capped_ladder_policy(state: StrategyState) -> StrategyDecision:
    """Baseline B3: B2's 85/90/95% ladder, but budget-aware. It never offers above the budget and
    only accepts a price inside it. A simple rule a careful person might follow."""
    asking, last, budget = state.asking_price, state.seller_last, state.max_budget
    if last is not None and state.round >= 1 and last <= min(budget, asking * FIXED_STEPS[-1]):
        return StrategyDecision(kind="accept", price=last, reason="seller within 95% of asking")
    if state.round >= len(FIXED_STEPS):
        if last is not None and last <= budget:
            return StrategyDecision(
                kind="accept", price=last, reason="ladder used up, seller within budget"
            )
        return StrategyDecision(kind="walk_away", reason="out of fixed steps")
    price = min(asking * FIXED_STEPS[state.round], budget).quantize(Decimal(1), rounding=ROUND_DOWN)
    if last is not None and last <= budget and price >= last:
        return StrategyDecision(
            kind="accept", price=last, reason="our offer reached the seller's ask"
        )
    return StrategyDecision(kind="offer", price=price, reason=f"capped step {state.round}")


def default_policies() -> dict[str, Policy]:
    longer = STYLES["balanced"].model_copy(update={"horizon": 8, "patience": 4})
    return {
        "haggle_aggressive": haggle_policy(STYLES["aggressive"]),
        "haggle_balanced": haggle_policy(STYLES["balanced"]),
        "haggle_safe": haggle_policy(STYLES["safe"]),
        "haggle_balanced_long": haggle_policy(longer),
        "b2_fixed_discount": fixed_discount_policy,
        "b3_capped_ladder": capped_ladder_policy,
    }