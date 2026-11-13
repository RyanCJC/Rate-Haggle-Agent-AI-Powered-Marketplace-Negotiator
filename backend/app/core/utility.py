from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field, model_validator


class Condition(str, Enum):
    NEW = "new"
    LIKE_NEW = "like_new"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"


CONDITION_SCORE = {
    Condition.NEW: 1.0,
    Condition.LIKE_NEW: 0.85,
    Condition.GOOD: 0.65,
    Condition.FAIR: 0.40,
    Condition.POOR: 0.15,
}


class Deal(BaseModel):
    price: Decimal
    distance_km: float = Field(default=0.0, ge=0)
    condition: Condition = Condition.GOOD
    warranty_months: int = Field(default=0, ge=0)


class PriceRange(BaseModel):
    """Where the price score runs from 1.0 (best) down to 0.0 (worst)."""

    best: Decimal  # e.g. low end of comparables
    worst: Decimal  # e.g. the buyer's max budget

    @model_validator(mode="after")
    def _check_order(self):
        if self.best >= self.worst:
            raise ValueError("best must be below worst")
        return self


class UtilityWeights(BaseModel):
    price: float = Field(default=0.60, ge=0)
    distance: float = Field(default=0.15, ge=0)
    condition: float = Field(default=0.15, ge=0)
    warranty: float = Field(default=0.10, ge=0)

    def normalized(self) -> "UtilityWeights":
        total = self.price + self.distance + self.condition + self.warranty
        if total == 0:
            raise ValueError("weights cannot all be zero")
        return UtilityWeights(
            price=self.price / total,
            distance=self.distance / total,
            condition=self.condition / total,
            warranty=self.warranty / total,
        )


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def utility(
    deal: Deal,
    price_range: PriceRange,
    weights: UtilityWeights | None = None,
    max_km: float = 30.0,
) -> float:
    """Score a deal between 0 and 1. Higher is better for the buyer."""
    w = (weights or UtilityWeights()).normalized()
    span = price_range.worst - price_range.best
    price_score = _clamp(float((price_range.worst - deal.price) / span))
    distance_score = _clamp(1 - deal.distance_km / max_km)
    condition_score = CONDITION_SCORE[deal.condition]
    warranty_score = _clamp(deal.warranty_months / 12)
    return (
        w.price * price_score
        + w.distance * distance_score
        + w.condition * condition_score
        + w.warranty * warranty_score
    )