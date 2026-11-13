from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from backend.app.core.models import Accept, MakeOffer, NegotiationContext, Phase
from backend.app.core.strategy import STYLES, StrategyState, decide, price_limit
from backend.app.core.validate import validate_action

BAL = STYLES["balanced"]


def make_state(asking="1200", budget="900", offers=(), sellers=("1200",)):
    return StrategyState(
        asking_price=Decimal(asking),
        max_budget=Decimal(budget),
        our_offers=[Decimal(x) for x in offers],
        seller_prices=[Decimal(x) for x in sellers],
    )


def test_limit_keeps_a_cushion_below_budget():
    state = make_state()
    assert price_limit(state, BAL) < state.max_budget


def test_opening_offer_is_below_asking_and_capped_below_limit():
    state = make_state()
    d = decide(state, BAL)
    limit = price_limit(state, BAL)
    assert d.kind == "offer"
    assert d.price == Decimal(740)
    assert d.price <= limit * BAL.opening_cap


def test_accepts_when_seller_meets_our_target():
    d = decide(make_state(offers=["740"], sellers=["1200", "750"]), BAL)
    assert d.kind == "accept" and d.price == Decimal(750)


def test_holds_or_raises_slightly_when_seller_is_close_but_not_there():
    d = decide(make_state(offers=["740"], sellers=["1200", "800"]), BAL)
    assert d.kind == "offer" and d.price >= Decimal(740)


def test_walks_away_when_seller_stalls_and_we_are_at_our_ceiling():
    state = make_state(offers=["740", "780", "830", "870"], sellers=["1200"] * 4)
    assert decide(state, BAL).kind == "walk_away"


def test_aggressive_opens_lower_than_safe_when_budget_is_not_the_constraint():
    state = make_state(budget="2000")
    assert decide(state, STYLES["aggressive"]).price < decide(state, STYLES["safe"]).price

def test_keeps_negotiating_when_seller_stalls_but_we_have_room():
    state = make_state(offers=["740", "745", "750"], sellers=["1200"] * 4)
    d = decide(state, BAL)
    assert d.kind == "offer" and d.price > Decimal(750)


def test_every_style_concedes_instead_of_opening_at_the_limit():
    state = make_state()
    for style, params in STYLES.items():
        d = decide(state, params)
        assert d.kind == "offer"
        assert d.price <= price_limit(state, params) * params.opening_cap, style


@given(
    asking=st.integers(min_value=200, max_value=5000),
    budget_ratio=st.floats(min_value=0.3, max_value=1.2),
    style=st.sampled_from(sorted(STYLES)),
)
def test_first_offer_never_hints_at_the_budget(asking, budget_ratio, style):
    asking_d = Decimal(asking)
    budget = (asking_d * Decimal(repr(round(budget_ratio, 3)))).quantize(Decimal("0.01"))
    state = StrategyState(asking_price=asking_d, max_budget=budget, seller_prices=[asking_d])
    d = decide(state, STYLES[style])
    assert d.kind == "offer"
    assert d.price <= budget * Decimal("0.85")



@given(
    asking=st.integers(min_value=200, max_value=5000),
    budget_ratio=st.floats(min_value=0.3, max_value=1.2),
    style=st.sampled_from(sorted(STYLES)),
    drops=st.lists(st.floats(min_value=0.0, max_value=0.12), min_size=1, max_size=15),
)
def test_every_decision_passes_the_safety_core(asking, budget_ratio, style, drops):
    """Strategy + validators agree: whatever the seller does, we never break a rule."""
    params = STYLES[style]
    asking_d = Decimal(asking)
    budget = (asking_d * Decimal(repr(round(budget_ratio, 3)))).quantize(Decimal("0.01"))
    state = StrategyState(asking_price=asking_d, max_budget=budget, seller_prices=[asking_d])
    seller = asking_d

    for drop in drops:
        d = decide(state, params)
        ctx = NegotiationContext(
            max_budget=budget,
            asking_price=asking_d,
            current_offer=state.our_offers[-1] if state.our_offers else None,
            seller_last_price=state.seller_last,
            phase=Phase.NEGOTIATING,
        )
        if d.kind == "walk_away":
            return
        if d.kind == "accept":
            action = Accept(price=d.price, message=f"Deal at RM {d.price:.2f}")
            result = validate_action(action, ctx)
            assert result.ok, result.violations
            return
        action = MakeOffer(price=d.price, message=f"How about RM {d.price:.2f}?")
        result = validate_action(action, ctx)
        assert result.ok, result.violations

        seller = (seller * Decimal(repr(round(1 - drop, 4)))).quantize(Decimal("0.01"))
        state = state.model_copy(
            update={
                "our_offers": [*state.our_offers, d.price],
                "seller_prices": [*state.seller_prices, seller],
            }
        )