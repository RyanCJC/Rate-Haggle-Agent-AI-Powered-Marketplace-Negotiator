import re
from decimal import Decimal

from .models import NegotiationContext, Violation

PRIVATE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bmax(?:imum)?\s+budget\b",
        r"\bmy\s+budget\b",
        r"\bbudget\s+(?:is|of|limit)\b",
        r"\bmy\s+(?:limit|ceiling)\b",
        r"\bhighest\s+i\s+can\b",
        r"\bwalk[- ]?away\s+(?:price|point)\b",
    )
]

_AMOUNT = re.compile(
    r"(?<![\w.,])(?P<cur>RM|MYR|\$)?\s?"
    r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?P<k>k)?(?:\s?(?P<suffix>[A-Za-z%\"]+))?",
    re.IGNORECASE,
)

MONEY_WORDS = {"rm", "myr", "ringgit", "ringgits"}
NON_MONEY_UNITS = {
    "gb", "tb", "mb", "kb", "inch", "in", "hz", "mah", "mp", "w", "wh", "%", '"',
    "month", "months", "day", "days", "year", "years", "yr", "yrs", "hour", "hours",
    "unit", "units", "pc", "pcs", "piece", "pieces", "g", "kg", "cm", "mm", "x",
}


def _looks_like_year(raw: str, value: Decimal) -> bool:
    return "," not in raw and "." not in raw and Decimal(1990) <= value <= Decimal(2035)


def extract_amounts(text: str, asking_price: Decimal) -> list[Decimal]:
    """Return numbers in `text` that plausibly are prices."""
    floor = asking_price * Decimal("0.2")  # tiny bare numbers are not prices
    amounts: list[Decimal] = []
    for m in _AMOUNT.finditer(text):
        raw = m.group("num").replace(",", "")
        value = Decimal(raw)
        if m.group("k"):
            value *= 1000
        suffix = (m.group("suffix") or "").lower()
        marked = bool(m.group("cur")) or suffix in MONEY_WORDS
        if not marked:
            if suffix in NON_MONEY_UNITS:
                continue
            if _looks_like_year(raw, value):
                continue
            if value < floor:
                continue
        amounts.append(value)
    return amounts


def check_outbound(text: str, ctx: NegotiationContext, ceiling: Decimal) -> list[Violation]:
    """Check text before it is sent to the seller.

    `ceiling` is the highest price this message may mention (the price being offered,
    or our current offer). Prices the seller already said are always allowed.
    """
    violations: list[Violation] = []

    for pattern in PRIVATE_PATTERNS:
        if pattern.search(text):
            violations.append(
                Violation(
                    code="private_phrase",
                    public_message="The message talks about private limits. Remove that.",
                    private_detail=pattern.pattern,
                )
            )
            break

    public = {p for p in (ctx.asking_price, ctx.seller_last_price) if p is not None}
    for amount in extract_amounts(text, ctx.asking_price):
        if amount > ceiling and amount not in public:
            violations.append(
                Violation(
                    code="number_above_ceiling",
                    public_message=(
                        "The message mentions a price above your current offer. "
                        "Remove it or use your current offer."
                    ),
                    private_detail=f"{amount} > {ceiling}",
                )
            )
            break

    return violations