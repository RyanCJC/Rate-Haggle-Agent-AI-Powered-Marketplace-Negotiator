import re
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PROFILE_ID = re.compile(r"[0-9a-f]{32}")


def check_profile_id(value: str) -> str:
    if not isinstance(value, str) or not PROFILE_ID.fullmatch(value):
        raise ValueError("invalid profile id")
    return value


class Preferences(BaseModel):
    """What the user chose to tell Haggle. Only fixed choices ever reach a prompt."""

    model_config = ConfigDict(extra="forbid")

    style: Literal["aggressive", "balanced", "safe"] | None = None
    pickup_hours: Literal["any", "morning", "afternoon", "evening"] = "any"
    pickup_area: str | None = None  # free text, shown to the user only, never sent to a model

    @field_validator("pickup_area")
    @classmethod
    def tidy_area(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        if len(value) > 80:
            raise ValueError("pickup_area is at most 80 characters")
        return value or None


class DealRecord(BaseModel):
    """What is remembered about one finished negotiation. There is deliberately no field
    for the user's limit or budget, and extra fields are refused."""

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1, max_length=64)
    item_title: str = ""
    category: str | None = None
    asking: Decimal = Field(gt=0)
    final_price: Decimal | None = Field(default=None, gt=0)
    outcome: str = Field(min_length=1, max_length=40)
    mode: Literal["simulate", "copilot"]
    rounds: int = Field(default=0, ge=0)

    @field_validator("item_title")
    @classmethod
    def tidy_title(cls, value: str) -> str:
        value = " ".join((value or "").split())
        if len(value) > 120:
            raise ValueError("item_title is at most 120 characters")
        return value


class PastDeal(DealRecord):
    created_at: datetime
    similarity: float | None = None

    def public(self) -> dict:
        """The JSON the API returns: prices as strings, like every other endpoint."""
        return {
            "run_id": self.run_id,
            "item_title": self.item_title,
            "category": self.category,
            "asking": str(self.asking),
            "final_price": None if self.final_price is None else str(self.final_price),
            "outcome": self.outcome,
            "mode": self.mode,
            "rounds": self.rounds,
            "created_at": self.created_at.isoformat(),
            "similarity": None if self.similarity is None else round(self.similarity, 2),
        }