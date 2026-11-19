import argparse
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

from backend.app.knowledge.embed import FastEmbedder, HashEmbedder
from backend.app.knowledge.retrieval import Doc, index_documents, search_knowledge

# (category, query, text that a correct passage must contain). Frozen: do not tune on results.
EVAL_QUERIES = [
    ("monitors", "how do I check for dead pixels", "white screen"),
    ("monitors", "is 144Hz worth it for gaming", "144Hz"),
    ("monitors", "difference between IPS and TN panels", "IPS panels"),
    ("phones", "how to check the phone battery health", "Battery Health"),
    ("phones", "phone is still tied to the seller's account", "Activation lock"),
    ("phones", "was the screen replaced with a cheap part", "non-original"),
    ("laptops", "how do I check laptop battery wear", "cycle count"),
    ("laptops", "laptop gets very hot and the fan is loud", "thermal paste"),
    ("laptops", "the hinge looks loose", "hinge"),
    ("cameras", "how many photos has the camera taken", "shutter count"),
    ("cameras", "there is fungus or haze inside the lens", "fungus"),
    ("consoles", "the controller stick moves by itself", "drift"),
    ("furniture", "how do I tell if a mattress has bed bugs", "bed bugs"),
    ("appliances", "the fridge does not cool properly", "door seals"),
    ("appliances", "how do I check an air conditioner", "compressor"),
    ("other", "why is the seller getting rid of it", "reason for selling"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hash", action="store_true", help="offline test embedder, not semantic")
    parser.add_argument("--query", default=None)
    parser.add_argument("--category", default=None)
    parser.add_argument("--eval", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    embedder = HashEmbedder() if args.hash else FastEmbedder()
    docs = [
        Doc(path.stem, path.name, path.read_text(encoding="utf-8"))
        for path in sorted(Path("knowledge").glob("*.md"))
    ]

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        written = index_documents(conn, docs, embedder)
        conn.commit()
        print(f"embedder: {embedder.name}; {len(docs)} documents, {written} chunks indexed")

        if args.query:
            for passage in search_knowledge(conn, embedder, args.query, args.category):
                print(f"\n[{passage.source}] score {passage.score:.3f}\n{passage.text}")

        if args.eval:
            hit1 = hit3 = 0
            for category, query, needle in EVAL_QUERIES:
                found = search_knowledge(conn, embedder, query, category, k=3)
                ranks = [i for i, p in enumerate(found) if needle.lower() in p.text.lower()]
                hit1 += bool(ranks) and ranks[0] == 0
                hit3 += bool(ranks)
                mark = "ok  " if ranks else "MISS"
                print(f"{mark} rank {ranks[0] + 1 if ranks else '-'}  {category}: {query}")
            print(f"\nhit@1 {hit1}/{len(EVAL_QUERIES)}, hit@3 {hit3}/{len(EVAL_QUERIES)}")


if __name__ == "__main__":
    main()