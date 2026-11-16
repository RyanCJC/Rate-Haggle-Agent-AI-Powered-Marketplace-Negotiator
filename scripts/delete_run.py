import os
import sys

import psycopg
from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver

load_dotenv()


def main() -> None:
    url = os.environ["DATABASE_URL"]
    ids = sys.argv[1:]
    cleaned = 0

    with psycopg.connect(url) as conn:
        for run_id in ids:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM calendar_slots WHERE booking_key = %s",
                (f"{run_id}:pickup",),
            )
            cur.execute("DELETE FROM runs WHERE id = %s", (run_id,))
            cleaned += 1
        conn.commit()

    with PostgresSaver.from_conn_string(url) as saver:
        for run_id in ids:
            cleanup = getattr(saver, "delete_thread", None)
            if cleanup:
                cleanup(run_id)

    print(f"cleaned up {cleaned} run(s)")


if __name__ == "__main__":
    main()
