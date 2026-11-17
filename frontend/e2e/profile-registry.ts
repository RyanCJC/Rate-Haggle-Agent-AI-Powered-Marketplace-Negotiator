import fs from "fs";
import path from "path";
import type { Page } from "@playwright/test";

const PROFILES_FILE = path.join(process.cwd(), "e2e", ".profiles.json");
const PROFILE_ID_KEY = "haggle.profileId";
const BACKEND = "http://127.0.0.1:8000";

const PROFILE_ID = /^[0-9a-f]{32}$/;

export function recordProfileId(id: string | null): void {
  if (!id || !PROFILE_ID.test(id)) return;
  let existing: string[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"));
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
  if (!existing.includes(id)) {
    existing.push(id);
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(existing, null, 2));
  }
}

export function recordedProfileIds(): string[] {
  try {
    const ids = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf8"));
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

/** Reads the profile id from a page's localStorage, registers it, and deletes
 *  the profile (and its deals) from the backend. Safe to call when no row
 *  exists (DELETE /profile is a no-op then). Mirrors the run registry. */
export async function recordAndCleanupProfile(page: Page): Promise<void> {
  const id = await page
    .evaluate((key) => window.localStorage.getItem(key), PROFILE_ID_KEY)
    .catch(() => null);
  if (!id) return;
  recordProfileId(id);
  const response = await page.request.delete(`${BACKEND}/profile`, {
    headers: { "X-Profile-Id": id },
  });
  if (!response.ok()) {
    throw new Error(`Profile cleanup failed: ${response.status()} ${await response.text()}`);
  }
}
