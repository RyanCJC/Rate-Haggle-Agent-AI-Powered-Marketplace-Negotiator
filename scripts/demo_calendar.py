import argparse
import os
import uuid
from decimal import Decimal

from dotenv import load_dotenv

from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.boundaries.ports import McpSellerPort
from backend.app.boundaries.session import McpSession
from backend.app.graph.builder import build_graph, run_graph
from backend.app.llm.fake import RuleBasedLLM

MARKETPLACE = "backend.app.boundaries.marketplace_server"
CALENDAR = "backend.app.boundaries.calendar_server"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--persona", default="flexible")
    parser.add_argument("--asking", type=int, default=1200)
    parser.add_argument("--budget", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    load_dotenv()

    asking, budget = Decimal(args.asking), Decimal(args.budget)
    run_id = f"demo-{uuid.uuid4().hex[:8]}"
    env = {"DATABASE_URL": os.environ["DATABASE_URL"]}  # the calendar needs this, nothing else
    with McpSession(MARKETPLACE) as market, McpSession(CALENDAR, env=env) as cal_session:
        calendar = McpCalendarPort(cal_session)
        for attempt in (1, 2):  # the second run stands for "the process died and ran again"
            port = McpSellerPort(market, uuid.uuid4().hex, asking, args.persona, args.seed)
            graph = build_graph(RuleBasedLLM(), port, calendar=calendar)
            final = run_graph(
                graph, asking, budget, opening_text=port.opening_text(), thread_id=run_id
            )
            print(f"run {attempt}: outcome={final['outcome']} price={final['final_price']}")
            print(f"         pickup={final['pickup']}")
        print("cleanup:", calendar.cancel_booking(f"{run_id}:pickup"))


if __name__ == "__main__":
    main()