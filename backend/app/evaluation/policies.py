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


def default_policies() -> dict[str, Policy]:
    longer = STYLES["balanced"].model_copy(update={"horizon": 8, "patience": 4})
    return {
        "haggle_aggressive": haggle_policy(STYLES["aggressive"]),
        "haggle_balanced": haggle_policy(STYLES["balanced"]),
        "haggle_safe": haggle_policy(STYLES["safe"]),
        "haggle_balanced_long": haggle_policy(longer),
        "b2_fixed_discount": fixed_discount_policy,
    }