import re
from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Literal

from .categories import CATEGORIES

Status = Literal["confirmed", "claimed", "missing", "conflicting"]

DEFAULT_KEYS = ("condition", "age", "warranty", "defects", "accessories")
# Edit these to match the categories in your seed data (the seed script prints them).
EXTRA_KEYS = {c.name: c.extra_keys for c in CATEGORIES if c.extra_keys}


ADDITIVE_KEYS = {"accessories"}  # several values are normal, not a conflict

_FLAGS = re.IGNORECASE
_PATTERNS = {
    "condition": r"\b(brand new|like new|almost new|good condition|excellent condition"
    r"|fair condition|well[- ]used|heavily used)\b",
    "age": r"\b(\d+(?:\.\d+)?\s*(?:months?|years?|yrs?))\s+(?:old|of use|used)\b",
    "warranty": r"\b(no warranty|out of warranty"
    r"|(?:\d+\s*(?:months?|years?)\s*)?(?:warranty|waranti)(?:\s*(?:left|remaining))?)\b",
    "defects": r"\b(no defects?|no issues?|no scratch(?:es)?|minor scratch(?:es)?"
    r"|small scratch(?:es)?|scratch(?:es)?|cracked?|dead pixels?|dents?)\b",
    "accessories": r"\b(original box|box|charger|cable|receipt|remote|complete set|full set)\b",
    "size_inch": r"\b(\d{2}(?:\.\d)?)\s*(?:-?\s*inch(?:es)?|\")",
    "refresh_rate": r"\b(\d{2,3})\s*hz\b",
    "storage": r"\b(\d{2,4}\s*(?:gb|tb))\b",
    "battery_health": r"\bbattery(?: health)?\s*:?\s*(\d{2,3})\s*%|\b(\d{2,3})\s*%\s*battery\b",
    "shutter_count": r"\b(\d{1,3}(?:,\d{3})+|\d{3,6})\s*(?:shutter count|shutter actuations?"
    r"|actuations?|clicks)\b|\bshutter count\s*:?\s*(\d{1,3}(?:,\d{3})+|\d{3,6})\b",
}


@dataclass(frozen=True)
class Claim:
    key: str
    value: str
    source: str  # listing | seller_chat | spec
    quote: str  # verbatim text the claim came from


@dataclass(frozen=True)
class Fact:
    key: str
    value: str | None
    source: str
    status: Status
    evidence_ref: str | None


def required_keys(category: str) -> tuple[str, ...]:
    return DEFAULT_KEYS + EXTRA_KEYS.get(category.lower(), ())


def normalize(value: str) -> str:
    """'6 Months  Warranty' and '6 months warranty' count as the same claim."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def extract_claims(text: str, source: str) -> list[Claim]:
    claims = []
    for key, pattern in _PATTERNS.items():
        for match in re.finditer(pattern, text, _FLAGS):
            value = next((g for g in match.groups() if g), match.group(0))
            claims.append(Claim(key, value.strip(), source, match.group(0)))
    return claims


def reconcile(claims: list[Claim], required: tuple[str, ...] = DEFAULT_KEYS) -> list[Fact]:
    by_key: dict[str, list[Claim]] = defaultdict(list)
    for claim in claims:
        by_key[claim.key].append(claim)

    facts = []
    for key in dict.fromkeys([*required, *by_key]):  # required keys first, in order
        group = by_key.get(key, [])
        if not group:
            facts.append(Fact(key, None, "none", "missing", None))
            continue
        sources = {c.source for c in group}
        distinct = list(dict.fromkeys(c.value for c in group))
        evidence = " | ".join(f"{c.source}: {c.quote}" for c in group)
        if key in ADDITIVE_KEYS:
            status: Status = "confirmed" if len(sources) >= 2 else "claimed"
            value = ", ".join(dict.fromkeys(v.lower() for v in distinct))
        elif len({normalize(v) for v in distinct}) > 1:
            status, value = "conflicting", " / ".join(distinct)
        else:
            status = "confirmed" if len(sources) >= 2 else "claimed"
            value = distinct[0]
        facts.append(Fact(key, value, "+".join(sorted(sources)), status, evidence))
    return facts

def merge_claims(existing: list[dict], new: list[Claim]) -> list[dict]:
    """Add claims, skipping repeats of the same key, value and source."""
    seen = {(c["key"], normalize(c["value"]), c["source"]) for c in existing}
    merged = list(existing)
    for claim in new:
        marker = (claim.key, normalize(claim.value), claim.source)
        if marker not in seen:
            seen.add(marker)
            merged.append(asdict(claim))
    return merged


def facts_view(claims: list[dict], category: str) -> list[dict]:
    """Reconcile claims into plain dicts (safe to store in a checkpoint)."""
    facts = reconcile([Claim(**c) for c in claims], required_keys(category))
    return [
        {
            "key": f.key,
            "value": f.value,
            "status": f.status,
            "source": f.source,
            "evidence": f.evidence_ref,
        }
        for f in facts
    ]