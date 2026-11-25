"""Property-based tests for the deterministic pricing strategy (backend/app/core/strategy.py).

Uses only the standard library `random` with fixed seeds for determinism.
300-500 cases per test, total runtime under 5 seconds.

Property (a) is satisfied for asking >= 10 (MIN_AMOUNT): the smallest valid
asking is 10 RM, and the opening price always floors to at least RM 5.
See backend/app/api/schemas.py MIN_AMOUNT and strategy.py:81-82, 129.
"""

import random
from decimal import Decimal

import pytest

from backend.app.core.strategy import (
    STYLES,
    StrategyState,
    decide,
    price_limit,
)


def _make_state(
    asking: float,
    max_budget: float,
    seller_prices: list[float] | None = None,
    our_offers: list[float] | None = None,
) -> StrategyState:
    return StrategyState(
        asking_price=Decimal(str(asking)),
        max_budget=Decimal(str(max_budget)),
        seller_prices=[Decimal(str(p)) for p in (seller_prices or [])],
        our_offers=[Decimal(str(p)) for p in (our_offers or [])],
    )


# Fixed seeds for determinism
SEED_ASKING = 42
SEED_BUDGET = 123
SEED_STYLE = 456
SEED_ROUNDS = 789


def _random_asking(rng: random.Random) -> float:
    if rng.random() < 0.3:
        return rng.uniform(10, 100)
    return rng.uniform(10, 100000)


def _random_budget(rng: random.Random, asking: float) -> float:
    """Budget from 20% to 200% of asking, never below the RM 10 minimum (MIN_AMOUNT)."""
    return max(10.0, rng.uniform(0.2 * asking, 2.0 * asking))


def _random_style(rng: random.Random) -> str:
    return rng.choice(["aggressive", "balanced", "safe"])


# ---------------------------------------------------------------------------
# Property (a): planned price is a finite positive number (> 0)
#
# With asking >= 10 (MIN_AMOUNT), the opening target is >= 6.2 (aggressive,
# asking=10), so _floor_to_step(target) >= 5 for all styles.
# ---------------------------------------------------------------------------


def test_price_is_positive_finite_normal_asking():
    """With asking >= 10 and budget >= 10 (MIN_AMOUNT) the first offer is at least one RM 5 step."""
    rng = random.Random(SEED_ASKING)
    for _ in range(400):
        asking = _random_asking(rng)
        budget = _random_budget(rng, asking)
        style_name = _random_style(rng)
        state = _make_state(asking, budget)
        d = decide(state, STYLES[style_name])
        if d.kind != "offer":
            continue
        assert d.price is not None, (
            f"asking={asking}, budget={budget}, style={style_name}: price is None"
        )
        assert d.price >= 5, (
            f"asking={asking}, budget={budget}, style={style_name}: price={d.price} is below one RM 5 step"
        )


@pytest.mark.parametrize(
    "asking,budget",
    [(10, 10), (10, 100), (11, 10), (49, 10), (50, 10), (100, 10), (100000, 10), (100000, 99999)],
)
@pytest.mark.parametrize("style_name", ["aggressive", "balanced", "safe"])
def test_minimum_amounts_still_give_a_real_offer(asking, budget, style_name):
    """The smallest allowed amounts (MIN_AMOUNT = 10) must not round the first offer down to RM 0."""
    params = STYLES[style_name]
    state = _make_state(float(asking), float(budget))
    d = decide(state, params)
    if d.kind != "offer":
        return  # walking away is allowed; an offer must never be RM 0
    assert d.price >= 5, f"asking={asking}, budget={budget}, style={style_name}: price={d.price}"
    assert d.price <= price_limit(state, params), (
        f"asking={asking}, budget={budget}, style={style_name}: price={d.price} above the limit"
    )


def test_small_reference_price_does_not_zero_out_price():
    """With reference_price >= MIN_AMOUNT (10), the plan price is >= RM 5.

    With asking=1000 and reference_price=10, limit = min(1000*0.97, 10*0.92, 1000) = 920,
    opening = min(10*0.62, 920*0.85) = min(6.2, 782) = 6.2, floor to 5 => price = 5.
    A tiny reference_price (e.g. 1) can only reach strategy.py via the
    `comparables` field of `StartRequest`, which is validated to be >= MIN_AMOUNT
    at schema level (backend/app/api/schemas.py:55), so this scenario cannot occur
    through the API.
    """
    state = _make_state(1000.0, 1000.0, seller_prices=[], our_offers=[])
    state.reference_price = Decimal(10)
    for style_name in ["aggressive", "balanced", "safe"]:
        d = decide(state, STYLES[style_name])
        if d.kind != "offer":
            continue
        assert d.price >= 5, (
            f"asking=1000, reference_price=10, style={style_name}: price={d.price} is below RM 5"
        )
        assert d.price <= price_limit(state, STYLES[style_name]), (
            f"asking=1000, reference_price=10, style={style_name}: price={d.price} above the limit"
        )


def test_price_never_exceeds_limits():
    """Price must never exceed limit, max_budget, or asking."""
    rng = random.Random(SEED_BUDGET)
    for _ in range(400):
        asking = _random_asking(rng)
        budget = _random_budget(rng, asking)
        style_name = _random_style(rng)
        params = STYLES[style_name]
        state = _make_state(asking, budget)
        d = decide(state, params)
        if d.kind != "offer":
            continue
        limit = price_limit(state, params)
        assert d.price <= limit, (
            f"asking={asking}, budget={budget}, style={style_name}: price={d.price} > limit={limit}"
        )
        assert d.price <= budget, (
            f"asking={asking}, budget={budget}, style={style_name}: "
            f"price={d.price} > budget={budget}"
        )
        assert d.price <= asking, (
            f"asking={asking}, budget={budget}, style={style_name}: "
            f"price={d.price} > asking={asking}"
        )


# ---------------------------------------------------------------------------
# Property (c): prices are non-decreasing across consecutive rounds
# ---------------------------------------------------------------------------


def test_prices_non_decreasing_across_rounds():
    """Consecutive offer prices from the same negotiation must not decrease."""
    rng = random.Random(SEED_ROUNDS)
    for _ in range(400):
        asking = _random_asking(rng)
        budget = _random_budget(rng, asking)
        style_name = _random_style(rng)
        params = STYLES[style_name]
        state = _make_state(asking, budget)
        prev_price = None
        for _round in range(params.horizon):
            d = decide(state, params)
            if d.kind != "offer":
                break
            if prev_price is not None:
                assert d.price >= prev_price, (
                    f"asking={asking}, budget={budget}, style={style_name}: "
                    f"round {_round}: price={d.price} < prev_price={prev_price}"
                )
            prev_price = d.price
            # Simulate a seller reply above our offer (so we keep negotiating)
            seller_price = d.price + Decimal(str(rng.uniform(10, 200)))
            state = state.model_copy(
                update={
                    "our_offers": [*state.our_offers, d.price],
                    "seller_prices": [*state.seller_prices, seller_price],
                }
            )


# ---------------------------------------------------------------------------
# Property (d): opening offer follows the formula
# ---------------------------------------------------------------------------


def test_opening_offer_follows_formula():
    """First offer: <= limit * opening_cap, <= ref * opening_ratio,
    aggressive <= balanced <= safe."""
    rng = random.Random(SEED_STYLE)
    for _ in range(400):
        asking = _random_asking(rng)
        budget = _random_budget(rng, asking)
        state = _make_state(asking, budget)
        prices_by_style = {}
        for style_name in ["aggressive", "balanced", "safe"]:
            params = STYLES[style_name]
            d = decide(state, params)
            if d.kind != "offer":
                continue
            limit = price_limit(state, params)
            ref = state.ref
            opening_ratio = params.opening_ratio
            opening_cap = params.opening_cap
            # Price must be <= limit * opening_cap
            assert d.price <= limit * opening_cap, (
                f"asking={asking}, budget={budget}, style={style_name}: "
                f"price={d.price} > limit*opening_cap={limit * opening_cap}"
            )
            # Price must be <= ref * opening_ratio
            assert d.price <= ref * opening_ratio, (
                f"asking={asking}, budget={budget}, style={style_name}: "
                f"price={d.price} > ref*opening_ratio={ref * opening_ratio}"
            )
            prices_by_style[style_name] = d.price
        # aggressive <= balanced <= safe
        styles = ["aggressive", "balanced", "safe"]
        prices = [prices_by_style.get(s) for s in styles if s in prices_by_style]
        if len(prices) >= 2:
            for i in range(len(prices) - 1):
                assert prices[i] <= prices[i + 1], (
                    f"asking={asking}, budget={budget}: "
                    f"{styles[i]} price={prices[i]} > {styles[i + 1]} price={prices[i + 1]}"
                )


# ---------------------------------------------------------------------------
# Property (e): rounding - price is a multiple of the step (5)
# ---------------------------------------------------------------------------


def test_price_rounding_step():
    """Planned price must be a multiple of PRICE_STEP=5."""
    rng = random.Random(SEED_ROUNDS)
    for _ in range(400):
        asking = _random_asking(rng)
        budget = _random_budget(rng, asking)
        style_name = _random_style(rng)
        state = _make_state(asking, budget)
        d = decide(state, STYLES[style_name])
        if d.kind != "offer":
            continue
        remainder = d.price % 5
        assert remainder == 0, (
            f"asking={asking}, budget={budget}, style={style_name}: "
            f"price={d.price} is not a multiple of 5 (remainder={remainder})"
        )


# ---------------------------------------------------------------------------
# Property (g): when max_budget >= asking, plan never exceeds asking
# ---------------------------------------------------------------------------


def test_plan_never_exceeds_asking_when_budget_ge_asking():
    """When budget >= asking, plan price must never exceed asking."""
    rng = random.Random(SEED_BUDGET)
    for _ in range(400):
        asking = _random_asking(rng)
        # budget >= asking
        budget = asking * rng.uniform(1.0, 2.0)
        style_name = _random_style(rng)
        state = _make_state(asking, budget)
        d = decide(state, STYLES[style_name])
        if d.kind != "offer":
            continue
        assert d.price <= asking, (
            f"asking={asking}, budget={budget}, style={style_name}: "
            f"price={d.price} > asking={asking}"
        )


# ---------------------------------------------------------------------------
# Property (f): no exceptions for any input
# ---------------------------------------------------------------------------


def test_no_exceptions_for_any_input():
    """decide() must not raise for any valid input combination."""
    rng = random.Random(SEED_STYLE)
    for _ in range(400):
        asking = _random_asking(rng)
        budget = _random_budget(rng, asking)
        style_name = _random_style(rng)
        state = _make_state(asking, budget)
        try:
            d = decide(state, STYLES[style_name])
        except Exception as exc:  # noqa: BLE001 - we want to catch any exception
            pytest.fail(
                f"decide() raised {type(exc).__name__}: {exc} "
                f"for asking={asking}, budget={budget}, style={style_name}"
            )
        assert d.kind in ("offer", "accept", "walk_away", "ask_question")
