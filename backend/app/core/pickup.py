from datetime import datetime
from decimal import Decimal

from .calendar_rules import MYT


def _clock(local: datetime) -> str:
    hour = local.hour % 12 or 12
    return f"{hour} {'am' if local.hour < 12 else 'pm'}"


def _day(local: datetime) -> str:
    return f"{local:%a} {local.day} {local:%b}"


def describe_slot(iso: str) -> str:
    """'Tue 4 Mar, 3 pm', in Malaysia time."""
    local = datetime.fromisoformat(iso).astimezone(MYT)
    return f"{_day(local)}, {_clock(local)}"


def pickup_message(price: Decimal, slots: list[str]) -> str | None:
    """The message to send the seller. Written by code: only the agreed price and free times."""
    if not slots:
        return None
    by_day: dict[str, list[str]] = {}
    for iso in slots:
        local = datetime.fromisoformat(iso).astimezone(MYT)
        by_day.setdefault(_day(local), []).append(_clock(local))
    when = ", or ".join(f"{day} at {' or '.join(times)}" for day, times in by_day.items())
    amount = f"{Decimal(price):,.2f}".rstrip("0").rstrip(".")
    return (
        f"Great, RM {amount} it is. Could we do pickup on {when}? "
        "Let me know which time works for you."
    )