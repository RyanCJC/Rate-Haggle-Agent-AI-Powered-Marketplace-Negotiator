import argparse
import os
from decimal import Decimal

import psycopg
from dotenv import load_dotenv

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.knowledge.market import market_stats
from backend.app.knowledge.repo import all_listings, listing_context
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="", help="pick the first listing whose title contains this")
    parser.add_argument("--persona", default="evasive")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--budget", type=int, default=None)
    args = parser.parse_args()

    load_dotenv()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        matches = [x for x in all_listings(conn) if args.title.lower() in x["title"].lower()]
        if not matches:
            raise SystemExit("no listing matches")
        listing, comparables = listing_context(conn, matches[0]["id"])

    asking = Decimal(listing["asking_price"])
    budget = Decimal(args.budget) if args.budget else (asking * Decimal("0.85")).to_integral_value()
    print(f"{listing['title']} ({listing['category']}), asking RM {asking:,.0f}, budget RM {budget}")
    print("\nfacts:")
    for f in listing["facts"]:
        print(f"  {f['key']:<15}{f['status']:<13}{f['value'] or '-'}")
    stats = market_stats(comparables)
    print(f"\nmarket: {stats.describe() if stats else 'none'}\n")

    seller = SimSeller(asking, get_persona(args.persona), seed=args.seed)
    port = SimSellerPort(seller)
    graph = build_graph(RuleBasedLLM(), port, clarify=True)
    final = run_graph(
        graph, asking, budget, "balanced", port.opening_text(),
        listing=listing, comparables=comparables,
    )
    print("clarify notes (what the tools returned):")
    for note in final["notes"]:
        print(f"  {note[:160]}")
    print(f"\noutcome={final['outcome']} price={final['final_price']}")


if __name__ == "__main__":
    main()