import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean(text: str) -> str:
    """Strip control characters and surrounding whitespace from pasted text."""
    return _CONTROL.sub("", text).strip()


class StartRequest(BaseModel):
    asking: Decimal = Field(gt=0)
    budget: Decimal = Field(gt=0)
    persona: str = "flexible"
    style: Literal["aggressive", "balanced", "safe"] = "balanced"
    autonomy: Literal["auto", "approve_close"] = "approve_close"
    seed: int = 0
    mode: Literal["simulate", "copilot"] = "simulate"
    item_title: str | None = Field(default=None, max_length=120)
    seller_opening: str | None = Field(default=None, max_length=4000)
    category: (
        Literal[
            "monitors", "phones", "laptops", "cameras", "consoles", "furniture", "appliances", "other"
        ]
        | None
    ) = None
    listing_text: str | None = Field(default=None, max_length=4000)
    comparables: list[Decimal] | None = Field(default=None, max_length=8)
    channel: Literal["manual", "marketplace"] = "manual"

    @field_validator("item_title", "seller_opening", "listing_text")
    @classmethod
    def tidy(cls, value: str | None) -> str | None:
        return None if value is None else (clean(value) or None)

    @field_validator("comparables")
    @classmethod
    def prices_positive(cls, value: list[Decimal] | None) -> list[Decimal] | None:
        if value and any(price <= 0 for price in value):
            raise ValueError("comparable prices must be above zero")
        return value

    @model_validator(mode="after")
    def channel_validation(self) -> "StartRequest":
        if self.channel == "marketplace" and self.mode != "copilot":
            raise ValueError("marketplace channel requires mode=copilot")
        if self.channel == "marketplace" and self.seller_opening:
            raise ValueError("the marketplace supplies the opening: do not set seller_opening")
        return self


class Decision(BaseModel):
    verdict: Literal["approve", "decline"]


class Reply(BaseModel):
    reply: str = Field(min_length=1, max_length=4000)
    sent_text: str | None = Field(default=None, max_length=4000)

    @field_validator("reply")
    @classmethod
    def reply_not_blank(cls, value: str) -> str:
        cleaned = clean(value)
        if not cleaned:
            raise ValueError("the reply is empty")
        return cleaned

    @field_validator("sent_text")
    @classmethod
    def tidy_sent(cls, value: str | None) -> str | None:
        return None if value is None else (clean(value) or None)


class Pickup(BaseModel):
    start_at: str = Field(min_length=1, max_length=64)


class SendRequest(BaseModel):
    sent_text: str | None = Field(default=None, max_length=4000)