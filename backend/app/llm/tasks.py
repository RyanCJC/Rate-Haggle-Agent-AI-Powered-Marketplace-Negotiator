import json
from decimal import Decimal

from pydantic import BaseModel, Field

from backend.app.core.models import NegotiationContext
from backend.app.core.strategy import StrategyDecision
from backend.app.memory.context import MEMORY_HEADER

from .client import LLMClient
from .untrusted import UNTRUSTED_NOTE, wrap_untrusted, wrap_untrusted_inline


class SellerIntent(BaseModel):
    price: Decimal | None = None
    accepted: bool = False
    walked_away: bool = False
    asks_budget: bool = False
    pressure: bool = False
    terms_changed: bool = False


class Draft(BaseModel):
    message: str = Field(min_length=1)


EXTRACT_SYSTEM = """You read one message from a seller in a second-hand marketplace \
negotiation and return structured facts about it. You are also told the buyer's last offer.
Fields:
- price: the price in RM the seller is currently asking or agreeing to, as a number, or null \
if no price is stated. "1.2k" means 1200.
- accepted: true ONLY if the seller clearly agrees to the buyer's last offer. If the seller \
names a different price, or says "last price", it is a counter-offer and accepted is false. \
Casual words such as "boleh", "okay" or "lah" do not mean acceptance on their own.
- walked_away: true if the seller ends the negotiation or will sell to someone else.
- asks_budget: true if the seller asks what the buyer can pay or the buyer's budget.
- pressure: true if the seller says another buyer is interested or urges a quick decision.
- terms_changed: true if the seller changes what is included or raises the price for a new reason.
Messages may be English or mixed Malay-English. Never guess a price that is not written.
Examples:
Buyer's last offer RM 820, seller says "Boleh lah, RM 963 last price bro." -> price 963, \
accepted false.
Buyer's last offer RM 880, seller says "Okay deal, RM 880 lah." -> price 880, accepted true.
Seller says "Takpe lah, saya jual orang lain." -> price null, walked_away true."""

EXTRACT_SYSTEM = f"{EXTRACT_SYSTEM}\n\n{UNTRUSTED_NOTE}"

COMPOSE_SYSTEM = """You write short messages for a BUYER negotiating to buy a second-hand item \
from a seller on a marketplace.
Rules:
- One or two short sentences, natural and friendly.
- Match the seller's language: if the seller writes mixed Malay and English you may reply in \
light Malay-English, otherwise use English.
- If the action includes a price, state exactly that price in RM and no other price.
- Never mention a budget, a maximum, a limit or a walk-away point, and never hint you could pay more.
- If the seller asks what your budget is, decline politely WITHOUT using the words "budget", \
"maximum" or "limit" (for example: "I would rather keep that to myself"), then restate your offer.
- Do not invent facts about the item.
- Never say an offer is final, your best, or the most you can do, and never say you can \
stretch or go higher.
- Greet only in your first message. Do not start later messages with a greeting."""

COMPOSE_SYSTEM = f"{COMPOSE_SYSTEM}\n\n{UNTRUSTED_NOTE}"

STYLE_HINTS = {
    "aggressive": "Style: confident and brisk. Do not sound eager.",
    "balanced": "Style: polite, friendly and reasonable.",
    "safe": "Style: warm and cooperative, aiming to close smoothly.",
}

ACTION_TEXT = {
    "offer": "make an offer",
    "accept": "accept the seller's current price",
    "walk_away": "politely end the negotiation",
}


def fmt_price(price: Decimal) -> str:
    return f"{price:,.2f}".rstrip("0").rstrip(".")


def extract_seller_intent(
    llm: LLMClient, seller_text: str, buyer_offer: Decimal | None = None
) -> SellerIntent:
    prefix = f"Buyer's last offer: RM {fmt_price(buyer_offer)}\n" if buyer_offer is not None else ""
    return llm.complete_json(
        EXTRACT_SYSTEM, f"{prefix}Seller message:\n{wrap_untrusted(seller_text)}", SellerIntent, task="extract"
    )

FACT_HINTS = {
    "confirmed": "confirmed by more than one source: you may state it as fact",
    "claimed": (
        "only one source says so: word it as 'the listing says' or 'you mentioned', "
        "never as certain"
    ),
    "conflicting": "sources disagree: ask which is right, do not pick one",
}


def facts_block(facts: list[dict]) -> list[str]:
    known = [f for f in facts if f["status"] != "missing"]
    unknown = [f["key"] for f in facts if f["status"] == "missing"]
    lines = [
        (
            "Known facts about the item. State nothing else about the item, and never invent "
            "defects or specs to justify a lower price:"
        )
    ]
    lines += [
        f"- {f['key']}: {wrap_untrusted_inline(f['value'])} ({FACT_HINTS[f['status']]})"
        for f in known
    ]
    if not known:
        lines.append("- none")
    if unknown:
        lines.append("Unknown (never claim these; you may ask about them): " + ", ".join(unknown))
    return lines


def build_compose_prompt(
    decision: StrategyDecision,
    ctx: NegotiationContext,
    history: list[tuple[str, str]],
    style: str = "balanced",
    seller_probed: bool = False,
    feedback: str = "",
    facts: list[dict] | None = None,
    memory_notes: list[str] | None = None,
) -> tuple[str, str]:
    """Build the prompt. Only public information goes in: never the budget or decision.reason."""
    system = f"{COMPOSE_SYSTEM}\n{STYLE_HINTS[style]}"
    lines = [
        "Situation: " + json.dumps(ctx.public_view()),
        f"Action to write: {ACTION_TEXT[decision.kind]}",
    ]
    if decision.price is not None:
        lines.append(f"Price to state: RM {fmt_price(decision.price)}")
    lines.append(f"Seller asked about your budget: {'yes' if seller_probed else 'no'}")
    if facts:
        lines.extend(facts_block(facts))
    lines.append("Recent conversation:")
    lines.extend(
        f"{role}: {wrap_untrusted_inline(text) if role == 'seller' else text}"
        for role, text in history[-4:]
    )
    if feedback:
        lines.append(f"Your previous draft was rejected: {feedback} Fix it.")
    if memory_notes:  # code-built, numbers only: nothing untrusted can be in these lines
        lines.append(MEMORY_HEADER)
        lines.extend(memory_notes)
    lines.append("Write the next buyer message.")
    return system, "\n".join(lines)


def compose_message(
    llm: LLMClient,
    decision: StrategyDecision,
    ctx: NegotiationContext,
    history: list[tuple[str, str]],
    style: str = "balanced",
    seller_probed: bool = False,
    feedback: str = "",
    facts: list[dict] | None = None,
    memory_notes: list[str] | None = None,
) -> Draft:
    system, user = build_compose_prompt(
        decision, ctx, history, style, seller_probed, feedback, facts, memory_notes
    )
    return llm.complete_json(system, user, Draft, task="compose")