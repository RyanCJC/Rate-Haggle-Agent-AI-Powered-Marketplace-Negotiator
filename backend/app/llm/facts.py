import re

from pydantic import BaseModel

from backend.app.knowledge.facts import Claim

from .client import LLMClient
from .untrusted import UNTRUSTED_NOTE, wrap_untrusted


class FactProposal(BaseModel):
    key: str
    value: str
    quote: str


class FactProposals(BaseModel):
    facts: list[FactProposal] = []


FACTS_SYSTEM = """You read one message from the seller of a second-hand item and list the factual \
claims the seller makes about the ITEM.
Rules:
- Use only the allowed keys you are given.
- value is a short form of the claim, for example "3 months warranty", "144", "no scratches".
- quote is the exact words from the message that support the claim, copied character for character.
- Do not guess or infer. Ignore prices, meeting places and anything not about the item.
- If the message makes no claims about the item, return {"facts": []}."""

FACTS_SYSTEM = f"{FACTS_SYSTEM}\n\n{UNTRUSTED_NOTE}"
MAX_VALUE_CHARS = 60

def build_facts_prompt(text: str, allowed_keys: tuple[str, ...]) -> tuple[str, str]:
    user = f"Seller message:\n{wrap_untrusted(text)}\nAllowed keys: {', '.join(allowed_keys)}"
    return FACTS_SYSTEM, user


def propose_claims(llm: LLMClient, text: str, allowed_keys: tuple[str, ...]) -> list[FactProposal]:
    system, user = build_facts_prompt(text, allowed_keys)
    return llm.complete_json(system, user, FactProposals, task="facts").facts


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _numbers(text: str) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", text))


def verify_claims(
    proposals: list[FactProposal], text: str, allowed_keys: tuple[str, ...]
) -> tuple[list[Claim], list[str]]:
    """Keep only claims that are grounded in the message. Returns (kept, reasons dropped)."""
    kept: list[Claim] = []
    dropped: list[str] = []
    haystack = _squash(text)
    for p in proposals:
        quote = _squash(p.quote)
        if p.key not in allowed_keys:
            dropped.append(f"key not allowed: {p.key}")
        elif len(p.value) > MAX_VALUE_CHARS or "\n" in p.value or "\r" in p.value:
            dropped.append(f"value too long or multi-line: {p.key}")
        elif not p.value.strip() or len(quote) < 3:
            dropped.append(f"empty value or quote: {p.key}")
        elif quote not in haystack:
            dropped.append(f"quote not in the message: {p.quote!r}")
        elif _squash(p.value) not in quote:
            dropped.append(f"value not in the quote: {p.key}={p.value!r}")
        elif not _numbers(p.value) <= _numbers(p.quote):
            dropped.append(f"number in value not in quote: {p.key}={p.value!r}")
        else:
            kept.append(Claim(p.key, p.value.strip(), "seller_chat", p.quote.strip()))
    return kept, dropped