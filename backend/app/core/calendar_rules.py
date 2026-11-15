from datetime import datetime, timedelta, timezone

MYT = timezone(timedelta(hours=8))  # Malaysia has no daylight saving
OPEN_HOURS = range(10, 20)  # a pickup may start at 10:00, 11:00 ... 19:00
LEAD = timedelta(hours=24)  # slots need a day's notice


def candidate_slots(
    now: datetime, taken: set[datetime], count: int = 3, days: int = 7
) -> list[datetime]:
    """The earliest free hourly slots, in order."""
    earliest = now + LEAD
    first_day = now.astimezone(MYT).date()
    found: list[datetime] = []
    for offset in range(days + 2):
        day = first_day + timedelta(days=offset)
        for hour in OPEN_HOURS:
            start = datetime(day.year, day.month, day.day, hour, tzinfo=MYT)
            if start >= earliest and start not in taken:
                found.append(start)
                if len(found) == count:
                    return found
    return found


def validate_slot(start: datetime, now: datetime) -> str | None:
    """Why this is not a bookable slot, or None if it is."""
    if start.tzinfo is None:
        return "start_at needs a timezone"
    local = start.astimezone(MYT)
    if local.minute or local.second or local.microsecond:
        return "slots start on the hour"
    if local.hour not in OPEN_HOURS:
        return "outside pickup hours (slots start between 10:00 and 19:00)"
    if start < now + LEAD:
        return "too soon: slots need 24 hours notice"
    return None


def to_myt_iso(value: str) -> str:
    """The same instant written in Malaysia time, so every caller sees one format."""
    return datetime.fromisoformat(value).astimezone(MYT).isoformat()