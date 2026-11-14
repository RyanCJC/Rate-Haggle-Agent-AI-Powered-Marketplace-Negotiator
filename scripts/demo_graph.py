import argparse
from decimal import Decimal

from dotenv import load_dotenv

from backend.app.evaluation.scenarios import extraction_accuracy
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.client import LLMClient
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="use the real LLM from .env")
    parser.add_argument("--persona", default="budget_prober")
    parser.add_argument("--asking", type=int, default=1200)
    parser.add_argument("--budget", type=int, default=1000)
    parser.add_argument("--style", default="balanced")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--clarify", action="store_true", help="enable the clarify loop")
    parser.add_argument("--mermaid", action="store_true", help="print the graph as Mermaid")
    args = parser.parse_args()

    load_dotenv()
    llm = LLMClient() if args.live else RuleBasedLLM()
    seller = SimSeller(Decimal(args.asking), get_persona(args.persona), seed=args.seed)
    port = SimSellerPort(seller)
    graph = build_graph(llm, port, clarify=args.clarify)

    if args.mermaid:
        print(graph.get_graph().draw_mermaid())
        return

    final = run_graph(graph, args.asking, args.budget, args.style, port.opening_text())
    for role, text in final["history"]:
        print(f"{role:>6}: {text}")

    print(f"\noutcome={final['outcome']} price={final['final_price']} "
          f"(seller floor {seller.reservation}, buyer budget {args.budget})")
    rejected = sum(t["node"] == "validate" and not t["ok"] for t in final["trace"])
    fallbacks = sum(t["node"] == "fallback" for t in final["trace"])
    print(f"validator rejections: {rejected}, template fallbacks: {fallbacks}")

    guard_hits = [
        n for t in final["trace"] if t["node"] == "ingest" for n in t.get("guard_notes", [])
    ]
    print(f"read-guard interventions: {guard_hits or 'none'}")
    executes = [t for t in final["trace"] if t["node"] == "execute"]
    phantom = (
        final["outcome"] == "deal"
        and executes[-1].get("action") != "accept"
        and not (port.log and port.log[-1].accepted)
    )
    print(f"phantom deal: {'YES (bug)' if phantom else 'no'}")

    correct, total = extraction_accuracy(final["trace"], port.log)
    print(f"seller messages read correctly: {correct}/{total}")
    calls = getattr(llm, "calls", [])
    if calls:
        avg = sum(c.latency_s for c in calls) / len(calls)
        tokens = sum((c.prompt_tokens or 0) + (c.completion_tokens or 0) for c in calls)
        print(f"{len(calls)} LLM calls, avg {avg:.1f}s, {tokens} tokens")


if __name__ == "__main__":
    main()