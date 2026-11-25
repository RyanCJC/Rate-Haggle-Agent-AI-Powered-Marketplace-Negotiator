# Development

This page contains detailed development instructions that are too long for the README. The
condensed command table is in [the README](../README.md#development).

## Backend tests

The backend suite runs entirely offline (`backend/tests/conftest.py` sets `HAGGLE_LLM=offline`).

Run the full suite (excluding the database test, which needs a live Postgres):

```
python -m pytest backend/tests -q --ignore=backend/tests/test_db.py
```

Run a single file:

```
python -m pytest backend/tests/category.spec.ts -q
```

Or a single test:

```
python -m pytest backend/tests/test_mcp_visibility.py::test_name -q
```

## Frontend tests

Frontend unit tests use vitest:

```
cd frontend
npm test
```

Run a specific test file:

```
cd frontend
npx vitest run src/features/home/Home.test.tsx
```

Frontend e2e tests use Playwright + axe-core for accessibility:

```
cd frontend
npm run e2e
```

Run a single spec:

```
cd frontend
npx playwright test e2e/category.spec.ts
```

Playwright runs at 1440x900 in light theme only. The e2e suite starts the FastAPI backend (with the
offline model) and the Vite dev server itself (`frontend/e2e/global-setup.ts`) and cleans negotiation
runs and profile rows afterwards (`frontend/e2e/global-teardown.ts` ->
`scripts/delete_run.py` / `scripts/delete_profiles.py`). The full suite takes about 25 minutes
against a hosted Postgres, because every graph step writes a checkpoint.

## Live LLM smoke test

By default the e2e backend starts with `HAGGLE_LLM=offline`, so no real model is ever called. To
exercise the real LLM path, set `HAGGLE_LIVE=1` before running Playwright:

```
$env:HAGGLE_LIVE = "1"; Remove-Item Env:HAGGLE_LLM -ErrorAction SilentlyContinue; npx playwright test e2e/live-llm.spec.ts
```

`HAGGLE_LIVE=1` tells `playwright.config.ts` to stop passing `HAGGLE_LLM=offline` to the backend
process, so `Settings.load()` reads `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` from `.env` or the shell
and starts a live model. The live spec (`frontend/e2e/live-llm.spec.ts`) is skipped unless
`HAGGLE_LIVE=1` is set. It makes a small number of real LLM calls (one per test, plus any internal
retries). Reset the variable afterwards:

```
Remove-Item Env:HAGGLE_LIVE

## Live LLM persona sweep

By default the e2e backend starts with `HAGGLE_LLM=offline`. To exercise the real LLM path against
every simulated seller persona, set both `HAGGLE_LIVE=1` and `HAGGLE_LIVE_PERSONAS=1` before running
Playwright:

```
$env:HAGGLE_LIVE = "1"; $env:HAGGLE_LIVE_PERSONAS = "1"; Remove-Item Env:HAGGLE_LLM -ErrorAction SilentlyContinue; npx playwright test e2e/live-llm.spec.ts -g "@live-personas"
```

`HAGGLE_LIVE=1` tells `playwright.config.ts` to stop passing `HAGGLE_LLM=offline` to the backend
process, so `Settings.load()` reads `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` from `.env` or the shell
and starts a live model. `HAGGLE_LIVE_PERSONAS=1` enables the persona sweep tests (`@live-personas`);
without it those tests are skipped.

The sweep runs 8 simulated seller personas (flexible, firm, evasive, pressure, budget_prober,
term_changer, mixed_my_en, dishonest) against the marketplace Copilot flow. Each persona test runs up
to 3 approved offers and asserts that draft prices are non-decreasing, never exceed budget, contain
no budget leaks, and match the planned price from the trace. Expect about 5-7 minutes total and
roughly 8 personas x up to 3 sends = up to 24 LLM calls. Reset the variables afterwards:

```
Remove-Item Env:HAGGLE_LIVE
Remove-Item Env:HAGGLE_LIVE_PERSONAS
```

## LLM retries and timeouts

The LLM client wrapper (`backend/app/llm/client.py`) guards every model call:

- `LLM_TIMEOUT_S` (default `45`): per-call timeout, applied to each request.
- `LLM_MAX_RETRIES` (default `3`): retries only transient failures — HTTP 429, 500, 502, 503, 504, timeouts and connection errors. A `Retry-After` header is honoured when present; otherwise the client waits with exponential backoff plus jitter: about 2s, 6s, 15s, capped. The SDK's own `max_retries` is set to `0` so retries are not multiplied.
- Worst case per call: `(LLM_MAX_RETRIES + 1) × LLM_TIMEOUT_S` plus the backoff sleeps — about `4 × 45 + 23 ≈ 203s` at the defaults, so a single LLM call is always bounded.
- Every attempt, retries included, counts against the existing 13-calls-per-minute client limit.
- Logs record the attempt number and error class only — never keys, URLs with keys, prompts, or the budget.

When all retries are exhausted the run ends as `status: "failed"` with `error_kind: "llm_unavailable"` and the message
"The AI model was unavailable. Nothing was sent to the seller. Your progress is saved."
The raw exception text stays in the logs; the API response never contains it. 400/401/403/404 rejections are never retried and fail immediately with `error_kind: "llm_rejected"`.

## Retrying a failed run: POST /negotiations/{id}/retry

`POST /negotiations/{run_id}/retry` resumes a failed run from its LangGraph Postgres checkpoint:

- `202` — the run was `failed` with `error_kind: "llm_unavailable"`; the graph continues from the failed node (nodes that already completed are not re-run) and the status returns to `running`.
- `404` — unknown run id.
- `409` — the run is not retryable (not failed, or a failure kind other than `llm_unavailable`) or already running; the latter also guards double-clicks so two concurrent retries run the graph at most once.

A replay never repeats a send: the checkpoint shows whether `send_offer`/`send_message` already executed for a turn, and the marketplace turn rules answer again without sending, so an approved draft is sent exactly once.

## Lint


Backend:

```
ruff check .
```

Frontend:

```
cd frontend
npm run lint
```

## Build

Frontend production build:

```
cd frontend
npm run build
```

Preview the built frontend:

```
cd frontend
npm run preview
```

## Evaluation scripts

From the repo root:

```
python scripts/run_scenarios.py
python scripts/run_eval.py --split dev            # development sellers: tuning allowed
python scripts/run_eval.py --split test --final   # round 1: scored once, clean git tree required
python scripts/run_eval.py --split test2 --final  # round 2: same rule
python scripts/compare_b1.py
python scripts/eval_grounding.py
```

`run_eval.py` runs offline (no model calls). The `test` and `test2` splits are scored once: the script
refuses to run them without `--final`, on a dirty git tree, or a second time for the same code
version. Development runs write `eval/reports/dev_*` (ignored by git); the two committed reports are
`final_test_report.md` and `round2_test_report.md`. run_scenarios.py, compare_b1.py and
eval_grounding.py each take `--live` to use a real model; without it they use RuleBasedLLM or
NaiveBuyerLLM test doubles and run offline.

## Strategy parameters

The price strategy lives in `backend/app/core/strategy.py` (`StrategyParams`). The round-1
defaults were opening ratio 0.70 and opening cap 0.85; these were softened for user experience
to opening ratio 0.80 and opening cap 0.90 (commit `3807010`, "adjust negotiation strategy
parameters"). The softer opening raises the deal rate at the cost of a lower share of surplus per
clean deal; a one-off DEV-split comparison is in `eval/reports/round3_opening_softening.md`
(67% -> 73% deal rate, 0 rule violations for both). The round-2 grid in
`backend/app/evaluation/round2.py` (`OPENINGS` / `BETAS`) is unchanged, and `V1_CANDIDATE` pins
the round-1 parameters explicitly so the round-1 style stays reproducible.

## Migrations

Apply database migrations:

```
python scripts/migrate.py
```

## Knowledge base

Seed and index the buying-guidance knowledge base (used by the market check and knowledge search):

```
python scripts/seed.py
python scripts/seed_knowledge.py
python scripts/index_knowledge.py
```

If you skip `index_knowledge.py` everything still works; the agent just finds no buying guidance.

## Optional flows

Scripts in `scripts/` include demos (`demo_mcp.py`, `demo_calendar.py`, `demo_strategy.py`,
`demo_sim.py`, `demo_resume.py`, `demo_graph.py`, `demo_approvals.py`, `demo_api.py`,
`demo_knowledge.py`, `demo_grounding.py`) and e2e cleanup helpers (`delete_run.py`,
`delete_profiles.py`).