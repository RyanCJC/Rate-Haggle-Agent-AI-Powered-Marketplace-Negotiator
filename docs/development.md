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