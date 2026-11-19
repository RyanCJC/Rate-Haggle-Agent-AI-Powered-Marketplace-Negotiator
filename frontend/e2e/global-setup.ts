import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = path.join(process.cwd(), "..");
const DELETE_SCRIPT = path.join(ROOT, "scripts", "delete_run.py");
const PYTHON = process.platform === "win32" ? "python" : "python3";
const ENV = { ...process.env, PYTHONPATH: ROOT, HAGGLE_LLM: "" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export default async function globalSetup(): Promise<void> {
  // 1. Health check
  const health = await json<{ ok: boolean }>("http://127.0.0.1:8000/health");
  if (!health.ok) {
    throw new Error(`Backend health check failed: ${JSON.stringify(health)}`);
  }

  // 2. Create a trivial run
  const run = await json<{ id: string }>("http://127.0.0.1:8000/negotiations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asking: 1200,
      budget: 1000,
      persona: "flexible",
      style: "balanced",
      autonomy: "approve_close",
      seed: 1,
    }),
  });
  const id = run.id;

  try {
    // Wait for the run to reach the gate (waiting_for_approval)
    let snapshot: any = null;
    for (let i = 0; i < 60; i++) {
      snapshot = await json<any>(`http://127.0.0.1:8000/negotiations/${id}`);
      if (snapshot.status === "waiting_for_approval" && snapshot.question) break;
      if (snapshot.status === "finished" || snapshot.status === "failed") break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // 3. Assert snapshot trace has validate entries with ok and codes keys
    const validates = snapshot.trace.filter((e: any) => e.node === "validate");
    if (validates.length === 0) {
      const nodes = snapshot.trace.map((e: any) => e.node).join(",") || "none";
      throw new Error(
        `No validate entries found in run trace (status=${snapshot.status}, error=${snapshot.error ?? "none"}, nodes=${nodes})`,
      );
    }
    for (const entry of validates) {
      if (entry.ok === undefined || entry.codes === undefined) {
        throw new Error(
          `Validate entry missing ok/codes keys: ${JSON.stringify(entry)}`,
        );
      }
    }
    console.log(
      `GLOBAL SETUP: run ${id} has ${validates.length} validate entry(ies) with ok/codes keys`,
    );
  } finally {
    // 4. Delete the run
    const result = spawnSync(PYTHON, [DELETE_SCRIPT, id], {
      cwd: ROOT,
      env: ENV,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `GLOBAL SETUP: delete_run.py failed for ${id}: ${result.stderr ?? result.stdout}`,
      );
    }
    console.log(`GLOBAL SETUP: deleted run ${id}`);
  }
}
