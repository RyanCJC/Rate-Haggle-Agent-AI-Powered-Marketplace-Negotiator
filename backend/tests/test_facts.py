from decimal import Decimal

from backend.app.knowledge.facts import Claim, extract_claims, reconcile
from backend.app.knowledge.market import market_stats

TEXT = "Like new monitor, 27 inch 144Hz, 6 months warranty left, with box and charger, no scratches."


def by_key(facts):
    return {f.key: f for f in facts}


def test_every_extracted_claim_quotes_the_source_text():
    claims = extract_claims(TEXT, "listing")
    assert claims
    assert all(c.quote.lower() in TEXT.lower() for c in claims)


def test_extraction_finds_the_obvious_facts():
    values = {c.key: c.value.lower() for c in extract_claims(TEXT, "listing") if c.key != "accessories"}
    assert values["condition"] == "like new"
    assert values["refresh_rate"] == "144"
    assert values["size_inch"] == "27"
    assert "warranty" in values["warranty"]


def test_one_source_is_only_claimed():
    facts = by_key(reconcile(extract_claims(TEXT, "listing")))
    assert facts["warranty"].status == "claimed"


def test_two_agreeing_sources_confirm():
    claims = [
        Claim("warranty", "6 months warranty", "listing", "6 months warranty"),
        Claim("warranty", "6 Months  Warranty", "seller_chat", "6 Months  Warranty"),
    ]
    fact = by_key(reconcile(claims))["warranty"]
    assert fact.status == "confirmed"
    assert fact.source == "listing+seller_chat"


def test_disagreeing_sources_conflict_and_keep_both_values():
    claims = [
        Claim("refresh_rate", "144", "listing", "144hz"),
        Claim("refresh_rate", "60", "spec", "60 Hz"),
    ]
    fact = by_key(reconcile(claims))["refresh_rate"]
    assert fact.status == "conflicting"
    assert "144" in fact.value and "60" in fact.value
    assert "spec: 60 Hz" in fact.evidence_ref


def test_a_required_key_with_no_source_is_missing():
    fact = by_key(reconcile([], required=("warranty",)))["warranty"]
    assert fact.status == "missing"
    assert fact.value is None


def test_several_accessories_are_not_a_conflict():
    facts = by_key(reconcile(extract_claims("comes with box and charger", "listing")))
    assert facts["accessories"].status == "claimed"
    assert "box" in facts["accessories"].value and "charger" in facts["accessories"].value


def test_market_stats():
    stats = market_stats([Decimal(x) for x in (300, 100, 500, 200, 400)])
    assert (stats.n, stats.low, stats.q1, stats.median, stats.q3, stats.high) == (
        5, 100, 200, 300, 400, 500,
    )
    assert "5 similar items" in stats.describe()


def test_market_stats_of_nothing_is_none():
    assert market_stats([]) is None