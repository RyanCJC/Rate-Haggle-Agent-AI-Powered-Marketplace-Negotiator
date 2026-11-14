from typing import Literal

from pydantic import BaseModel

from .client import LLMClient


class ClarifyStep(BaseModel):
    tool: Literal["get_listing", "get_market_stats", "ask_seller", "proceed"]
    question: str = ""


CLARIFY_SYSTEM = """You are the planning step of a buyer's negotiation agent. Before the buyer \
replies to the seller you may use tools, in at most a few steps.
Tools:
- get_listing: read the listing details.
- get_market_stats: read asking prices of similar items.
- ask_seller: send the seller ONE short question instead of an offer this turn. Use it only when \
the seller's last message gave no price or changed the terms, and only if questions are left.
- proceed: stop planning; the buyer will write the normal reply.
Never put numbers, budgets or limits in a question. Return the tool and, for ask_seller, the \
question text."""


def build_clarify_prompt(
    seller_text: str,
    gave_price: bool,
    terms_changed: bool,
    asks_left: int,
    step_no: int,
    results: list[tuple[str, str]],
    max_steps: int = 4,
) -> tuple[str, str]:
    lines = [
        f"Seller's last message: {seller_text}",
        f"Seller's last message had a price: {'yes' if gave_price else 'no'}",
        f"Seller changed terms: {'yes' if terms_changed else 'no'}",
        f"Questions left: {asks_left}",
        f"Step {step_no} of {max_steps}",
    ]
    lines.extend(f"Tool result ({tool}): {output}" for tool, output in results)
    lines.append("Choose the next step.")
    return CLARIFY_SYSTEM, "\n".join(lines)


def choose_clarify_step(
    llm: LLMClient,
    seller_text: str,
    gave_price: bool,
    terms_changed: bool,
    asks_left: int,
    step_no: int,
    results: list[tuple[str, str]],
    max_steps: int = 4,
) -> ClarifyStep:
    system, user = build_clarify_prompt(
        seller_text, gave_price, terms_changed, asks_left, step_no, results, max_steps
    )
    return llm.complete_json(system, user, ClarifyStep, task="clarify")