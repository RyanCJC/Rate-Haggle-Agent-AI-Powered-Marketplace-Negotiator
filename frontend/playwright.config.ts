import { defineConfig, devices } from "@playwright/test";
import path from "path";

const ROOT = path.join(process.cwd(), "..");
const REUSE_SERVERS = process.env.REUSE_SERVERS === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 0,
    navigationTimeout: 30000,
    // Fresh browser context per test: no persisted localStorage (theme) so every
    // test starts in light mode regardless of what a previous test set.
    storageState: { cookies: [], origins: [] },
  },
  expect: {
    timeout: 30000,
  },
  timeout: 90000,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  webServer: [
    {
      name: "backend",
      command:
        process.platform === "win32"
          ? path.join(ROOT, ".venv", "Scripts", "python.exe") + " -m uvicorn backend.app.api.main:app --port 8000"
          : path.join(ROOT, ".venv", "bin", "python") + " -m uvicorn backend.app.api.main:app --port 8000",
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: ROOT, HAGGLE_LLM: "offline", MARKETPLACE_CHANNEL: "on" },
      // e2e must never call a real LLM: offline is opt-in (see backend/app/settings.py)
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: REUSE_SERVERS,
      timeout: 120000,
    },
    {
      name: "frontend",
      command: "npm run dev",
      cwd: process.cwd(),
      env: { ...process.env },
      url: "http://localhost:5173",
      reuseExistingServer: REUSE_SERVERS,
      timeout: 120000,
    },
  ],
  projects: [
    {
      name: "desktop-light",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" },
    },
  ],
});
