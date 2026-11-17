import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { recordedProfileIds } from "./profile-registry";

const RUNS_FILE = path.join(process.cwd(), "e2e", ".runs.json");
const DELETE_SCRIPT = path.join(process.cwd(), "..", "scripts", "delete_run.py");
const DELETE_PROFILES_SCRIPT = path.join(
  process.cwd(),
  "..",
  "scripts",
  "delete_profiles.py",
);
const REPO_ROOT = path.join(process.cwd(), "..");

function readIds(file: string): string[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function runCleanup(script: string, ids: string[], label: string): void {
  if (ids.length === 0) {
    console.log(`GLOBAL TEARDOWN: no ${label} to clean up`);
    return;
  }
  const python = process.platform === "win32" ? "python" : "python3";
  const env = { ...process.env, PYTHONPATH: REPO_ROOT };
  const result = spawnSync(python, [script, ...ids], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`GLOBAL TEARDOWN FAILED: ${script} exited with code ${result.status}`);
    console.error(`STDOUT: ${result.stdout ?? ""}`);
    console.error(`STDERR: ${result.stderr ?? ""}`);
  } else {
    console.log(`GLOBAL TEARDOWN: cleaned up ${ids.length} ${label}`);
    console.log(`${result.stdout ?? ""}`);
  }
}

export default async function globalTeardown(): Promise<void> {
  const runIds = readIds(RUNS_FILE);
  runCleanup(DELETE_SCRIPT, runIds, "run(s)");

  const profileIds = recordedProfileIds();
  runCleanup(DELETE_PROFILES_SCRIPT, profileIds, "profile(s)");

  try {
    fs.unlinkSync(RUNS_FILE);
  } catch {
    // file may not exist
  }
  try {
    fs.unlinkSync(path.join(process.cwd(), "e2e", ".profiles.json"));
  } catch {
    // file may not exist
  }
}
