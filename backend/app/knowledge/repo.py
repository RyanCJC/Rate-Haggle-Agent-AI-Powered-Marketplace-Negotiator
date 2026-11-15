from decimal import Decimal

from .facts import Fact

SYNTHETIC = "synthetic: "  # comparables has no source column, so the label lives in `model`


def all_listings(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT id, title, category, asking_price, COALESCE(seller_note, '') FROM listings "
        "ORDER BY title, id"
    ).fetchall()
    return [
        {"id": r[0], "title": r[1], "category": r[2], "asking_price": r[3], "description": r[4]}
        for r in rows
    ]


def get_facts(conn, listing_id) -> list[Fact]:
    rows = conn.execute(
        "SELECT key, value, source, status, evidence_ref FROM listing_facts "
        "WHERE listing_id = %s ORDER BY key",
        (listing_id,),
    ).fetchall()
    return [Fact(*r) for r in rows]


def save_facts(conn, listing_id, facts: list[Fact]) -> None:
    """Replace all facts of a listing. The caller commits."""
    conn.execute("DELETE FROM listing_facts WHERE listing_id = %s", (listing_id,))
    for f in facts:
        conn.execute(
            "INSERT INTO listing_facts (listing_id, key, value, source, status, evidence_ref) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (listing_id, f.key, f.value, f.source, f.status, f.evidence_ref),
        )


def get_comparables(conn, category: str, limit: int = 50) -> list[Decimal]:
    rows = conn.execute(
        "SELECT price FROM comparables WHERE category = %s "
        "ORDER BY observed_at DESC, price LIMIT %s",
        (category, limit),
    ).fetchall()
    return [r[0] for r in rows]


def comparable_count(conn, category: str) -> int:
    return conn.execute(
        "SELECT count(*) FROM comparables WHERE category = %s", (category,)
    ).fetchone()[0]


def add_comparables(
    conn,
    category: str,
    rows: list[tuple[str, Decimal]],
    label: str = SYNTHETIC,
    condition: str = "used",
) -> None:
    """Insert (name, price) rows. The caller commits."""
    for name, price in rows:
        conn.execute(
            "INSERT INTO comparables (category, model, condition, price, observed_at) "
            "VALUES (%s, %s, %s, %s, current_date)",
            (category, f"{label}{name}", condition, price),
        )


def listing_context(conn, listing_id) -> tuple[dict, list[Decimal]]:
    """Everything the graph needs: a plain-data listing (with facts) and comparable prices.

    Plain data only (strings and lists), so it is safe to store in a checkpoint.
    """
    row = conn.execute(
        "SELECT id, title, category, asking_price, COALESCE(seller_note, '') "
        "FROM listings WHERE id = %s",
        (listing_id,),
    ).fetchone()
    if row is None:
        raise KeyError(f"listing {listing_id} not found")
    listing = {
        "id": str(row[0]),
        "title": row[1],
        "category": row[2],
        "asking_price": str(row[3]),
        "description": row[4],
        "facts": [
            {"key": f.key, "value": f.value, "status": f.status, "evidence": f.evidence_ref}
            for f in get_facts(conn, listing_id)
        ],
    }
    return listing, get_comparables(conn, row[2])