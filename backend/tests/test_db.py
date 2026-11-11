import os

import psycopg
import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL is not set",
)


def _conn():
    return psycopg.connect(os.environ["DATABASE_URL"])


def test_listings_seeded():
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("select count(*) from listings")
            assert cur.fetchone()[0] == 40
    finally:
        conn.close()


def test_calendar_unique():
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "insert into negotiations (user_id, listing_id, max_budget) values (%s, %s, %s) returning id",
                (1, 1, 500),
            )
            negotiation_id = cur.fetchone()[0]
            cur.execute(
                "insert into calendar_slots (negotiation_id, start_at) values (%s, %s)",
                (negotiation_id, "2026-01-01T10:00:00+08:00"),
            )
            try:
                cur.execute(
                    "insert into calendar_slots (negotiation_id, start_at) values (%s, %s)",
                    (negotiation_id, "2026-01-01T10:00:00+08:00"),
                )
                raise AssertionError("expected UniqueViolation on duplicate start_at")
            except psycopg.errors.UniqueViolation:
                conn.rollback()
    finally:
        conn.close()
