import argparse
import uuid
from decimal import Decimal

from backend.app.boundaries.ports import McpSellerPort
from backend.app.boundaries.session import McpSession
from backend.app.graph.builder import build_graph, run_graph
from backend.app.llm.fake import RuleBasedLLM

MARKETPLACE = "backend.app.boundaries.marketplace_server"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--persona", default="flexible")
    parser.add_argument("--asking", type=int, default=1200)
    parser.add_argument("--budget", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--clarify", action="store_true")
    args = parser.parse_args()

    asking, budget = Decimal(args.asking), Decimal(args.budget)
    with McpSession(MARKETPLACE) as session:
        print("marketplace tools:", ", ".join(session.tools()), "\n")
        port = McpSellerPort(session, uuid.uuid4().hex, asking, args.persona, args.seed)
        graph = build_graph(RuleBasedLLM(), port, clarify=args.clarify)
        final = run_graph(graph, asking, budget, opening_text=port.opening_text())

    for role, text in final["history"]:
        print(f"{role:>7}: {text}")
    print(f"\noutcome={final['outcome']} price={final['final_price']}")


if __name__ == "__main__":
    main()