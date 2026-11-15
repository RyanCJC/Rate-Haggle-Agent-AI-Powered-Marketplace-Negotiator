"""Worker for the kill-and-resume test. Driven by backend/tests/test_kill_resume.py.

start   run until the first approval gate, print PAUSED, then wait to be killed.
resume  load the run from the database, answer whatever is pending, print RESULT.
"""

import argparse
import json
import os
import time
from decimal import Decimal

from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver

from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.boundaries.session import McpSession
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.control import approve, current_state, decide, pending, waiting_for
from backend.app.graph.ports import SimSellerPort
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

ASKING, BUDGET, SEED, PERSONA = Decimal(1200), Decimal(1000), 0, "flexible"
CALENDAR = "backend.app.boundaries.calendar_server"


class DiesAfterBooking:
    """Wraps a calendar and kills the process the instant a booking has committed."""

    def __init__(self, inner):
        self.inner = inner

    def propose_slots(self, *args, **kwargs):
        return self.inner.propose_slots(*args, **kwargs)

    def cancel_booking(self, *args, **kwargs):
        return self.inner.cancel_booking(*args, **kwargs)

    def book_slot(self, *args, **kwargs):
        result = self.inner.book_slot(*args, **kwargs)
        if result["status"] == "booked":
            os._exit(137)  # no cleanup, no flush: like a power cut
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["start", "resume"])
    parser.add_argument("--thread", required=True)
    parser.add_argument("--verdict", default="approve")
    parser.add_argument("--die-after-booking", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    url = os.environ["DATABASE_URL"]
    persona = get_persona(PERSONA)

    with PostgresSaver.from_conn_string(url) as saver, McpSession(
        CALENDAR, env={"DATABASE_URL": url}
    ) as session:
        saver.setup()
        calendar = McpCalendarPort(session)
        if args.die_after_booking:
            calendar = DiesAfterBooking(calendar)

        if args.phase == "start":
            port = SimSellerPort(SimSeller(ASKING, persona, seed=SEED))
            graph = build_graph(
                RuleBasedLLM(), port, checkpointer=saver, approve_close=True, calendar=calendar
            )
            run_graph(
                graph, ASKING, BUDGET, opening_text=port.opening_text(), thread_id=args.thread
            )
            print("PAUSED", json.dumps(waiting_for(graph, args.thread)), flush=True)
            time.sleep(3600)  # wait here until the test kills this process
            return

        reader = build_graph(RuleBasedLLM(), None, checkpointer=saver, approve_close=True)
        offers = current_state(reader, args.thread)["our_offers"]
        port = SimSellerPort.restore(ASKING, persona, SEED, offers, with_opening=True)
        graph = build_graph(
            RuleBasedLLM(), port, checkpointer=saver, approve_close=True, calendar=calendar
        )
        for _ in range(5):  # at most two gates plus the booking step
            if not pending(graph, args.thread):
                break
            if waiting_for(graph, args.thread):
                decide(graph, args.thread, args.verdict)
            else:
                approve(graph, args.thread)  # a step that was interrupted by the crash
        final = current_state(graph, args.thread)
        result = {
            "outcome": final["outcome"],
            "final_price": str(final["final_price"]),
            "pickup": final["pickup"],
            "approvals": final["approvals"],
        }
        print("RESULT", json.dumps(result), flush=True)


if __name__ == "__main__":
    main()