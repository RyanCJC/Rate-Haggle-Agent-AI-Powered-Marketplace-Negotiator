from decimal import ROUND_FLOOR, Decimal
from typing import Literal

from pydantic import BaseModel, Field

PRICE_STEP = Decimal(5)  # offers are rounded down to the nearest RM 5, like a human
AT_CEILING_SHARE = Decimal("0.97")  # "at our ceiling" means offer >= 97% of the limit


class StrategyParams(BaseModel):
    opening_ratio: Decimal = Decimal("0.70")  # first offer = ratio x reference price
    beta: float = Field(default=1.5, gt=0)  # >1 concede slowly, <1 concede fast
    horizon: int = Field(default=6, ge=2)  # total number of offers we will make
    walk_away_ratio: Decimal = Decimal("0.92")  # never pay more than ratio x reference
    patience: int = Field(default=3, ge=1)  # stalled seller rounds before we walk away
    max_step_ratio: Decimal = Decimal("0.08")  # biggest raise per round, share of reference
    budget_cushion: Decimal = Decimal("0.97")  # never plan to spend the whole budget
    opening_cap: Decimal = Decimal("0.85")  # first offer never above this share of the limit


STYLES: dict[str, StrategyParams] = {
    "aggressive": StrategyParams(
        opening_ratio=Decimal("0.62"),
        beta=2.2,
        horizon=7,
        walk_away_ratio=Decimal("0.88"),
        patience=4,
        max_step_ratio=Decimal("0.06"),
    ),
    "balanced": StrategyParams(),
    "safe": StrategyParams(
        opening_ratio=Decimal("0.78"),
        beta=1.0,
        horizon=4,
        walk_away_ratio=Decimal("0.95"),
        patience=2,
        max_step_ratio=Decimal("0.10"),
    ),
}


class StrategyState(BaseModel):
    asking_price: Decimal
    max_budget: Decimal = Field(repr=False)  # PRIVATE
    reference_price: Decimal | None = None  # e.g. median of comparables (Stage 4)
    our_offers: list[Decimal] = []
    seller_prices: list[Decimal] = []  # seller's asks over time, oldest first

    @property
    def ref(self) -> Decimal:
        return self.reference_price or self.asking_price

    @property
    def round(self) -> int:
        return len(self.our_offers)

    @property
    def seller_last(self) -> Decimal | None:
        return self.seller_prices[-1] if self.seller_prices else None

    @property
    def stalled_rounds(self) -> int:
        """How many times in a row the seller failed to lower their price."""
        count = 0
        earlier = reversed(self.seller_prices[:-1])
        later = reversed(self.seller_prices[1:])
        for prev, cur in zip(earlier, later):
            if cur >= prev:
                count += 1
            else:
                break
        return count


class StrategyDecision(BaseModel):
    kind: Literal["offer", "accept", "walk_away"]
    price: Decimal | None = None
    reason: str = ""  # PRIVATE: may contain numbers, for traces only


def _floor_to_step(x: Decimal) -> Decimal:
    return (x / PRICE_STEP).to_integral_value(rounding=ROUND_FLOOR) * PRICE_STEP


def price_limit(state: StrategyState, params: StrategyParams) -> Decimal:
    """The most this strategy will ever pay."""
    return min(
        state.max_budget * params.budget_cushion,
        state.ref * params.walk_away_ratio,
        state.asking_price,
    )


def schedule_target(state: StrategyState, params: StrategyParams, limit: Decimal) -> Decimal:
    """Where the concession curve says our offer should be at this round."""
    opening = min(state.ref * params.opening_ratio, limit * params.opening_cap)
    progress = min(1.0, state.round / (params.horizon - 1))
    fraction = Decimal(repr(progress**params.beta))
    return opening + (limit - opening) * fraction


def decide(state: StrategyState, params: StrategyParams) -> StrategyDecision:
    limit = price_limit(state, params)
    target = schedule_target(state, params, limit)
    last = state.seller_last
    current = state.our_offers[-1] if state.our_offers else None

    # 1. The seller is already at or below where we would be now: take it.
    if last is not None and last <= limit and last <= target:
        return StrategyDecision(
            kind="accept", price=last, reason=f"seller {last} <= target {target:.2f}"
        )

    # 2. We have used all our offers and the seller is still above our limit.
    if last is not None and state.round >= params.horizon:
        return StrategyDecision(kind="walk_away", reason="horizon reached, seller above limit")

    # 3. Seller will not move, is above our limit, and we are already at our ceiling.
    at_ceiling = current is not None and current >= limit * AT_CEILING_SHARE
    if (
        last is not None
        and last > limit
        and at_ceiling
        and state.stalled_rounds >= params.patience
    ):
        return StrategyDecision(kind="walk_away", reason="seller stalled, we are at our ceiling")

    # 4. Work out our next offer.
    price = _floor_to_step(target)
    if current is not None:
        step_cap = max(state.ref * params.max_step_ratio, PRICE_STEP)
        price = max(price, current)
        price = min(price, current + step_cap)
    price = min(price, limit)

    # 5. Never offer at or above what the seller already asks.
    if last is not None and last <= limit and price >= last:
        return StrategyDecision(kind="accept", price=last, reason="our offer reached seller ask")

    return StrategyDecision(
        kind="offer", price=price, reason=f"round {state.round}, target {target:.2f}"
    )