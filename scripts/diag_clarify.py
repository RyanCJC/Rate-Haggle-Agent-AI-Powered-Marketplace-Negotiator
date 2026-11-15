import argparse
import json
from decimal import Decimal

from dotenv import load_dotenv

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.client import LLMClient
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

SHOW = {"plan", "clarify", "ingest", "validate", "execute"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=2)
    parser.add_argument("--asking", type=int, default=1200)
    parser.add_argument("--budget", type=int, default=1000)
    args = parser.parse_args()
    load_dotenv()
    llm = LLMClient()
    for seed in range(args.seeds):
        port = SimSellerPort(
            SimSeller(Decimal(args.asking), get_persona("evasive"), seed=seed)
        )
        graph = build_graph(llm, port, clarify=True)
        final = run_graph(
            graph, args.asking, args.budget, opening_text=port.opening_text()
        )
        print(f"\n=== seed {seed}: outcome={final['outcome']} asks={final['asks']} "
              f"messages sent={len(port.sent)}")
        for role, text in final["history"]:
            print(f"{role:>6}: {text}")
        print("--- trace")
        for entry in final["trace"]:
            if entry["node"] in SHOW:
                print(json.dumps(entry, default=str)[:260])


if __name__ == "__main__":
    main()