from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from backend.app.core.utility import (
    Condition,
    Deal,
    PriceRange,
    UtilityWeights,
    utility,
)

RANGE = PriceRange(best=Decimal(500), worst=Decimal(900))


def test_lower_price_is_better():
    cheap = Deal(price=Decimal(600))
    dear = Deal(price=Decimal(800))
    assert utility(cheap, RANGE) > utility(dear, RANGE)


def test_price_only_weights_hit_both_ends():
    w = UtilityWeights(price=1, distance=0, condition=0, warranty=0)
    assert utility(Deal(price=Decimal(500)), RANGE, w) == pytest.approx(1.0)
    assert utility(Deal(price=Decimal(900)), RANGE, w) == pytest.approx(0.0)


def test_cheaper_but_far_can_lose_to_dearer_but_near():
    far = Deal(price=Decimal(700), distance_km=25)
    near = Deal(price=Decimal(750), distance_km=2)
    assert utility(near, RANGE) > utility(far, RANGE)


def test_better_condition_and_warranty_help():
    base = Deal(price=Decimal(700), condition=Condition.FAIR)
    better = Deal(price=Decimal(700), condition=Condition.LIKE_NEW, warranty_months=6)
    assert utility(better, RANGE) > utility(base, RANGE)


def test_weights_normalize_to_one():
    w = UtilityWeights(price=3, distance=1, condition=1, warranty=1).normalized()
    assert w.price + w.distance + w.condition + w.warranty == pytest.approx(1.0)


def test_price_range_must_be_ordered():
    with pytest.raises(ValueError):
        PriceRange(best=Decimal(900), worst=Decimal(500))


@given(
    price=st.decimals(min_value=Decimal(0), max_value=Decimal(5000), places=2),
    km=st.floats(min_value=0, max_value=500),
    cond=st.sampled_from(list(Condition)),
    months=st.integers(min_value=0, max_value=60),
)
def test_utility_always_between_zero_and_one(price, km, cond, months):
    deal = Deal(price=price, distance_km=km, condition=cond, warranty_months=months)
    assert 0.0 <= utility(deal, RANGE) <= 1.0