import os
import random
from collections import Counter, defaultdict
from decimal import Decimal

import psycopg
from dotenv import load_dotenv

from backend.app.knowledge.facts import extract_claims, reconcile, required_keys
from backend.app.knowledge.market import market_stats
from backend.app.knowledge.repo import (
    add_comparables,
    all_listings,
    comparable_count,
    get_comparables,
    save_facts,
)

MIN_COMPARABLES = 30


def synthetic_prices(category: str, base: Decimal) -> list[tuple[str, Decimal]]:
    """Deterministic fake market data around the category's typical asking price."""
    rng = random.Random(category)  # same category, same prices, every run
    rows = []
    for i in range(MIN_COMPARABLES):
        factor = min(max(rng.gauss(0.95, 0.12), 0.6), 1.3)
        price = (base * Decimal(str(round(factor, 3))) / 5).to_integral_value() * 5
        rows.append((f"{category} comparable {i + 1}", price))
    return rows


def main():
    load_dotenv()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        listings = all_listings(conn)
        status_count: Counter = Counter()
        asking_by_category: dict[str, list[Decimal]] = defaultdict(list)

        for item in listings:
            claims = extract_claims(f"{item['title']}. {item['description']}", "listing")
            facts = reconcile(claims, required_keys(item["category"]))
            save_facts(conn, item["id"], facts)
            status_count.update(f.status for f in facts)
            asking_by_category[item["category"]].append(item["asking_price"])

        for category, prices in asking_by_category.items():
            if comparable_count(conn, category) < MIN_COMPARABLES:
                base = sorted(prices)[len(prices) // 2]
                add_comparables(conn, category, synthetic_prices(category, base))
        conn.commit()

        print(f"{len(listings)} listings, facts by status: {dict(status_count)}")
        print("\ncategories (edit EXTRA_KEYS in facts.py if these differ from your plan):")
        for category in asking_by_category:
            stats = market_stats(get_comparables(conn, category))
            print(f"  {category}: {stats.describe() if stats else 'no comparables'}")


if __name__ == "__main__":
    main()