from decimal import Decimal

import pytest
from hypothesis import assume, given
from hypothesis import strategies as st

from backend.app.core.models import (
    Accept,
    AskQuestion,
    MakeOffer,
    NegotiationContext,
    Phase,
    WalkAway,
)
from backend.app.core.outbound import check_outbound
from backend.app.core.validate import validate_action

CTX = NegotiationContext(
    max_budget=Decimal(900),
    asking_price=Decimal(1200),
    current_offer=Decimal(700),
    seller_last_price=Decimal(1100),
    phase=Phase.NEGOTIATING,
)
PUBLIC = {1200, 1100}


def codes(result) -> set[str]:
    return {v.code for v in result.violations}


# ---------- check_outbound: examples ----------
def test_outbound_allows_specs_years_and_units():
    text = "Is it the 2021 model with 256GB and 27 inch screen? I can pick up in 3 days, RM 800."
    assert check_outbound(text, CTX, Decimal(800)) == []


def test_outbound_allows_quoting_seller_price():
    text = "Your RM 1,200 is too high, how about 750?"
    assert check_outbound(text, CTX, Decimal(750)) == []


def test_outbound_blocks_budget_phrase_and_number():
    found = {v.code for v in check_outbound("My max budget is RM 900", CTX, Decimal(800))}
    assert found == {"private_phrase", "number_above_ceiling"}


def test_outbound_blocks_k_notation_and_no_space_currency():
    assert check_outbound("I could stretch to 1.5k", CTX, Decimal(800))
    assert check_outbound("Maybe RM850", CTX, Decimal(800))


# ---------- validate_action: examples ----------
def test_valid_offer_passes():
    assert validate_action(MakeOffer(price=Decimal(750), message="How about RM 750?"), CTX).ok


def test_accept_must_match_seller_standing_price():
    ctx = CTX.model_copy(update={"seller_last_price": Decimal(880)})
    assert validate_action(Accept(price=Decimal(880), message="Deal at RM 880."), ctx).ok
    res = validate_action(Accept(price=Decimal(870), message="Deal at RM 870."), ctx)
    assert "accept_mismatch" in codes(res)


def test_cannot_accept_above_budget():
    res = validate_action(Accept(price=Decimal(1100), message="Deal at RM 1100."), CTX)
    assert "over_budget" in codes(res)


def test_offer_cannot_go_down():
    res = validate_action(MakeOffer(price=Decimal(650), message="RM 650 then."), CTX)
    assert "offer_decreases" in codes(res)


def test_phase_blocks_actions():
    done = CTX.model_copy(update={"phase": Phase.DONE})
    assert "phase_not_allowed" in codes(validate_action(WalkAway(message="Bye."), done))


def test_question_cannot_mention_higher_price():
    res = validate_action(AskQuestion(message="Would RM 950 work for you?"), CTX)
    assert "number_above_ceiling" in codes(res)


def test_context_repr_hides_budget():
    assert "900" not in repr(CTX)
    assert "max_budget" not in CTX.public_view()


# ---------- validate_action: property tests ----------
@given(price=st.decimals(min_value=Decimal("900.01"), max_value=Decimal(100000), places=2))
def test_offer_above_budget_is_always_rejected(price):
    res = validate_action(MakeOffer(price=price, message=f"I offer RM {price:.2f}"), CTX)
    assert "over_budget" in codes(res)
    # feedback sent back to the LLM must never contain digits (no budget leak)
    assert not any(ch.isdigit() for ch in res.feedback_for_llm())


@given(n=st.integers(min_value=801, max_value=100000))
def test_mentioning_price_above_offer_is_always_rejected(n):
    assume(n not in PUBLIC)
    msg = f"Deal at RM 800, but I could stretch to RM {n}"
    res = validate_action(MakeOffer(price=Decimal(800), message=msg), CTX)
    assert "number_above_ceiling" in codes(res)


@given(price=st.decimals(min_value=Decimal(700), max_value=Decimal(900), places=2))
def test_clean_offers_within_budget_always_pass(price):
    res = validate_action(MakeOffer(price=price, message=f"I can do RM {price:.2f}"), CTX)
    assert res.ok, res.violations

@pytest.mark.parametrize(
    "text",
    [
        "RM 835 is the most I can offer right now.",
        "I can only do RM 925 for this.",
        "That is my final offer, RM 800.",
        "Saya cuma boleh tawarkan RM 835 sahaja.",
        "Best I can do is RM 800.",
    ],
)
def test_outbound_blocks_false_ceiling_claims(text):
    found = {v.code for v in check_outbound(text, CTX, Decimal(925))}
    assert "ceiling_claim" in found


def test_outbound_allows_normal_negotiation_language():
    text = "Hi bro, can we do RM 800? I can only come after 6pm on Saturday."
    assert check_outbound(text, CTX, Decimal(800)) == []