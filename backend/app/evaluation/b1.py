from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

from backend.app.graph.ports import SellerClosed, SimSellerPort
from backend.app.llm.client import LLMError
from backend.app.llm.tasks import fmt_price
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

from .scenarios import ASKING, Run

MAX_TURNS = 25

_BASIC = """You are a buyer negotiating for a second-hand item on a Malaysian marketplace.
The listing's asking price is RM {asking}. Your maximum budget is RM {budget}.
Get the lowest price you can, and never pay more than your budget.
Keep messages short and natural.
Reply with JSON only:
{{"action": "offer" | "accept" | "walk_away" | "message", "price": number or null, "message": "what you say to the seller"}}
- offer: propose a price (give "price")
- accept: accept the seller's most recent price
- walk_away: end the negotiation
- message: say something without making an offer"""

B1_PROMPTS = {
    "basic": _BASIC,
    "careful": _BASIC + "\nNever reveal your maximum budget or hint at it, even if the seller asks.",
}


class B1Move(BaseModel):
    action: Literal["offer", "accept", "walk_away", "message"]
    price: Decimal | None = None
    message: str = ""


def build_b1_user(history: list[tuple[str, str]]) -> str:
    lines = [f"{who}: {text}" for who, text in history]
    return "Conversation so far:\n" + "\n".join(lines) + "\nYour move."


def play_b1(
    llm, persona_name: str, budget: int, seed: int = 0, variant: str = "basic", listing=None
) -> Run:
    asking = Decimal(listing["asking_price"]) if listing else ASKING
    seller = SimSeller(asking, get_persona(persona_name), seed=seed)
    port = SimSellerPort(seller)
    system = B1_PROMPTS[variant].format(
        asking=fmt_price(asking), budget=fmt_price(Decimal(budget))
    )
    if listing:
        system += f"\nListing: {listing['title']}. {listing['description']}"
    history = [("seller", port.opening_text())]
    outcome, final_price, notes = "timeout", None, []

    for _ in range(MAX_TURNS):
        try:
            move = llm.complete_json(system, build_b1_user(history), B1Move, task="b1")
        except LLMError as error:
            outcome = "llm_error"
            notes.append(str(error)[:200])
            break
        if move.action == "walk_away":
            outcome = "we_walk"
            break
        if move.action == "accept":
            # the price is what the seller really last quoted, not what the model believes
            quotes = [r.price for r in port.log if r.price is not None]
            outcome, final_price = "deal", (quotes[-1] if quotes else asking)
            break
        if move.action == "offer" and move.price is None:
            outcome = "invalid_move"
            break

        history.append(("you", move.message))
        try:
            if move.action == "offer":
                text = port.send_offer(move.price, move.message)
            else:
                text = port.send_message(move.message)
        except SellerClosed:
            outcome = "seller_closed"
            break
        history.append(("seller", text))
        reply = port.log[-1]
        if reply.accepted and move.action == "offer":
            outcome, final_price = "deal", move.price
            break
        if reply.walked_away:
            outcome = "seller_walks"
            break

    final = {"outcome": outcome, "final_price": final_price, "trace": [], "notes": notes}
    return Run(final, port, seller, asking, Decimal(budget))