import type { Page, TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";

const RUNS_FILE = path.join(process.cwd(), "e2e", ".runs.json");

export function runIdFromUrl(page: Page): string | null {
  const hash = page.url().split("#")[1] ?? "";
  const match = hash.match(/^\/run\/([0-9a-f]+)$/);
  return match ? match[1] : null;
}

export function recordRun(id: string): void {
  let existing: string[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(RUNS_FILE, "utf8"));
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
  if (!existing.includes(id)) {
    existing.push(id);
    fs.writeFileSync(RUNS_FILE, JSON.stringify(existing, null, 2));
  }
}

export function shot(page: Page, name: string, projectName: string): void {
  const dir = `e2e-screenshots/${projectName}`;
  fs.mkdirSync(dir, { recursive: true });
  void page.screenshot({
    path: `${dir}/${name}.png`,
    fullPage: true,
  });
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  page.on("requestfailed", (req) => {
    errors.push(`${req.method()} ${req.url()} ${req.failure()?.errorText ?? "failed"}`);
  });
  return errors;
}

export function checkNoConsoleErrors(testInfo: TestInfo): void {
  const errors = collectErrors(testInfo.page as Page);
  if (errors.length > 0) {
    throw new Error(`Console/page errors detected during test "${testInfo.title}":\n${errors.join("\n")}`);
  }
}
