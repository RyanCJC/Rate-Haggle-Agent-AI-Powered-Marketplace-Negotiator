import argparse
import os
from decimal import Decimal

import psycopg
from dotenv import load_dotenv

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import ScriptedSellerPort
from backend.app.knowledge.embed import FastEmbedder
from backend.app.knowledge.retrieval import knowledge_lookup
from backend.app.llm.fake import RuleBasedLLM

LISTING = {
    "id": "demo",
    "title": "27 inch gaming monitor",
    "category": "monitors",
    "asking_price": "1200",
    "description": "27 inch 144Hz, 6 months warranty left, no scratches, with box.",
}
REPLIES = [
    "It has 144Hz and only 3 months warranty left.",
    "Come and see it first, then we talk.",
    "RM 1,150, no scratches at all.",
    "RM 1,100.",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--search", action="store_true", help="use the real knowledge base")
    args = parser.parse_args()
    load_dotenv()

    conn = psycopg.connect(os.environ["DATABASE_URL"]) if args.search else None
    knowledge = knowledge_lookup(conn, FastEmbedder()) if conn else None

    port = ScriptedSellerPort(REPLIES)
    graph = build_graph(RuleBasedLLM(), port, clarify=True, knowledge=knowledge, ground=True)
    final = run_graph(graph, Decimal(1200), Decimal(1000), listing=LISTING)
    if conn:
        conn.close()

    print("listing says:", LISTING["description"])
    print("\nwhat the seller said, and what was kept or dropped:")
    for entry, text in zip(
        [t for t in final["trace"] if t["node"] == "ingest"], REPLIES, strict=False
    ):
        print(f"  seller: {text}")
        print(f"     kept: {entry.get('claims_kept')}  dropped: {entry.get('claims_dropped')}")

    print("\nfacts at the end:")
    for f in final["facts"]:
        print(f"  {f['key']:<15}{f['status']:<13}{f['value'] or '-'}")

    print("\nclarify notes:")
    for note in final["notes"]:
        print(f"  {note[:150]}")
    print(f"\noutcome={final['outcome']} price={final['final_price']}")


if __name__ == "__main__":
    main()