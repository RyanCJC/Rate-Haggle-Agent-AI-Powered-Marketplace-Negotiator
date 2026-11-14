from decimal import Decimal
from typing import TypedDict


class NegState(TypedDict, total=False):
    asking_price: Decimal
    max_budget: Decimal  # PRIVATE: never put in a prompt; prompts use ctx.public_view()
    style: str
    our_offers: list[Decimal]
    turns: list  # every message sent, in order: the price, or None for a question
    seller_prices: list[Decimal]
    history: list[tuple[str, str]]
    decision: dict  # plain JSON data, so checkpoints stay safe to deserialize
    draft: str | None
    feedback: str
    retries: int
    validation_ok: bool
    seller_probed: bool
    seller_text: str
    seller_gave_price: bool
    terms_changed: bool
    asks: int
    notes: list[str]  # results of clarify tools
    listing: dict | None
    comparables: list[Decimal] | None
    outcome: str | None  # deal | we_walk | seller_walks | extraction_miss | timeout
    final_price: Decimal | None
    trace: list[dict]


def initial_state(
    asking: Decimal,
    budget: Decimal,
    style: str = "balanced",
    opening_text: str | None = None,
    listing: dict | None = None,
    comparables: list[Decimal] | None = None,
) -> NegState:
    return {
        "asking_price": Decimal(asking),
        "max_budget": Decimal(budget),
        "style": style,
        "our_offers": [],
        "turns": [],
        "seller_prices": [Decimal(asking)],
        "history": [("seller", opening_text)] if opening_text else [],
        "draft": None,
        "feedback": "",
        "retries": 0,
        "validation_ok": False,
        "seller_probed": False,
        "seller_text": "",
        "seller_gave_price": True,
        "terms_changed": False,
        "asks": 0,
        "notes": [],
        "listing": listing,
        "comparables": comparables,
        "outcome": None,
        "final_price": None,
        "trace": [],
    }