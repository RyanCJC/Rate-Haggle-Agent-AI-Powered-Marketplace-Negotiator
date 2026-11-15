import os
from decimal import Decimal

import psycopg
import pytest
from dotenv import load_dotenv

from backend.app.knowledge.facts import extract_claims, reconcile
from backend.app.knowledge.repo import (
    add_comparables,
    listing_context,
    save_facts,
)

load_dotenv()
pytestmark = pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="DATABASE_URL not set")


@pytest.fixture
def conn():
    connection = psycopg.connect(os.environ["DATABASE_URL"])
    yield connection
    connection.rollback()  # tests never leave data behind
    connection.close()


def test_facts_and_comparables_round_trip(conn):
    listing_id = conn.execute(
        "INSERT INTO listings (title, category, asking_price, seller_note) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        ("Test monitor", "zz_test_category", 450, "Like new, 6 months warranty, no scratches"),
    ).fetchone()[0]
    facts = reconcile(extract_claims("Like new, 6 months warranty, no scratches", "listing"))
    save_facts(conn, listing_id, facts)
    save_facts(conn, listing_id, facts)  # saving twice must replace, not duplicate
    add_comparables(
        conn, "zz_test_category", [(f"c{i}", Decimal(100 * i)) for i in range(1, 6)]
    )

    listing, prices = listing_context(conn, listing_id)

    assert listing["asking_price"] == "450.00"
    assert len(listing["facts"]) == len(facts)
    assert {f["key"]: f["status"] for f in listing["facts"]}["warranty"] == "claimed"
    assert sorted(prices) == [100, 200, 300, 400, 500]