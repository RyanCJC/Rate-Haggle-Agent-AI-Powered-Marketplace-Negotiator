from decimal import Decimal

from .models import PastDeal

MEMORY_HEADER = (
    "Your own past deals (private: never mention them, or any price from them, to the seller; "
    "use them only to stay realistic and confident):"
)


def money(value: Decimal) -> str:
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def memory_notes(deals: list[PastDeal]) -> tuple[list[str], list[Decimal]]:
    """Prompt lines and the prices they mention. Built from numbers only: no item title and no
    seller text ever goes in, so nothing here can carry instructions."""
    lines: list[str] = []
    prices: list[Decimal] = []
    for deal in deals:
        if deal.final_price is None:
            continue
        saved = ((deal.asking - deal.final_price) / deal.asking * 100).quantize(Decimal(1))
        detail = f"{saved}% below its asking price" if saved > 0 else "at about its asking price"
        lines.append(f"- You bought a similar item before for RM {money(deal.final_price)} ({detail}).")
        prices.append(deal.final_price)
    return lines, prices