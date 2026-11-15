import re

from .facts import Claim, extract_claims, normalize

UNCHECKED_KEYS = {"accessories"}  # buyers legitimately ask for the box or charger
_QUESTION_LEAD = re.compile(
    r"^(does|do|is|are|any|can|could|would|will|how|what|which|have|has|did|was|were|why|when|where)\b",
    re.IGNORECASE,
)


def _assertive_sentences(text: str):
    """Sentences that state something. A sentence that opens like a question is skipped."""
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        sentence = sentence.strip()
        if sentence and not (sentence.endswith("?") and _QUESTION_LEAD.match(sentence)):
            yield sentence


def _negated(value: str) -> bool:
    return value.startswith(("no", "outof"))


def _same(a: str, b: str) -> bool:
    if _negated(a) != _negated(b):  # "no scratches" is the opposite of "scratches"
        return False
    return a == b or (min(len(a), len(b)) >= 5 and (a in b or b in a))


def check_claims(text: str, facts: list[dict]) -> tuple[list[Claim], list[Claim]]:
    """Split the item details a message states into (supported by a fact, not supported)."""
    known: dict[str, list[str]] = {}
    for fact in facts:
        if fact["value"] and fact["status"] != "missing":
            known.setdefault(fact["key"], []).extend(
                normalize(part) for part in fact["value"].split(" / ")
            )
    grounded: list[Claim] = []
    ungrounded: list[Claim] = []
    for sentence in _assertive_sentences(text):
        for claim in extract_claims(sentence, "buyer"):
            if claim.key in UNCHECKED_KEYS:
                continue
            value = normalize(claim.value)
            supported = any(_same(value, k) for k in known.get(claim.key, []))
            (grounded if supported else ungrounded).append(claim)
    return grounded, ungrounded


def ungrounded_claims(text: str, facts: list[dict]) -> list[Claim]:
    return check_claims(text, facts)[1]