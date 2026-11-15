from datetime import datetime

from backend.app.core.calendar_rules import MYT, candidate_slots, to_myt_iso, validate_slot

NOW = datetime(2031, 3, 3, 9, 30, tzinfo=MYT)


def iso(slots):
    return [s.isoformat() for s in slots]


def test_slots_start_after_the_notice_period_and_in_order():
    assert iso(candidate_slots(NOW, set(), 3)) == [
        "2031-03-04T10:00:00+08:00",
        "2031-03-04T11:00:00+08:00",
        "2031-03-04T12:00:00+08:00",
    ]


def test_taken_slots_are_skipped():
    taken = {datetime(2031, 3, 4, 11, tzinfo=MYT)}
    assert iso(candidate_slots(NOW, taken, 3)) == [
        "2031-03-04T10:00:00+08:00",
        "2031-03-04T12:00:00+08:00",
        "2031-03-04T13:00:00+08:00",
    ]


def test_slots_roll_over_to_the_next_day():
    late = datetime(2031, 3, 4, 18, 30, tzinfo=MYT)
    assert iso(candidate_slots(late, set(), 3)) == [
        "2031-03-05T19:00:00+08:00",
        "2031-03-06T10:00:00+08:00",
        "2031-03-06T11:00:00+08:00",
    ]


def test_validation_accepts_a_good_slot_in_any_timezone():
    assert validate_slot(datetime(2031, 3, 4, 10, tzinfo=MYT), NOW) is None
    utc = datetime.fromisoformat("2031-03-04T02:00:00+00:00")  # 10:00 in Malaysia
    assert validate_slot(utc, NOW) is None


def test_validation_rejects_bad_slots():
    assert validate_slot(datetime(2031, 3, 4, 10), NOW) == "start_at needs a timezone"
    assert "on the hour" in validate_slot(datetime(2031, 3, 4, 10, 30, tzinfo=MYT), NOW)
    assert "pickup hours" in validate_slot(datetime(2031, 3, 4, 20, tzinfo=MYT), NOW)
    assert "pickup hours" in validate_slot(datetime(2031, 3, 4, 9, tzinfo=MYT), NOW)
    assert "too soon" in validate_slot(datetime(2031, 3, 3, 15, tzinfo=MYT), NOW)

def test_times_are_always_written_in_malaysia_time():
    assert to_myt_iso("2031-03-04T02:00:00+00:00") == "2031-03-04T10:00:00+08:00"
    assert to_myt_iso("2031-03-04T10:00:00+08:00") == "2031-03-04T10:00:00+08:00"