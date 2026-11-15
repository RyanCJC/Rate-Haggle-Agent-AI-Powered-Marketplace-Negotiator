from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class StartRequest(BaseModel):
    asking: Decimal = Field(gt=0)
    budget: Decimal = Field(gt=0)
    persona: str = "flexible"
    style: Literal["aggressive", "balanced", "safe"] = "balanced"
    autonomy: Literal["auto", "approve_close"] = "approve_close"
    seed: int = 0


class Decision(BaseModel):
    verdict: Literal["approve", "decline"]