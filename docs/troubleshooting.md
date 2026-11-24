# Troubleshooting

This page contains detailed troubleshooting entries that are too long for the README. The five most
common problems are in [the README](../README.md#troubleshooting).

## Backend

**`DATABASE_URL` not set:** the server fails to start. Set it in `.env` (loaded automatically when
you run uvicorn) or export it before starting the server.

**Frontend can't reach the API:** confirm the backend is on `http://127.0.0.1:8000`; the Vite dev
server proxies `/api` to `http://127.0.0.1:8000` (`frontend/vite.config.ts`), so the frontend and
backend must run together.

**Profile memory 503:** `DELETE /profile` is a safe no-op for an unknown id; a 503 means the memory
dependency isn't reachable — retry or check the database.

**Run stuck at a gate:** Copilot runs pause at `close_deal` (and `seller_reply` for each draft)
until you answer via `POST /negotiations/{run_id}/decision` or `/reply`. The SSE stream
(`/negotiations/{run_id}/events`) shows the current gate.

**No similar deals shown:** similarity is wording-based (not semantic), and only finished Copilot
deals with a final price qualify; Practice runs are never remembered.

**The agent never gives buying guidance:** run `python scripts/index_knowledge.py` once, and check
the server log for `knowledge search failed` or `embedder could not be created` warnings.

**Unsure which model the server uses:** read the `starting: llm_mode=...` line the server logs at
startup. Only the exact value `HAGGLE_LLM=offline` selects the offline stand-in.

**Evaluation `test` / `test2` split refuses to run:** the script requires `--final`, a clean git
tree, and is scored once per code version. See `docs/eval_round2_plan.md` for the protocol.

## Frontend

**Frontend can't reach the API:** confirm the backend is on `http://127.0.0.1:8000`; the Vite dev
server proxy target is hardcoded there in `frontend/vite.config.ts`.

**E2E tests are slow:** the full suite takes about 25 minutes against a hosted Postgres because every
graph step writes a checkpoint. Run one file at a time:
`npx playwright test e2e/category.spec.ts`.

**E2E cleanup:** created negotiation runs and profile rows are deleted by
`frontend/e2e/global-teardown.ts` -> `scripts/delete_run.py` / `scripts/delete_profiles.py`.