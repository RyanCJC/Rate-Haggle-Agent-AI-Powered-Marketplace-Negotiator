# Architecture (full annotated tree)

Complete repository layout, annotated:

```
.
├── README.md
├── pyproject.toml            # ruff (line-length=100) + pytest config
├── requirements.txt          # Python dependencies
├── .env.example              # env var names (placeholders only)
├── .gitignore
├── scripts/                  # one-off and eval scripts
│   ├── migrate.py            # apply database migrations (db/migrations/*.sql)
│   ├── seed.py               # seed listings / comparables tables
│   ├── seed_knowledge.py     # seed knowledge-base docs into listings
│   ├── index_knowledge.py    # embed knowledge chunks into pgvector (knowledge_chunks)
│   ├── run_eval.py           # policy suite on dev/test split → eval/reports/
│   ├── run_scenarios.py      # regression scenario runner (7 scenarios)
│   ├── compare_b1.py         # Haggle vs B1 prompt-only baseline
│   ├── eval_grounding.py     # grounded vs invented item claims
│   ├── delete_run.py         # e2e: delete negotiation runs from DB
│   ├── delete_profiles.py    # e2e: delete profile rows from DB
│   ├── setup_checkpointer.py # Postgres checkpointer setup
│   ├── try_llm.py            # live-model smoke test
│   ├── diag_api_pickup.py    # API + pickup diagnostics
│   ├── diag_clarify.py       # clarify-loop diagnostics
│   ├── crash_worker.py       # worker crash / resume demo
│   ├── keep_warm.py          # keep server warm demo
│   ├── demo_api.py           # demo: run API negotiation end-to-end
│   ├── demo_approvals.py     # demo: approve/decline gates
│   ├── demo_calendar.py      # demo: calendar booking + idempotency
│   ├── demo_graph.py         # demo: run graph directly
│   ├── demo_grounding.py     # demo: fact grounding
│   ├── demo_knowledge.py     # demo: market stats + knowledge lookup
│   ├── demo_mcp.py           # demo: marketplace MCP server
│   ├── demo_resume.py        # demo: resume run from Postgres checkpoint
│   ├── demo_sim.py           # demo: simulated negotiation grid
│   └── demo_strategy.py      # demo: strategy styles (aggressive/balanced/safe)
├── backend/
│   ├── app/
│   │   ├── main.py           # minimal /health FastAPI app (not the API)
│   │   ├── db.py             # psycopg connection helper (loads .env)
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── main.py       # FastAPI app + all HTTP endpoints + SSE stream
│   │   │   ├── service.py    # background negotiation service (runs in thread pool)
│   │   │   ├── runs.py       # run store: PgRuns (Postgres) / MemoryRuns (tests)
│   │   │   └── schemas.py    # pydantic models: StartRequest, Decision, Reply, Pickup
│   │   ├── graph/
│   │   │   ├── __init__.py
│   │   │   ├── builder.py    # build_graph / run_graph (StateGraph wiring + run_graph)
│   │   │   ├── state.py      # NegState + initial_state
│   │   │   ├── nodes.py      # plan / clarify / compose / validate / execute / ingest / finalize / schedule
│   │   │   ├── control.py    # pending / current_state / approve / decide / waiting_for
│   │   │   ├── ports.py      # SellerPort / calendar ports / in-memory calendar
│   │   │   └── manual.py     # ManualSellerPort (Copilot human relay via interrupt)
│   │   ├── core/
│   │   │   ├── models.py     # actions (MakeOffer/Accept/…), NegotiationContext, Violation
│   │   │   ├── strategy.py   # decide() + STYLES (aggressive/balanced/safe)
│   │   │   ├── outbound.py   # pre-send message validation (leaks, ceiling claims)
│   │   │   ├── validate.py   # deterministic action validator
│   │   │   ├── pickup.py     # pickup message helpers
│   │   │   ├── calendar_rules.py   # MYT slot generation / validation
│   │   │   └── utility.py    # deal scoring (not on the hot path)
│   │   ├── llm/
│   │   │   ├── __init__.py
│   │   │   ├── client.py     # OpenAI-compatible LLMClient
│   │   │   ├── fake.py       # RuleBasedLLM (offline test double)
│   │   │   ├── naive.py      # NaiveBuyerLLM (B1 baseline test double)
│   │   │   ├── tasks.py      # extract intent / compose draft prompts
│   │   │   ├── clarify.py    # clarify-loop tool choice
│   │   │   ├── facts.py      # fact claim proposal + verification
│   │   │   ├── guards.py     # intent reconciliation (phantom-deal guard)
│   │   │   └── untrusted.py  # <seller_message> tag wrapping
│   │   ├── knowledge/
│   │   │   ├── __init__.py
│   │   │   ├── facts.py      # claim extraction + reconciliation (Status enum)
│   │   │   ├── grounding.py  # check a draft's item claims against known facts
│   │   │   ├── retrieval.py  # pgvector semantic search (cosine distance)
│   │   │   ├── repo.py       # listings / comparables / listing_facts access
│   │   │   ├── market.py     # market statistics (median, quartiles)
│   │   │   └── embed.py      # HashEmbedder (384-d, deterministic) + FastEmbedder (ONNX)
│   │   ├── memory/
│   │   │   ├── __init__.py
│   │   │   ├── models.py     # Preferences, DealRecord, PastDeal
│   │   │   ├── store.py      # PgMemory (profile + past-deals persistence)
│   │   │   └── context.py    # memory_notes (private numbers-only context)
│   │   ├── sim/
│   │   │   ├── __init__.py
│   │   │   ├── personas.py   # DEV_PERSONAS / TEST_PERSONAS + get_persona()
│   │   │   └── seller.py     # SimSeller (rule-based seller with hidden reservation)
│   │   └── boundaries/
│   │       ├── __init__.py
│   │       ├── session.py        # McpSession (stdio MCP client)
│   │       ├── ports.py          # McpToolError
│   │       ├── calendar_db.py    # DbCalendar (Postgres-backed slots, idempotent)
│   │       ├── calendar_port.py  # McpCalendarPort
│   │       ├── calendar_server.py# MCP: haggle-calendar (propose/book/cancel)
│   │       └── marketplace_server.py # MCP: haggle-marketplace (open/send)
│   └── tests/                # pytest suite
│       ├── test_*.py         # unit tests (memory, api, graph, llm, knowledge, …)
│       └── test_db.py        # excluded from the standard pytest run
├── db/migrations/            # SQL migrations, applied by scripts/migrate.py
│   ├── 001_init.sql
│   ├── 002_vectors.sql       # create extension if not exists vector; knowledge_chunks
│   ├── 003_enable_rls.sql
│   ├── 004_knowledge_chunks.sql
│   ├── 005_calendar_idempotency.sql
│   ├── 006_runs.sql
│   └── 007_profile_memory.sql
├── knowledge/                # knowledge-base sources
│   ├── laptops.md
│   ├── monitors.md
│   └── phones.md
├── docs/
│   ├── copilot-mode.md       # Copilot mode, pickup coordination, limits
│   ├── profile-memory.md     # anonymous profile memory, preferences, clearing
│   └── architecture.md       # this file
├── eval/                     # eval run outputs (gitignored-ish; created by run_eval.py)
│   └── reports/              # eval_<split>_<unix_ts>.json
├── frontend/
│   ├── vite.config.ts        # Vite + vitest, /api proxy to http://127.0.0.1:8000
│   ├── playwright.config.ts  # e2e at 1440x900 light theme
│   ├── package.json          # lint / test / e2e / build / preview / dev scripts
│   ├── tsconfig.json
│   ├── eslint.config.js
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx           # hash routing: /, #/profile, #/run/:id
│   │   ├── api.ts            # fetch client (X-Profile-Id header)
│   │   ├── useNegotiation.ts # SSE-driven run snapshot hook
│   │   ├── types.ts          # shared TS types (Mode, Style, Autonomy, Deal, Snapshot, …)
│   │   ├── lib/
│   │   │   ├── format.ts     # formatRm, formatMatch
│   │   │   ├── listing.ts    # marketCheck, parseComparables, factLabel, parseEvidence
│   │   │   ├── memory.ts     # dealSummary, outcomeLabel, savingPercent, formatMatch
│   │   │   ├── pickup.ts     # describeSlot, pickupMessage, preferHours, parseEvidence
│   │   │   ├── profile.ts    # getProfileId (reads/creates haggle.profileId)
│   │   │   ├── series.ts
│   │   │   ├── theme.ts
│   │   │   └── traceModel.ts
│   │   ├── ui/               # design system
│   │   │   ├── badge/        # Badge
│   │   │   ├── button/       # Button (variant, size)
│   │   │   ├── card/         # Card
│   │   │   ├── icon/         # Icon (lucide-react)
│   │   │   ├── logo/         # Logo
│   │   │   ├── skeleton/     # Skeleton
│   │   │   └── tabs/         # Tabs
│   │   ├── components/shell/ # TopBar
│   │   ├── features/home/    # New negotiation form + market check + similar deals
│   │   ├── features/listing/ # CopilotItemPanel (item facts + market check)
│   │   ├── features/negotiation/   # Workspace, Conversation, CopilotComposer, Deal,
│   │   │   │                     ApprovalPanel, ActivityPanel, SummaryStrip, PriceLadder,
│   │   │   │                     ErrorBoundary, NotFoundScreen
│   │   └── features/profile/ # ProfilePage (preferences, past deals, clear memory)
│   └── e2e/                  # Playwright specs (desktop-light)
│       ├── profile.spec.ts   # Profile memory e2e
│       ├── copilot.spec.ts   # Copilot e2e
│       ├── flow.spec.ts      # Practice flow e2e
│       ├── pickup.spec.ts    # Pickup coordination e2e
│       ├── helpers.ts        # run id recording, screenshots, error collection
│       └── profile-registry.ts # profile-id registry for e2e cleanup
```
