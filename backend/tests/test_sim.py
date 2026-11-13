from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from backend.app.sim.personas import DEV_PERSONAS, PERSONAS, TEST_PERSONAS, get_persona
from backend.app.sim.seller import SimSeller


def test_personas_are_well_formed():
    names = [p.name for p in PERSONAS]
    assert len(names) == len(set(names)) == 12
    assert len(DEV_PERSONAS) == 8 and len(TEST_PERSONAS) == 4
    assert all(0.5 < p.reservation_ratio < 1.0 for p in PERSONAS)


def test_same_seed_gives_same_conversation():
    persona = get_persona("budget_prober")
    a = SimSeller(Decimal(1200), persona, seed=7)
    b = SimSeller(Decimal(1200), persona, seed=7)
    for offer in (700, 760, 820, 880):
        assert a.respond(Decimal(offer)) == b.respond(Decimal(offer))


def test_firm_seller_ignores_lowball():
    seller = SimSeller(Decimal(1200), get_persona("firm"), seed=0)
    reply = seller.respond(Decimal(500))
    assert not reply.accepted
    assert reply.price == Decimal(1200)


def test_flexible_seller_closes_if_buyer_offers_the_reservation_each_round():
    persona = get_persona("flexible")
    seller = SimSeller(Decimal(1200), persona, seed=1)
    offer = seller.reservation
    for _ in range(persona.max_rounds):
        reply = seller.respond(offer)
        if reply.accepted:
            assert reply.price == offer
            return
    raise AssertionError("seller never accepted")


def test_term_changer_raises_the_ask_at_round_two():
    seller = SimSeller(Decimal(1200), get_persona("term_changer"), seed=0)
    first = seller.respond(Decimal(700))
    second = seller.respond(Decimal(720))
    assert second.price > first.price


def test_pressure_seller_pressures_from_round_two():
    seller = SimSeller(Decimal(1200), get_persona("pressure"), seed=0)
    assert not seller.respond(Decimal(700)).pressure
    assert seller.respond(Decimal(710)).pressure


def test_budget_prober_asks_for_the_budget_sometimes():
    persona = get_persona("budget_prober")
    probed = 0
    for seed in range(20):
        seller = SimSeller(Decimal(1200), persona, seed=seed)
        probed += seller.respond(Decimal(700)).probes_budget
    assert probed > 0


def test_evasive_seller_sometimes_states_no_price():
    persona = get_persona("evasive")
    missing = 0
    for seed in range(20):
        seller = SimSeller(Decimal(1200), persona, seed=seed)
        for _ in range(persona.max_rounds):
            if seller.done:
                break
            missing += seller.respond(Decimal(700)).price is None
    assert missing > 0


def test_seller_walks_after_running_out_of_patience():
    persona = get_persona("quick_walker")
    seller = SimSeller(Decimal(1200), persona, seed=0)
    replies = [seller.respond(Decimal(700)) for _ in range(persona.max_rounds + 1)]
    assert replies[-1].walked_away
    assert not any(r.walked_away for r in replies[:-1])


@given(
    persona=st.sampled_from(PERSONAS),
    seed=st.integers(min_value=0, max_value=10_000),
    offers=st.lists(st.integers(min_value=1, max_value=2000), min_size=1, max_size=12),
)
def test_seller_never_sells_or_quotes_below_its_reservation(persona, seed, offers):
    seller = SimSeller(Decimal(1200), persona, seed=seed)
    for offer in offers:
        if seller.done:
            break
        reply = seller.respond(Decimal(offer))
        if reply.price is not None:
            assert reply.price >= seller.reservation