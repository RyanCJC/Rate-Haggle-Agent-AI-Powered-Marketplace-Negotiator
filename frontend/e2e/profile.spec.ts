import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { recordRun, runIdFromUrl } from "./helpers";
import { recordProfileId } from "./profile-registry";

const PROFILE_ID_KEY = "haggle.profileId";
const BACKEND = "http://127.0.0.1:8000";
const consoleErrors = new WeakMap<Page, string[]>();
const allowMocked503 = new WeakSet<Page>();

function watchConsoleErrors(page: Page): void {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (allowMocked503.has(page) && /Failed to load resource:.*status of 503/.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));
}

async function assertLight(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

async function assertAxe(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  expect(violations, `${label} serious/critical axe violations`).toEqual([]);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.viewport);
}

async function assertInsideViewport(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(20);
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  const viewport = page.viewportSize()!;
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(viewport.width);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(viewport.height);
}

async function assertButtonsDoNotOverlapText(container: ReturnType<Page["locator"]>): Promise<void> {
  const overlaps = await container.evaluate((root) => {
    const buttons = Array.from(root.querySelectorAll("button"));
    const textNodes = Array.from(root.querySelectorAll("h1,h2,h3,p,legend,small,strong"));
    return buttons.flatMap((button) => textNodes.flatMap((text) => {
      if (button.contains(text) || text.contains(button)) return [];
      const a = button.getBoundingClientRect();
      const b = text.getBoundingClientRect();
      return a.width > 0 && b.width > 0 &&
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        ? [{ button: button.textContent?.trim(), text: text.textContent?.trim() }]
        : [];
    }));
  });
  expect(overlaps).toEqual([]);
}

async function screenshot(page: Page, name: string): Promise<void> {
  const directory = path.join(process.cwd(), "e2e-screenshots", "desktop-light");
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

async function visitProfile(page: Page): Promise<void> {
  await page.goto("/#/profile");
  await assertLight(page);
  await expect(page.getByTestId("profile-page")).toBeVisible();
  await expect(page.getByTestId("profile-unavailable")).toHaveCount(0);
}

async function startCopilot(page: Page, title = "Dell 27 inch gaming monitor 144hz"): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Copilot (real seller)" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill(title);
  await page.getByTestId("copilot-category").selectOption("monitors");
  await page.getByRole("button", { name: "Start negotiating" }).click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Copilot start did not navigate to a run.");
  recordRun(id);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText(/Waiting for your reply/);
  return id;
}

async function waitForNextGate(
  page: Page,
  id: string,
  previousDraft: string,
): Promise<"seller_reply" | "close_deal"> {
  let gate: "seller_reply" | "close_deal" | null = null;
  await expect.poll(async () => {
    const response = await page.request.get(`${BACKEND}/negotiations/${id}`);
    if (!response.ok()) return null;
    const snapshot = await response.json() as { question?: { gate?: string; draft?: string } | null };
    const question = snapshot.question;
    gate = question?.gate === "close_deal"
      ? "close_deal"
      : question?.gate === "seller_reply" && question.draft !== previousDraft
        ? "seller_reply"
        : null;
    return gate;
  }, { timeout: 30000 }).not.toBeNull();
  if (!gate) throw new Error("The agent did not reach the next Copilot gate.");
  if (gate === "seller_reply") {
    const snapshot = await (await page.request.get(`${BACKEND}/negotiations/${id}`)).json() as {
      question?: { draft?: string } | null;
    };
    await expect(page.getByTestId("copilot-draft")).toHaveValue(snapshot.question?.draft ?? "");
    await expect(page.getByTestId("copilot-announcement")).toHaveText("New draft ready");
    await expect(page.getByTestId("copilot-reply")).toHaveValue("");
    await expect(page.getByTestId("copilot-reply")).toBeFocused();
  } else {
    await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible();
  }
  return gate;
}

async function submitReply(
  page: Page,
  id: string,
  message: string,
): Promise<"seller_reply" | "close_deal"> {
  const draft = await page.getByTestId("copilot-draft").inputValue();
  await page.getByTestId("copilot-reply").fill(message);
  await page.getByTestId("copilot-send").click();
  return waitForNextGate(page, id, draft);
}

async function completeCopilotDeal(page: Page, title?: string): Promise<string> {
  const id = await startCopilot(page, title);
  let gate: "seller_reply" | "close_deal" = "seller_reply";
  for (const reply of [
    "Lowest I can go is RM 991.",
    "I can do RM 905 at best.",
    "Lowest I can go is RM 880.",
  ]) {
    if (gate === "close_deal") break;
    gate = await submitReply(page, id, reply);
  }
  if (gate !== "close_deal") throw new Error("Copilot did not reach the close gate.");
  await expect(page.getByRole("heading", { name: "Accept RM 880?" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("copilot-final-message-panel")).toBeVisible();
  await page.getByRole("tab", { name: "Deal" }).click();
  await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();
  return id;
}

async function savePreferences(
  page: Page,
  values: { style?: "aggressive" | "balanced" | "safe"; hours?: string; area?: string },
): Promise<void> {
  await visitProfile(page);
  if (values.style) {
    const styleLabel = values.style[0].toUpperCase() + values.style.slice(1);
    await page.getByRole("radio", { name: styleLabel, exact: true }).check();
  }
  if (values.hours) await page.getByRole("radio", { name: new RegExp(values.hours, "i") }).check();
  if (values.area !== undefined) await page.getByLabel("Usual pickup area").fill(values.area);
  await page.getByTestId("profile-save-preferences").click();
  await expect(page.getByRole("status")).toHaveText("Saved");
}

async function cleanupProfile(page: Page): Promise<void> {
  const id = await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_ID_KEY).catch(() => null);
  if (!id) return;
  recordProfileId(id);
  const response = await page.request.delete(`${BACKEND}/profile`, {
    headers: { "X-Profile-Id": id },
  });
  if (!response.ok()) {
    throw new Error(`Profile cleanup failed: ${response.status()} ${await response.text()}`);
  }
}

test.describe("Profile memory", () => {
  test.beforeEach(async ({ page }) => {
    watchConsoleErrors(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    const runId = runIdFromUrl(page);
    if (runId) recordRun(runId);
    await cleanupProfile(page);
    const errors = consoleErrors.get(page) ?? [];
    expect(errors, `${testInfo.title} browser console/page errors`).toEqual([]);
  });

  test("1. Profile id persists on reload and changes after removal", async ({ page }) => {
    await page.goto("/");
    const first = await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_ID_KEY);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    await page.reload();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PROFILE_ID_KEY)).toBe(first);
    await page.evaluate((key) => window.localStorage.removeItem(key), PROFILE_ID_KEY);
    await page.reload();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), PROFILE_ID_KEY)).not.toBe(first);
  });

  test("2. Empty profile saves and reloads preferences", async ({ page }) => {
    await visitProfile(page);
    await expect(page.getByText("Haggle remembers finished Copilot negotiations:", { exact: false })).toBeVisible();
    await expect(page.getByText("Nothing yet. Finish a Copilot negotiation and it will appear here.")).toBeVisible();
    await savePreferences(page, { style: "safe", hours: "evening", area: "Bangsar" });
    await expect(page.getByLabel("Usual pickup area")).toHaveAttribute("maxlength", "80");
    await page.reload();
    await expect(page.getByRole("radio", { name: "Safe", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: /Evening/ })).toBeChecked();
    await expect(page.getByLabel("Usual pickup area")).toHaveValue("Bangsar");
  });

  test("3. Completed Copilot deal appears in profile history", async ({ page }) => {
    await completeCopilotDeal(page);
    await visitProfile(page);
    const row = page.getByTestId(/profile-deal-/).first();
    await expect(row).toContainText("Dell 27 inch gaming monitor 144hz");
    await expect(row.getByText("Deal", { exact: true })).toBeVisible();
    await expect(row).toContainText("RM 880");
    await expect(row).toContainText("RM 1,200");
    await expect(row).toContainText("27% below");
  });

  test("4. Similar deals appear only for matching Copilot titles", async ({ page }) => {
    await completeCopilotDeal(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("27 inch monitor");
    await page.getByTestId("copilot-category").selectOption("monitors");
    const card = page.getByTestId("similar-past-deals");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Dell 27 inch gaming monitor 144hz");
    await expect(card).toContainText("match");
    await screenshot(page, "home-similar-deals");

    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("wooden dining table");
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Practice (simulated seller)" }).click();
    await expect(card).toHaveCount(0);
  });

  test("5. Item tab shows private history notes for a similar active deal", async ({ page }) => {
    await completeCopilotDeal(page);
    const second = await startCopilot(page, "27 inch monitor");
    await page.getByRole("tab", { name: "Item" }).click();
    const history = page.getByTestId("item-memory-notes");
    await expect(history).toBeVisible();
    await expect(history).toContainText("RM 880");
    await expect(history).toContainText("Never shared with the seller");
    await screenshot(page, "item-memory");
    const snapshot = await (await page.request.get(`${BACKEND}/negotiations/${second}`)).json() as {
      memory_notes: string[];
    };
    expect(snapshot.memory_notes.some((note) => note.includes("RM 880"))).toBe(true);
  });

  test("6. Forget refetches history across tabs and clears similar results", async ({ page, context }) => {
    await completeCopilotDeal(page);
    await visitProfile(page);
    const peer = await context.newPage();
    watchConsoleErrors(peer);
    await peer.goto("/#/profile");
    await expect(peer.getByTestId("profile-deals").getByRole("listitem")).toHaveCount(1);
    const row = page.getByTestId("profile-deals").getByRole("listitem").first();
    const beforeHeight = (await row.boundingBox())!.height;
    await page.getByTestId(/^profile-forget-/).first().click();
    const afterHeight = (await row.boundingBox())!.height;
    expect(afterHeight - beforeHeight).toBeLessThanOrEqual(beforeHeight);
    await page.getByTestId("profile-forget-confirm").getByRole("button", { name: "Forget" }).click();
    await expect(page.getByText("Nothing yet. Finish a Copilot negotiation and it will appear here.")).toBeVisible();
    await expect(peer.getByText("Nothing yet. Finish a Copilot negotiation and it will appear here.")).toBeVisible();
    expect(consoleErrors.get(peer) ?? []).toEqual([]);
    await peer.close();
    await page.goto("/");
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell 27 inch gaming monitor");
    await page.getByTestId("copilot-category").selectOption("monitors");
    await expect(page.getByTestId("similar-past-deals")).toHaveCount(0);
  });

  test("7. Clear memory deletes deals and resets preferences", async ({ page }) => {
    await completeCopilotDeal(page);
    await savePreferences(page, { style: "safe", hours: "evening", area: "Bangsar" });
    await page.getByRole("button", { name: "Clear my memory" }).click();
    await expect(page.getByTestId("profile-clear-confirm")).toContainText("This deletes 1 past deals and your preferences.");
    await page.getByRole("button", { name: "Delete everything" }).click();
    await expect(page.getByText("Nothing yet. Finish a Copilot negotiation and it will appear here.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "No preference", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Any time" })).toBeChecked();
    await expect(page.getByLabel("Usual pickup area")).toHaveValue("");
    await page.reload();
    await expect(page.getByRole("radio", { name: "No preference", exact: true })).toBeChecked();
  });

  test("8. Saved style pre-fills Home until changed by the user", async ({ page }) => {
    await savePreferences(page, { style: "safe" });
    await page.goto("/");
    await expect(page.getByRole("radio", { name: /Safe/ })).toBeChecked();
    await page.getByRole("radio", { name: /Aggressive/ }).check();
    await page.getByRole("textbox", { name: /asking price/i }).fill("1250");
    await expect(page.getByRole("radio", { name: /Aggressive/ })).toBeChecked();
    await page.goto("/#/profile");
    await page.goto("/");
    await expect(page.getByRole("radio", { name: /Safe/ })).toBeChecked();
  });

  test("9. Unavailable profile memory can retry and hides Home suggestions", async ({ page }) => {
    await page.route("**/api/profile/deals", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "profile memory is unavailable" }),
    }));
    allowMocked503.add(page);
    await page.goto("/#/profile");
    await expect(page.getByTestId("profile-unavailable")).toBeVisible();
    await expect(page.getByText("Profile memory is unavailable right now.")).toBeVisible();
    await page.unroute("**/api/profile/deals");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("profile-deals")).toHaveCount(0);
    await expect(page.getByText("Nothing yet. Finish a Copilot negotiation and it will appear here.")).toBeVisible();

    await page.route("**/api/profile/similar?*", (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "profile memory is unavailable" }),
    }));
    await page.goto("/");
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("27 inch monitor");
    await expect(page.getByTestId("similar-past-deals")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /asking price/i })).toBeEnabled();
  });

  test("10. Pickup panel shows the saved time and area hints", async ({ page }) => {
    await savePreferences(page, { hours: "evening", area: "Bangsar" });
    await completeCopilotDeal(page);
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByText("Showing your evening times first.")).toBeVisible();
    await expect(page.getByText("Your usual pickup area: Bangsar.")).toBeVisible();
  });

  test("11. Completed Practice run is not remembered", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Practice start did not navigate to a run.");
    recordRun(id);
    await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();
    await visitProfile(page);
    await expect(page.getByText("Nothing yet. Finish a Copilot negotiation and it will appear here.")).toBeVisible();
  });

  test("12. Waiting-for-reply conversation contains every bubble and stays above the composer", async ({ page }) => {
    const id = await startCopilot(page);
    await submitReply(page, id, "Lowest I can go is RM 991.");
    const geometry = await page.evaluate(() => {
      const conversation = document.querySelector("[data-testid='conversation-card']")!;
      const composer = document.querySelector("[data-testid='copilot-composer']")!;
      const conversationBox = conversation.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      const bubbles = Array.from(conversation.querySelectorAll("[data-testid='conversation-bubble']")).map((bubble) => {
        const rect = bubble.getBoundingClientRect();
        return {
          inside: rect.left >= conversationBox.left && rect.right <= conversationBox.right &&
            rect.top >= conversationBox.top && rect.bottom <= conversationBox.bottom,
        };
      });
      return {
        bubbles,
        conversationBottom: conversationBox.bottom,
        composerTop: composerBox.top,
      };
    });
    expect(geometry.bubbles.length).toBeGreaterThan(0);
    expect(geometry.bubbles.every((bubble) => bubble.inside)).toBe(true);
    expect(geometry.composerTop).toBeGreaterThanOrEqual(geometry.conversationBottom + 8);
  });

  test("13. Profile, Home suggestions, and Item history pass geometry and accessibility checks", async ({ page }) => {
    test.setTimeout(180_000);
    await visitProfile(page);
    await assertAxe(page, "Profile empty state");
    await assertNoHorizontalOverflow(page);
    await assertInsideViewport(page, page.getByTestId("profile-save-preferences"));
    await assertButtonsDoNotOverlapText(page.getByTestId("profile-page"));

    await completeCopilotDeal(page, "Dell 27 inch gaming monitor 144hz");
    await completeCopilotDeal(page, "LG 24 inch monitor");
    await visitProfile(page);
    await expect(page.getByTestId("profile-deals").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("profile-deals").getByRole("listitem").first())
      .toContainText("LG 24 inch monitor");
    await page.getByRole("radio", { name: "Safe", exact: true }).check();
    await page.getByLabel("Usual pickup area").fill("Bangsar");
    await page.getByTestId("profile-save-preferences").click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.evaluate(() => {
      const button = document.querySelector("[data-testid='profile-save-preferences']")!;
      const status = document.querySelector('[role="status"]')!;
      const b = button.getBoundingClientRect();
      const s = status.getBoundingClientRect();
      // status is on the same row, to the right of the button, vertically centred
      if (!(s.left >= b.right && s.top < b.bottom && s.bottom > b.top)) {
        throw new Error(
          `Saved status not to the right of the Save button: button=${JSON.stringify(b)} status=${JSON.stringify(s)}`,
        );
      }
    });
    await page.getByTestId(/^profile-forget-/).first().click();
    const row = page.getByTestId("profile-deals").getByRole("listitem").first();
    await expect(row.getByTestId("profile-forget-confirm")).toBeVisible();
    await page.evaluate(() => {
      const confirm = document.querySelector('[data-testid="profile-forget-confirm"]')!;
      const question = confirm.querySelector("span")!;
      const buttons = Array.from(confirm.querySelectorAll("button"));
      const forget = buttons.find((b) => b.textContent!.trim() === "Forget")!;
      const keep = buttons.find((b) => b.textContent!.trim() === "Keep")!;
      const rowEl = confirm.closest("li")!;
      const cardEl = confirm.closest("section")!;
      const c = confirm.getBoundingClientRect();
      const q = question.getBoundingClientRect();
      const f = forget.getBoundingClientRect();
      const k = keep.getBoundingClientRect();
      const r = rowEl.getBoundingClientRect();
      const crd = cardEl.getBoundingClientRect();
      const separated = (a: DOMRect, b: DOMRect) =>
        a.left >= b.right || b.left >= a.right || a.top >= b.bottom || b.top >= a.bottom;
      if (f.height !== k.height) {
        throw new Error(`Forget/Keep heights differ: ${f.height} vs ${k.height}`);
      }
      if (!separated(f, k)) throw new Error("Forget and Keep buttons overlap");
      if (!separated(f, q)) throw new Error("Forget button overlaps the question");
      if (!separated(k, q)) throw new Error("Keep button overlaps the question");
      if (
        c.left < r.left ||
        c.right > r.right ||
        c.top < r.top ||
        c.bottom > r.bottom ||
        c.left < crd.left ||
        c.right > crd.right ||
        c.top < crd.top ||
        c.bottom > crd.bottom
      ) {
        throw new Error("Confirmation box leaves its row/card");
      }
    });
    await assertAxe(page, "Profile with two deals and an open confirmation");
    await assertNoHorizontalOverflow(page);
    await assertInsideViewport(page, row.getByTestId("profile-forget-confirm"));
    await assertButtonsDoNotOverlapText(page.getByTestId("profile-page"));
    await screenshot(page, "profile-page");

    await page.goto("/");
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("27 inch gaming monitor");
    await page.getByTestId("copilot-category").selectOption("monitors");
    const similar = page.getByTestId("similar-past-deals");
    await expect(similar).toBeVisible();
    await assertAxe(page, "Home with similar-deals card");
    await assertNoHorizontalOverflow(page);
    await assertInsideViewport(page, similar);

    await startCopilot(page, "27 inch gaming monitor");
    await page.getByRole("tab", { name: "Item" }).click();
    const history = page.getByTestId("item-memory-notes");
    await expect(history).toBeVisible();
    await assertAxe(page, "Item tab with history card");
    await assertNoHorizontalOverflow(page);
    await assertInsideViewport(page, history);
  });

  test("profile page has a working top-bar link and active-page state", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/#\/profile$/);
    await expect(page.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  });
});
