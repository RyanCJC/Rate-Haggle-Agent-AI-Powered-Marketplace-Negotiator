import argparse
from decimal import Decimal

from langgraph.checkpoint.memory import InMemorySaver

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.control import current_state, decide, pending, waiting_for
from backend.app.graph.ports import InMemoryCalendar, SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import DEV_PERSONAS
from backend.app.sim.seller import SimSeller

ASKING = Decimal(1200)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verdict", default="approve", help='"approve" or anything else to decline')
    parser.add_argument("--budget", type=int, default=1000)
    args = parser.parse_args()

    print(f"Level 2, verdict={args.verdict!r}, budget={args.budget}\n")
    for persona in DEV_PERSONAS:
        port = SimSellerPort(SimSeller(ASKING, persona, seed=0))
        calendar = InMemoryCalendar()
        graph = build_graph(
            RuleBasedLLM(), port, checkpointer=InMemorySaver(), approve_close=True,
            calendar=calendar,
        )
        run_graph(
            graph, ASKING, Decimal(args.budget), opening_text=port.opening_text(), thread_id="t"
        )
        gates = []
        while pending(graph, "t"):
            question = waiting_for(graph, "t")
            gates.append(question["gate"])
            print(f"  [{persona.name}] paused at {question['gate']} "
                  f"(price {question['price']}) after {len(port.sent)} messages sent alone")
            decide(graph, "t", args.verdict)
        final = current_state(graph, "t")
        print(f"{persona.name:>14}: gates={gates or 'none'} outcome={final['outcome']} "
              f"price={final['final_price']} pickup={final['pickup']} "
              f"approvals={final['approvals']}\n")


if __name__ == "__main__":
    main()