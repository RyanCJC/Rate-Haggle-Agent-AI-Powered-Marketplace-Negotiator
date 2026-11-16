import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const RUNS_FILE = path.join(process.cwd(), "e2e", ".runs.json");
const DELETE_SCRIPT = path.join(
  process.cwd(),
  "..",
  "scripts",
  "delete_run.py",
);
const REPO_ROOT = path.join(process.cwd(), "..");

export default async function globalTeardown(): Promise<void> {
  let ids: string[] = [];
  try {
    const raw = fs.readFileSync(RUNS_FILE, "utf8");
    ids = JSON.parse(raw);
    if (!Array.isArray(ids)) ids = [];
  } catch {
    ids = [];
  }

  if (ids.length > 0) {
    const python = process.platform === "win32" ? "python" : "python3";
    const env = { ...process.env, PYTHONPATH: REPO_ROOT };
    const result = spawnSync(python, [DELETE_SCRIPT, ...ids], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      console.error(
        `GLOBAL TEARDOWN FAILED: delete_run.py exited with code ${result.status}`,
      );
      console.error(`STDOUT: ${result.stdout ?? ""}`);
      console.error(`STDERR: ${result.stderr ?? ""}`);
    } else {
      console.log(`GLOBAL TEARDOWN: cleaned up ${ids.length} run(s)`);
      console.log(`${result.stdout ?? ""}`);
    }
  } else {
    console.log("GLOBAL TEARDOWN: no runs to clean up");
  }

  try {
    fs.unlinkSync(RUNS_FILE);
  } catch {
    // file may not exist
  }
}
