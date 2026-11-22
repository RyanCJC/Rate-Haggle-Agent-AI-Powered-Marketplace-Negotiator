# Setup

Detailed step-by-step setup for running Haggle locally. The quick start is in
[README.md](#quick-start); this page expands it.

## 1. Clone and configure

Create `.env` from `.env.example`:

**PowerShell:**

```powershell
Copy-Item .env.example .env
# edit .env — set DATABASE_URL at minimum
```

**macOS/Linux:**

```bash
cp .env.example .env
# edit .env — set DATABASE_URL at minimum
```

The API app (`backend/app/api/main.py`) calls `load_dotenv()` in its lifespan, so `.env` is loaded
automatically when you start the server — no manual export is required.

## 2. Backend setup

**PowerShell:**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**macOS/Linux:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Apply the database migrations:

**PowerShell:**

```powershell
python scripts/migrate.py
```

**macOS/Linux:**

```bash
python scripts/migrate.py
```

Optional: seed the listings/comparables/knowledge tables used by the market check and knowledge
base:

**PowerShell:**

```powershell
python scripts/seed.py
python scripts/seed_knowledge.py
python scripts/index_knowledge.py
```

**macOS/Linux:**

```bash
python scripts/seed.py
python scripts/seed_knowledge.py
python scripts/index_knowledge.py
```

## 3. Start the backend

**PowerShell:**

```powershell
$env:DATABASE_URL="<your database url>"
$env:LLM_MODEL="<your model name>"
$env:LLM_BASE_URL="http://localhost:11434/v1"
$env:LLM_API_KEY="not-needed"
python -m uvicorn backend.app.api.main:app --port 8000
```

**macOS/Linux:**

```bash
export DATABASE_URL="<your database url>"
export LLM_MODEL="<your model name>"
export LLM_BASE_URL="http://localhost:11434/v1"
export LLM_API_KEY="not-needed"
python -m uvicorn backend.app.api.main:app --port 8000
```

The app uses a live OpenAI-compatible model by default; set `HAGGLE_LLM=offline` to use the rule-based stand-in instead. Set
`DATABASE_URL`, `LLM_MODEL`, `LLM_BASE_URL`, and `LLM_API_KEY` in `.env` (loaded automatically)
or export them before starting uvicorn.

CORS defaults to `http://localhost:5173`; override with `CORS_ORIGINS`.

## 4. Start the frontend

**PowerShell:**

```powershell
cd frontend
npm install
npm run dev      # Vite dev server, defaults to http://localhost:5173
```

**macOS/Linux:**

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000` (`frontend/vite.config.ts`), so the
frontend and backend must run together.

Open `http://localhost:5173`, choose **Practice** or **Copilot**, and start negotiating.

## Marketplace channel (optional)

To use the simulated marketplace MCP channel in Copilot mode, set `MARKETPLACE_CHANNEL=on` in your
environment (the exact word `on`; anything else, or unset, keeps it off — default off). The channel
adds one more server process, so check your free-tier memory limit before enabling it.

In Copilot mode, choose the channel **"Haggle sends them after I approve (simulated marketplace)"**.
The agent will draft messages and pause for your approval before sending each one through the
marketplace MCP server.
