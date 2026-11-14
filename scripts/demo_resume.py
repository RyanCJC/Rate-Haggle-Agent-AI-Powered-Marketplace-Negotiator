import argparse
import os
from decimal import Decimal

from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.control import approve, current_state, pending
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.client import LLMClient
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

ASKING, BUDGET, SEED, PERSONA = 1200, 1000, 0, "budget_prober"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["start", "resume"])
    parser.add_argument("--thread", required=True, help="use a fresh name for each new run")
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    llm = LLMClient() if args.live else RuleBasedLLM()
    persona = get_persona(PERSONA)

    with PostgresSaver.from_conn_string(os.environ["DATABASE_URL"]) as saver:
        if args.command == "start":
            port = SimSellerPort(SimSeller(Decimal(ASKING), persona, seed=SEED))
            graph = build_graph(llm, port, checkpointer=saver, approve_each_message=True)
            run_graph(
                graph, ASKING, BUDGET, opening_text=port.opening_text(), thread_id=args.thread
            )
            for _ in range(2):
                print("approving:", current_state(graph, args.thread)["draft"])
                approve(graph, args.thread)
            print("waiting for approval:", current_state(graph, args.thread)["draft"])
            print(f"\nThis process now exits, like a crash. Next: "
                  f"python scripts/demo_resume.py resume --thread {args.thread}")
            return

        reader = build_graph(llm, None, checkpointer=saver, approve_each_message=True)
        offers = current_state(reader, args.thread)["our_offers"]
        print(f"loaded from the database: {len(offers)} offers already sent")
        port = SimSellerPort.restore(
            Decimal(ASKING), persona, SEED, offers, with_opening=True
        )
        graph = build_graph(llm, port, checkpointer=saver, approve_each_message=True)
        while pending(graph, args.thread):
            print("approving:", current_state(graph, args.thread)["draft"])
            approve(graph, args.thread)
        final = current_state(graph, args.thread)
        print()
        for role, text in final["history"]:
            print(f"{role:>6}: {text}")
        print(f"\noutcome={final['outcome']} price={final['final_price']}")


if __name__ == "__main__":
    main()