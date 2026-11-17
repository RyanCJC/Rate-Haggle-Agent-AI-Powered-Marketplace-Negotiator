import os
import uuid
from decimal import Decimal

import pytest
from dotenv import load_dotenv
from pydantic import ValidationError

from backend.app.memory.embed import DIM, embed
from backend.app.memory.models import DealRecord, Preferences, check_profile_id
from backend.app.memory.store import InMemoryMemory, PgMemory

load_dotenv()

HAS_DB = bool(os.environ.get("DATABASE_URL"))


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


def deal(run_id, title, category="monitors", final=800, outcome="deal"):
    return DealRecord(
        run_id=run_id,
        item_title=title,
        category=category,
        asking=Decimal(1200),
        final_price=Decimal(final) if final else None,
        outcome=outcome,
        mode="copilot",
        rounds=3,
    )


@pytest.fixture(
    params=[
        "memory",
        pytest.param(
            "pg",
            marks=pytest.mark.skipif(not HAS_DB, reason="DATABASE_URL is not set"),
        ),
    ]
)
def store(request):
    impl = InMemoryMemory() if request.param == "memory" else PgMemory(os.environ["DATABASE_URL"])
    created: list[str] = []

    def new_profile() -> str:
        pid = uuid.uuid4().hex
        created.append(pid)
        return pid

    yield impl, new_profile
    for pid in created:
        impl.clear(pid)


# -- embedder ---------------------------------------------------------------------------------


def test_embed_is_unit_length_and_deterministic():
    first, second = embed("Dell 27 inch gaming monitor"), embed("Dell 27 inch gaming monitor")
    assert len(first) == DIM
    assert first == second
    assert abs(cosine(first, first) - 1.0) < 1e-9


def test_embed_ranks_similar_items_above_unrelated_ones():
    query = embed("27 inch monitor monitors")
    close = embed("Dell 27 inch gaming monitor 144hz monitors")
    far = embed("iPhone 13 128GB phones")
    assert cosine(query, close) >= 0.4
    assert cosine(query, far) < 0.25


def test_embed_refuses_empty_text():
    for text in ("", "   ", "!!!"):
        with pytest.raises(ValueError):
            embed(text)


# -- models -----------------------------------------------------------------------------------


def test_profile_id_must_be_32_lowercase_hex():
    assert check_profile_id(uuid.uuid4().hex)
    for bad in ("", "abc", "G" * 32, "A" * 32, "a" * 31, "a" * 33, "a" * 32 + "\n", None):
        with pytest.raises(ValueError):
            check_profile_id(bad)


def test_preferences_validation_and_tidying():
    assert Preferences().pickup_hours == "any"
    assert Preferences(pickup_area="  Bangsar   South \n").pickup_area == "Bangsar South"
    assert Preferences(pickup_area="   ").pickup_area is None
    for bad in (
        {"style": "reckless"},
        {"pickup_hours": "midnight"},
        {"pickup_area": "x" * 81},
        {"budget": "1000"},
    ):
        with pytest.raises(ValidationError):
            Preferences(**bad)


def test_deal_record_has_no_place_for_a_limit():
    names = set(DealRecord.model_fields)
    assert not any(word in name for name in names for word in ("budget", "limit", "max"))
    with pytest.raises(ValidationError):
        DealRecord(
            run_id="r", asking=Decimal(100), outcome="deal", mode="copilot", budget=Decimal(90)
        )


# -- stores (in memory always, Postgres when DATABASE_URL is set) -----------------------------


def test_preferences_roundtrip(store):
    impl, new_profile = store
    pid = new_profile()
    assert impl.get_preferences(pid) == Preferences()
    saved = Preferences(style="safe", pickup_hours="evening", pickup_area="Bangsar")
    impl.set_preferences(pid, saved)
    assert impl.get_preferences(pid) == saved
    assert impl.get_preferences(new_profile()) == Preferences()  # another profile is untouched


def test_recording_a_deal_twice_stores_it_once(store):
    impl, new_profile = store
    pid = new_profile()
    run = uuid.uuid4().hex
    assert impl.record_deal(pid, deal(run, "Dell 27 inch monitor")) is True
    assert impl.record_deal(pid, deal(run, "Dell 27 inch monitor")) is False
    assert len(impl.list_deals(pid)) == 1


def test_similar_deals_find_matching_items_only(store):
    impl, new_profile = store
    pid = new_profile()
    impl.record_deal(pid, deal(uuid.uuid4().hex, "Dell 27 inch gaming monitor 144hz"))
    impl.record_deal(pid, deal(uuid.uuid4().hex, "iPhone 13 128GB", "phones", "1500"))
    found = impl.similar_deals(pid, "27 inch monitor", "monitors")
    assert [d.item_title for d in found] == ["Dell 27 inch gaming monitor 144hz"]
    assert found[0].final_price == Decimal(800)
    assert found[0].similarity >= 0.4


def test_similar_deals_skip_unfinished_runs_and_other_profiles(store):
    impl, new_profile = store
    mine, other = new_profile(), new_profile()
    impl.record_deal(mine, deal(uuid.uuid4().hex, "Dell 27 inch monitor", outcome="we_walk", final=None))
    impl.record_deal(other, deal(uuid.uuid4().hex, "Dell 27 inch monitor"))
    assert impl.similar_deals(mine, "27 inch monitor", "monitors") == []
    assert len(impl.similar_deals(other, "27 inch monitor", "monitors")) == 1


def test_similar_deals_respect_the_limit(store):
    impl, new_profile = store
    pid = new_profile()
    for index in range(4):
        impl.record_deal(pid, deal(uuid.uuid4().hex, f"Dell 27 inch monitor model {index}"))
    assert len(impl.similar_deals(pid, "27 inch monitor", "monitors", limit=2)) == 2


def test_forget_one_deal_and_clear_everything(store):
    impl, new_profile = store
    pid = new_profile()
    first, second = uuid.uuid4().hex, uuid.uuid4().hex
    impl.record_deal(pid, deal(first, "Dell 27 inch monitor"))
    impl.record_deal(pid, deal(second, "LG 24 inch monitor"))
    impl.set_preferences(pid, Preferences(style="safe"))
    assert impl.forget_deal(pid, first) is True
    assert impl.forget_deal(pid, first) is False
    assert [d.run_id for d in impl.list_deals(pid)] == [second]
    assert impl.clear(pid) == 1
    assert impl.list_deals(pid) == []
    assert impl.get_preferences(pid) == Preferences()