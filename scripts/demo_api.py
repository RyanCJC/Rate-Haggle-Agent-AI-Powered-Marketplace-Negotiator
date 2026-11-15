import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import psycopg
from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for(client, run_id, wanted, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snap = client.get(f"/negotiations/{run_id}").json()
        if snap["status"] in wanted:
            return snap
        time.sleep(0.3)
    raise SystemExit(f"timed out; last status {snap['status']}")


def main():
    load_dotenv()
    url = os.environ["DATABASE_URL"]
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.app.api.main:app", "--port", str(port)],
        cwd=ROOT, env={**os.environ, "PYTHONPATH": str(ROOT)},
    )
    run_id = None
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as client:
            for _ in range(60):  # wait for the server to come up
                try:
                    client.get("/health").raise_for_status()
                    break
                except httpx.HTTPError:
                    time.sleep(0.5)
            run_id = client.post("/negotiations", json={
                "asking": 1200, "budget": 1000, "persona": "flexible"}).json()["id"]
            print("started", run_id)
            snap = wait_for(client, run_id, {"waiting_for_approval", "finished", "failed"})
            if snap["status"] == "failed":
                raise SystemExit(f"run failed: {snap['error']}")
            print(f"status={snap['status']} after {len(snap['history'])} messages")
            if snap["status"] == "waiting_for_approval":
                print("the agent asks:", snap["question"])
                client.post(f"/negotiations/{run_id}/decision", json={"verdict": "approve"})
                snap = wait_for(client, run_id, {"finished", "failed"})
                if snap["status"] == "failed":
                    raise SystemExit(f"run failed: {snap['error']}")
            for role, text in snap["history"]:
                print(f"{role:>6}: {text}")
            print(f"\noutcome={snap['outcome']} price={snap['final_price']} "
                  f"pickup={snap['pickup']} approvals={snap['approvals']}")
            with client.stream("GET", f"/negotiations/{run_id}/events") as response:
                names = [x[7:] for x in response.iter_lines() if x.startswith("event: ")]
            print(f"event stream: {names.count('trace')} trace events, last event {names[-1]}")
    finally:
        server.terminate()
        server.wait(timeout=15)
        if run_id:
            with psycopg.connect(url) as conn:
                conn.execute("DELETE FROM calendar_slots WHERE booking_key = %s",
                             (f"{run_id}:pickup",))
                conn.execute("DELETE FROM runs WHERE id = %s", (run_id,))
            with PostgresSaver.from_conn_string(url) as saver:
                cleanup = getattr(saver, "delete_thread", None)
                if cleanup:
                    cleanup(run_id)
            print(f"\nstatus={snap['status']} outcome={snap['outcome']} "
                f"price={snap['final_price']} "
                f"pickup={snap['pickup']} approvals={snap['approvals']}")


if __name__ == "__main__":
    main()