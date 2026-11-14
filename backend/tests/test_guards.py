from decimal import Decimal

from backend.app.llm.guards import reconcile_intent
from backend.app.llm.tasks import SellerIntent

OFFER = Decimal(835)


def test_genuine_acceptance_is_kept():
    intent = SellerIntent(price=Decimal(835), accepted=True)
    fixed, notes = reconcile_intent(intent, OFFER)
    assert fixed.accepted and notes == []


def test_acceptance_with_a_different_price_is_a_counter_offer():
    intent = SellerIntent(price=Decimal(963), accepted=True)  # the real bug we saw
    fixed, notes = reconcile_intent(intent, OFFER)
    assert not fixed.accepted and "accept_price_unconfirmed" in notes


def test_acceptance_without_a_stated_price_is_not_trusted():
    fixed, notes = reconcile_intent(SellerIntent(accepted=True), OFFER)
    assert not fixed.accepted and notes


def test_acceptance_before_any_offer_is_impossible():
    fixed, notes = reconcile_intent(SellerIntent(price=Decimal(835), accepted=True), None)
    assert not fixed.accepted and "accept_without_offer" in notes


def test_accept_and_walk_together_is_contradictory():
    intent = SellerIntent(accepted=True, walked_away=True, price=Decimal(835))
    fixed, notes = reconcile_intent(intent, OFFER)
    assert not fixed.accepted and not fixed.walked_away and notes


def test_walking_away_while_quoting_a_price_is_not_trusted():
    fixed, notes = reconcile_intent(SellerIntent(walked_away=True, price=Decimal(900)), OFFER)
    assert not fixed.walked_away and "walk_with_price" in notes


def test_a_plain_walk_away_is_kept():
    fixed, notes = reconcile_intent(SellerIntent(walked_away=True), OFFER)
    assert fixed.walked_away and notes == []