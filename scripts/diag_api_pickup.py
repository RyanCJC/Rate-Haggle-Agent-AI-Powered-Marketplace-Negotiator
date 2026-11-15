import os
import time

import psycopg
from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver

from backend.app.api.runs import PgRuns
from backend.app.api.service import Service
from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.boundaries.session import McpSession
from backend.app.graph.builder import make_config

CALENDAR = "backend.app.boundaries.calendar_server"
CONFIG = {"asking": "1200", "budget": "1000", "persona": "flexible", "style": "balanced",
          "autonomy": "auto", "seed": 0}


def main():
    load_dotenv()
    url = os.environ["DATABASE_URL"]
    run_id = None
    try:
        with PostgresSaver.from_conn_string(url) as saver, McpSession(
            CALENDAR, env={"DATABASE_URL": url}
        ) as session:
            saver.setup()
            service = Service(saver, McpCalendarPort(session), PgRuns(url))
            run_id = service.start(CONFIG)
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline and run_id in service._busy:
                time.sleep(0.1)
            for label, pause in (("right after the drive ended", 0), ("3 seconds later", 3)):
                time.sleep(pause)
                snap = service.snapshot(run_id)
                nodes = [e["node"] for e in snap["trace"]]
                print(f"[{label}] status={snap['status']} error={snap['error']} "
                      f"outcome={snap['outcome']} pickup={snap['pickup']}")
                print(f"    last trace nodes: {nodes[-4:]} (total {len(nodes)})")
            print("--- checkpoint history, newest first")
            graph = service._graph(CONFIG, None)
            for state in graph.get_state_history(make_config(run_id)):
                values = state.values
                print(f"step={state.metadata.get('step')} next={state.next} "
                      f"outcome={values.get('outcome')} pickup={values.get('pickup')} "
                      f"trace={len(values.get('trace', []))}")
            with psycopg.connect(url) as conn:
                rows = conn.execute(
                    "SELECT booking_key, start_at FROM calendar_slots WHERE booking_key = %s",
                    (f"{run_id}:pickup",),
                ).fetchall()
            print("calendar rows for this run:", rows)
    finally:
        if run_id:
            with psycopg.connect(url) as conn:
                conn.execute("DELETE FROM calendar_slots WHERE booking_key = %s",
                             (f"{run_id}:pickup",))
                conn.execute("DELETE FROM runs WHERE id = %s", (run_id,))
            with PostgresSaver.from_conn_string(url) as saver:
                cleanup = getattr(saver, "delete_thread", None)
                if cleanup:
                    cleanup(run_id)
            print("cleaned up")


if __name__ == "__main__":
    main()