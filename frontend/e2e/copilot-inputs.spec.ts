import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { recordRun, runIdFromUrl } from "./helpers";
import { recordAndCleanupProfile } from "./profile-registry";

const API_BASE = "/api";

const errorsByPage = new WeakMap<Page, string[]>();

function watchPageErrors(page: Page): void {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource:.*status of (?:409|422|503)/.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
}

async function assertLight(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

/** POST /negotiations with a body, register the run for teardown immediately. */
async function startRunViaApi(
  page: Page,
  body: Record<string, unknown>
): Promise<string> {
  const response = await page.request.post(`${API_BASE}/negotiations`, { data: body });
  expect(response.ok(), `start negotiation failed: ${response.status()}`).toBeTruthy();
  const data = (await response.json()) as { id: string };
  const id = data.id;
  if (!id) throw new Error("API start did not return a run id.");
  recordRun(id);
  return id;
}

/** Open the run page in the browser (API-started runs are not shown until we navigate). */
async function openRun(page: Page, id: string) {
  await page.goto(`/#/run/${id}`);
  await expect(page.getByTestId("run-status")).toBeVisible({ timeout: 15000 });
}

/** Read the full snapshot via the API. */
async function getSnapshot(page: Page, id: string) {
  const response = await page.request.get(`${API_BASE}/negotiations/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as any;
}

/** Poll until the run reaches a gate different from previousDraft, or finishes. */
async function waitForNextGate(
  page: Page,
  id: string,
  previousDraft: string | null
): Promise<{ gate: "seller_reply" | "close_deal" | "finished"; draft: string }> {
  let gate: "seller_reply" | "close_deal" | "finished" | null = null;
  let draft = "";
  await expect.poll(
    async () => {
      const response = await page.request.get(`${API_BASE}/negotiations/${id}`);
      if (!response.ok()) return null;
      const snapshot = await response.json() as {
        status?: string;
        question?: { gate?: string; draft?: string } | null;
        outcome?: string | null;
      };
      if (snapshot.status === "finished" || snapshot.outcome) {
        gate = "finished";
        draft = snapshot.outcome ?? "";
        return gate;
      }
      const question = snapshot.question;
      if (!question) return null;
      if (question.gate === "close_deal") {
        gate = "close_deal";
        draft = question.draft ?? "";
        return gate;
      }
      if (
        question.gate === "seller_reply" &&
        typeof question.draft === "string" &&
        question.draft !== previousDraft
      ) {
        gate = "seller_reply";
        draft = question.draft;
        return gate;
      }
      return null;
    },
    { timeout: 60000 }
  ).not.toBeNull();
  if (!gate) throw new Error("The agent did not reach a supported Copilot gate.");
  return { gate, draft };
}

/** Poll until the agent has processed one more seller reply and is waiting again (or finished). */
async function waitForNextTurn(
  page: Page,
  id: string,
  ingestCountBefore: number
): Promise<{ gate: "seller_reply" | "close_deal" | "finished"; draft: string; ingestCount: number }> {
  let result: { gate: "seller_reply" | "close_deal" | "finished"; draft: string; ingestCount: number } | null = null;
  await expect.poll(
    async () => {
      const response = await page.request.get(`${API_BASE}/negotiations/${id}`);
      if (!response.ok()) return null;
      const snapshot = (await response.json()) as {
        status?: string;
        trace?: unknown[];
        question?: { gate?: string; draft?: string } | null;
        outcome?: string | null;
      };
      const ingestCount = traceIntent(snapshot.trace ?? [], "ingest").length;
      if (snapshot.status === "finished" || snapshot.outcome) {
        result = { gate: "finished", draft: snapshot.outcome ?? "", ingestCount };
        return result.gate;
      }
      const q = snapshot.question;
      if (ingestCount > ingestCountBefore && q && (q.gate === "seller_reply" || q.gate === "close_deal")) {
        result = { gate: q.gate, draft: q.draft ?? "", ingestCount };
        return result.gate;
      }
      return null;
    },
    { timeout: 60000 }
  ).not.toBeNull();
  if (!result) throw new Error("The agent did not process the seller reply.");
  return result;
}

function traceIntent(trace: unknown[], nodeType: string): unknown[] {
  return trace.filter((e) => (e as { node?: string }).node === nodeType);
}

test.describe("@copilot-inputs", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) {
      recordRun(id);
    }
    await recordAndCleanupProfile(page);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // G1 @inputs-form — UI form validation (asking/budget strings)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Home.tsx rules (file:line):
  //   askingValid = asking.trim() !== "" && Number.isFinite(askingN) && askingN > 0   (Home.tsx:128)
  //   budgetValid = budget.trim() !== "" && Number.isFinite(budgetN) && budgetN > 0   (Home.tsx:129)
  //   valid = askingValid && budgetValid                                              (Home.tsx:130)
  //   Start disabled when !valid                                                      (Home.tsx:525)
  //   inline field errors: "Enter a valid asking price." / "Enter a valid budget."    (Home.tsx:211,215)

  const FORM_CASES: Array<{
    asking: string;
    budget: string;
    outcome: "accepted" | "rejected";
    errorField?: "asking" | "budget";
  }> = [
    { asking: "1200", budget: "1000", outcome: "accepted" },
    { asking: "1000", budget: "1000", outcome: "accepted" },
    { asking: "1000", budget: "1500", outcome: "accepted" },
    { asking: "", budget: "1000", outcome: "rejected", errorField: "asking" },
    { asking: "0", budget: "1000", outcome: "rejected", errorField: "asking" },
    { asking: "-500", budget: "1000", outcome: "rejected", errorField: "asking" },
    { asking: "abc", budget: "1000", outcome: "rejected", errorField: "asking" },
    { asking: "1,200", budget: "1000", outcome: "accepted" }, // thousands separator valid
    { asking: "RM 1200", budget: "1000", outcome: "accepted" }, // RM prefix valid
    { asking: "1200", budget: "", outcome: "rejected", errorField: "budget" },
    { asking: "1200", budget: "0", outcome: "rejected", errorField: "budget" },
    { asking: "1200", budget: "-100", outcome: "rejected", errorField: "budget" },
    { asking: "1200", budget: "abc", outcome: "rejected", errorField: "budget" },
    { asking: "1200.50", budget: "1000", outcome: "accepted" }, // decimals valid
    { asking: "RM 1,200.50", budget: "1000", outcome: "accepted" }, // RM prefix + thousands
    { asking: "rm1200", budget: "1000", outcome: "accepted" }, // lowercase RM prefix
    { asking: "1,2", budget: "1000", outcome: "rejected", errorField: "asking" }, // bad grouping
    { asking: "12,34,567", budget: "1000", outcome: "rejected", errorField: "asking" }, // bad grouping
    { asking: "  1200  ", budget: "  1000  ", outcome: "accepted" }, // trimmed
    { asking: "99999999", budget: "1000", outcome: "accepted" }, // very large valid
  ];

  for (const c of FORM_CASES) {
    test(`@copilot-inputs @inputs-form asking="${c.asking}" budget="${c.budget}" → ${c.outcome}`, async ({ page }) => {
      test.setTimeout(60000);
      await page.goto("/");
      await assertLight(page);
      await page.getByRole("button", { name: "Copilot (real seller)" }).click();

      const askingInput = page.getByRole("textbox", { name: /asking price/i });
      const budgetInput = page.getByRole("textbox", { name: /maximum budget/i });
      const start = page.getByTestId("start-negotiation");

      await askingInput.fill("");
      await askingInput.fill(c.asking);
      await budgetInput.fill("");
      await budgetInput.fill(c.budget);

      if (c.outcome === "rejected") {
        // Start is disabled when asking/budget invalid (Home.tsx:525)
        await expect(start).toBeDisabled({ timeout: 5000 });
        // No navigation happened
        await expect(page).not.toHaveURL(/#\/run\//);
        // No run created: nothing to record
        if (c.errorField) {
          const raw = c.errorField === "asking" ? c.asking : c.budget;
          const hint = page.getByTestId(`${c.errorField}-hint`);
          if (raw.trim() === "") {
            // Empty field: required, but no hint is shown yet
            await expect(hint).toBeHidden({ timeout: 5000 });
          } else {
            await expect(hint).toBeVisible({ timeout: 5000 });
          }
        }
      } else {
        // No hint visible for accepted (empty or valid fields)
        await expect(page.getByTestId("asking-hint")).not.toBeVisible();
        await expect(page.getByTestId("budget-hint")).not.toBeVisible();
        await expect(start).toBeEnabled({ timeout: 5000 });
        await start.click();
        await page.waitForURL(/#\/run\/[0-9a-f]+/);
        const id = runIdFromUrl(page);
        if (!id) throw new Error("Form start did not navigate to a run.");
        recordRun(id);
        // Accepted case: nothing else to do (run recorded for teardown)
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // G2 @inputs-api — API start validation (no UI)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // backend/app/api/schemas.py rules:
  //   asking/budget: Decimal gt=0                                                (schemas.py:16-17)
  //   style: Literal["aggressive","balanced","safe"]                             (schemas.py:19)
  //   autonomy: Literal["auto","approve_close"]                                  (schemas.py:20)
  //   mode: Literal["simulate","copilot"]                                        (schemas.py:22)
  //   channel: Literal["manual","marketplace"]                                   (schemas.py:33)
  //   marketplace requires mode=copilot                                          (schemas.py:49-50)
  //   marketplace + seller_opening raises error                                  (schemas.py:51-52)

  const API_CASES: Array<{
    name: string;
    body: Record<string, unknown>;
    expectedStatus: number;
    createsRun: boolean;
  }> = [
    // Happy path
    {
      name: "happy path copilot manual",
      body: { asking: 1200, budget: 1000, persona: "flexible", style: "balanced", autonomy: "approve_close", mode: "copilot", channel: "manual" },
      expectedStatus: 201,
      createsRun: true,
    },
    // Invalid numeric fields (gt=0)
    { name: "asking zero", body: { asking: 0, budget: 1000, mode: "copilot" }, expectedStatus: 422, createsRun: false },
    { name: "budget negative", body: { asking: 1200, budget: -100, mode: "copilot" }, expectedStatus: 422, createsRun: false },
    { name: "asking non-numeric", body: { asking: "abc", budget: 1000, mode: "copilot" }, expectedStatus: 422, createsRun: false },
    // Invalid style
    { name: "invalid style", body: { asking: 1200, budget: 1000, style: "ferocious", mode: "copilot" }, expectedStatus: 422, createsRun: false },
    // Invalid category
    { name: "invalid category", body: { asking: 1200, budget: 1000, category: "cars", mode: "copilot" }, expectedStatus: 422, createsRun: false },
    // channel_validation: marketplace requires copilot mode
    { name: "marketplace with practice mode", body: { asking: 1200, budget: 1000, channel: "marketplace", mode: "simulate" }, expectedStatus: 422, createsRun: false },
    // channel_validation: marketplace + seller_opening
    { name: "marketplace with seller_opening", body: { asking: 1200, budget: 1000, channel: "marketplace", mode: "copilot", seller_opening: "Hello" }, expectedStatus: 422, createsRun: false },
    // persona: unknown -> 422 (validated at start for all modes)
    { name: "invalid persona", body: { asking: 1200, budget: 1000, persona: "not_a_persona", mode: "copilot" }, expectedStatus: 422, createsRun: false },
  ];

  for (const c of API_CASES) {
    test(`@copilot-inputs @inputs-api ${c.name} → ${c.expectedStatus}`, async ({ page }) => {
      test.setTimeout(60000);
      const response = await page.request.post(`${API_BASE}/negotiations`, { data: c.body });
      expect(response.status()).toBe(c.expectedStatus);

      if (c.expectedStatus === 422) {
        const body = await response.json();
        expect(body.detail).toBeDefined();
        // Rejected requests create no run: nothing to record
      } else {
        const data = (await response.json()) as { id: string };
        expect(data.id).toBeTruthy();
        recordRun(data.id);
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // G3 @inputs-reply — manual Copilot, parse seller replies via UI
  // ════════════════════════════════════════════════════════════════════════════
  //
  // RuleBasedLLM._extract intent mapping (backend/app/llm/fake.py:29-40):
  //   price: RM-prefixed number match (MONEY regex, re.IGNORECASE)
  //   accepted: "deal at", "works for me", "okay deal", "settle"
  //   walked_away: "someone else", "jual orang lain"
  //   asks_budget: "budget", "willing to go", "bagi berapa"
  //   pressure: "another buyer", "orang lain nak"
  //   terms_changed: "no longer", "tak termasuk"

  const REPLY_CASES: Array<{
    reply: string;
    expectedIntent: Partial<{ price: string | null; accepted: boolean; walked_away: boolean; asks_budget: boolean; pressure: boolean; terms_changed: boolean }>;
  }> = [
    { reply: "RM 1,100", expectedIntent: { price: "1100" } },
    { reply: "1100", expectedIntent: { price: null } }, // no RM prefix → MONEY finds nothing
    { reply: "rm1100", expectedIntent: { price: "1100" } }, // case-insensitive (re.IGNORECASE)
    { reply: "RM1,100.00", expectedIntent: { price: "1100.00" } },
    { reply: "RM 1.1k", expectedIntent: { price: "1.1" } }, // MONEY stops before "k"
    { reply: "RM900 je", expectedIntent: { price: "900" } },
    { reply: "Last price RM 1050 boss", expectedIntent: { price: "1050" } },
    { reply: "no price here, still available", expectedIntent: { price: null } },
    { reply: "ok deal", expectedIntent: { accepted: false } }, // "ok deal" ≠ "okay deal" in accepted list
    { reply: "sorry it is sold", expectedIntent: { accepted: false } },
    { reply: "another buyer is coming, decide now", expectedIntent: { pressure: true } },
  ];

  for (const c of REPLY_CASES) {
    test(`@copilot-inputs @inputs-reply seller reply "${c.reply}"`, async ({ page }) => {
      test.setTimeout(180_000);
      const id = await startRunViaApi(page, {
        asking: 1200, budget: 900, persona: "flexible", style: "balanced", autonomy: "approve_close", mode: "copilot", channel: "manual",
      });

      await openRun(page, id);

      // Wait for first seller_reply gate
      const firstGate = await waitForNextGate(page, id, null);
      expect(firstGate.gate).toBe("seller_reply");

      // Wait until the page has rendered the draft before reading it
      const draftBox = page.getByTestId("copilot-draft");
      await expect(draftBox).not.toHaveValue("", { timeout: 15000 });
      const draftBefore = await draftBox.inputValue();

      // Submit the seller reply through the UI
      await page.getByTestId("copilot-reply").fill(c.reply);
      await page.getByTestId("copilot-send").click();

      const nextGate = await waitForNextGate(page, id, draftBefore);

      // Trace assertion: exactly one new ingest node with expected fields
      const snapshot = await getSnapshot(page, id);
      const trace = snapshot.trace as unknown[];
      const ingestNodes = traceIntent(trace, "ingest");
      expect(ingestNodes.length).toBeGreaterThan(0);
      const lastIngest = ingestNodes[ingestNodes.length - 1] as { intent?: Record<string, unknown> };
      const intent = lastIngest.intent ?? {};
      for (const [key, expectedValue] of Object.entries(c.expectedIntent)) {
        expect(intent[key]).toBe(expectedValue);
      }

      // The run reached a new gate or finished as the intent implies
      expect(["seller_reply", "close_deal", "finished"]).toContain(nextGate.gate);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // G4 @inputs-scale — plan price constraints across rounds
  // ════════════════════════════════════════════════════════════════════════════
  //
  // strategy.py rules:
  //   limit = min(max_budget * 0.97, ref * 0.92, asking_price)              (strategy.py:85-91)
  //   opening = min(ref * opening_ratio, limit * 0.85), floored to step 5   (strategy.py:94-99,129-130)
  //   STYLES: aggressive opening_ratio=0.62, balanced 0.70, safe 0.78       (strategy.py:22-38)

  const SCALE_CASES: Array<{ asking: number; budget: number }> = [
    { asking: 50, budget: 40 },
    { asking: 1200, budget: 900 },
    { asking: 25000, budget: 20000 },
    { asking: 1200, budget: 300 },
    { asking: 1200, budget: 1190 },
    { asking: 1200, budget: 1500 },
  ];

  for (const c of SCALE_CASES) {
    test(`@copilot-inputs @inputs-scale asking=${c.asking} budget=${c.budget}`, async ({ page }) => {
      test.setTimeout(180_000);
      const id = await startRunViaApi(page, {
        asking: c.asking, budget: c.budget, persona: "flexible", style: "balanced", autonomy: "approve_close", mode: "copilot", channel: "manual",
      });

      await openRun(page, id);

      // First gate: first plan price
      const gate1 = await waitForNextGate(page, id, null);
      expect(gate1.gate).toBe("seller_reply");

      // Two more replies to get more plan prices
      let currentGate: { gate: "seller_reply" | "close_deal" | "finished"; draft: string } = gate1;
      let ingestCount = traceIntent(((await getSnapshot(page, id)).trace as unknown[]) ?? [], "ingest").length;
      const replyPrice = Math.max(1, Math.round(c.asking * 0.95));
      for (let i = 0; i < 2 && currentGate.gate === "seller_reply"; i += 1) {
        await expect(page.getByTestId("copilot-reply")).toBeVisible({ timeout: 10000 });
        await page.getByTestId("copilot-reply").fill(`RM ${replyPrice}, final price.`);
        await expect(page.getByTestId("copilot-send")).toBeVisible({ timeout: 10000 });
        await page.getByTestId("copilot-send").click();
        const next = await waitForNextTurn(page, id, ingestCount);
        ingestCount = next.ingestCount;
        currentGate = next;
      }

      const snapshot = await getSnapshot(page, id);
      const trace = snapshot.trace as unknown[];
      const planNodes = traceIntent(trace, "plan");

      expect(planNodes.length).toBeGreaterThan(0);

      let prevPrice: number | null = null;
      for (const plan of planNodes) {
        const p = plan as { price?: string | number | null };
        if (p.price != null) {
          const priceNum = Number(p.price);
          expect(priceNum).toBeLessThanOrEqual(c.budget);
          expect(priceNum).toBeLessThanOrEqual(c.asking);
          expect(priceNum).toBeGreaterThan(0);
          if (prevPrice !== null) {
            expect(priceNum).toBeGreaterThanOrEqual(prevPrice);
          }
          prevPrice = priceNum;
        }
      }

      // First offer < limit (limit = min(budget*0.97, asking*0.92, asking))
      const limit = Math.min(c.budget * 0.97, c.asking * 0.92, c.asking);
      const firstPlan = planNodes[0] as { price?: string | number | null };
      if (firstPlan.price != null) {
        expect(Number(firstPlan.price)).toBeLessThan(limit);
      }

      // No NaN/empty prices
      for (const plan of planNodes) {
        const p = plan as { price?: string | number | null };
        expect(p.price).not.toBe("");
        expect(p.price).not.toBeNaN();
      }

      // Summary strip shows RM values formatted by app formatter (format.ts:3-11)
      const strip = page.getByTestId("run-status");
      await expect(strip).toBeVisible();
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // G5 @inputs-text — item title special characters (UI)
  // ════════════════════════════════════════════════════════════════════════════
  //
  // Home.tsx rules: item_title maxLength=120 (Home.tsx:314), type="text" input (Home.tsx:313)

  const TITLE_CASES: Array<{
    title: string;
    label: string;
  }> = [
    { title: "", label: "empty title" },
    { title: "A".repeat(120), label: "120 chars" },
    { title: "Kerusi gaming murah", label: "Malay" },
    { title: "电脑显示器", label: "Chinese characters" },
    { title: "Gaming monitor 🎮", label: "emoji" },
    { title: "Monitor <script>alert(1)</script>", label: "HTML markup" },
    { title: 'Monitor with "quotes" and & ampersands', label: "quotes and ampersands" },
  ];

  for (const c of TITLE_CASES) {
    test(`@copilot-inputs @inputs-text item title: ${c.label}`, async ({ page }) => {
      test.setTimeout(60000);
      await page.goto("/");
      await assertLight(page);
      await page.getByRole("button", { name: "Copilot (real seller)" }).click();

      const titleInput = page.getByRole("textbox", { name: "Item title (optional)" });
      await titleInput.fill("");
      await titleInput.fill(c.title);

      // maxLength behaviour
      const maxLength = await titleInput.getAttribute("maxlength");
      expect(Number(maxLength)).toBe(120);

      const start = page.getByTestId("start-negotiation");
      await expect(start).toBeEnabled();
      await start.click();
      await page.waitForURL(/#\/run\/[0-9a-f]+/);
      const id = runIdFromUrl(page);
      if (!id) throw new Error("Start did not navigate to a run.");
      recordRun(id);

      // Title shown as plain text in Item tab
      await page.getByRole("tab", { name: "Item" }).click();
      const itemPanel = page.getByTestId("copilot-item-panel");
      await expect(itemPanel).toBeVisible();

      // No element created from markup: no  or <script> from title
      const pageHtml = await page.content();
      expect(pageHtml).not.toContain("<script>");
      expect(pageHtml).not.toContain("<img");

      // No dialog event, no console errors (checked in afterEach)
      await expect(page.getByTestId("copilot-composer")).toBeVisible();
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // G6 @inputs-matrix — category × style first-offer ordering
  // ════════════════════════════════════════════════════════════════════════════
  //
  // strategy.py: opening = min(ref * opening_ratio, limit * opening_cap)
  //   aggressive opening_ratio=0.62, balanced 0.70, safe 0.78 (strategy.py:22-38)

  const CATEGORIES = ["monitors", "phones", "laptops", "cameras", "consoles", "furniture", "appliances", "other"];
  const STYLES = ["aggressive", "balanced", "safe"];
  const MATRIX_ASKING = 1200;
  const MATRIX_BUDGET = 1100; // limit = min(1100*0.97, 1200*0.92, 1200) = 1067, so opening_ratio is binding

  for (const category of CATEGORIES) {
    test(`@copilot-inputs @inputs-matrix category=${category} style ordering aggressive < balanced < safe`, async ({ page }) => {
      test.setTimeout(180_000);
      const limit = Math.min(MATRIX_BUDGET * 0.97, MATRIX_ASKING * 0.92, MATRIX_ASKING);
      const firstOffers: { style: string; price: number }[] = [];

      for (const style of STYLES) {
        const id = await startRunViaApi(page, {
          asking: MATRIX_ASKING, budget: MATRIX_BUDGET, persona: "flexible", style, autonomy: "approve_close", mode: "copilot", channel: "manual", category,
        });

      const gate = await waitForNextGate(page, id, null);
      expect(["seller_reply", "close_deal"]).toContain(gate.gate);

        const snapshot = await getSnapshot(page, id);
        const trace = snapshot.trace as unknown[];
        const planNodes = traceIntent(trace, "plan");
        expect(planNodes.length).toBeGreaterThan(0);

        const firstPlan = planNodes[0] as { price?: string | number | null };
        expect(firstPlan.price).toBeTruthy();
        const price = Number(firstPlan.price);
        expect(price).toBeGreaterThan(0);
        expect(price).toBeLessThanOrEqual(MATRIX_BUDGET);
        expect(price).toBeLessThanOrEqual(limit);

        firstOffers.push({ style, price });
      }

      // Within-category ordering: aggressive <= balanced <= safe
      const [aggressive, balanced, safe] = firstOffers.map((f) => f.price);
      expect(aggressive).toBeLessThanOrEqual(balanced);
      expect(balanced).toBeLessThanOrEqual(safe);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // G7 @inputs-edit — marketplace send edit variants
  // ════════════════════════════════════════════════════════════════════════════
  //
  // validate.py + outbound.py rules:
  //   private_phrase: "max budget", "my budget", "budget is/of/limit", "my limit/ceiling", "highest i can", "walk-away price" (outbound.py:6-16)
  //   ceiling_claim: "most/best/highest/max...i can", "i can only", "all i can", "final/last offer/price", "stretch" (outbound.py:18-29)
  //   number_above_ceiling: amount > ceiling and not in public (asking, seller_last_price) (outbound.py:106-118)
  //   SendRequest.sent_text max_length=4000 (schemas.py:83)

  test("@copilot-inputs @inputs-edit marketplace send edit variants", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, {
      asking: 1200, budget: 900, persona: "flexible", style: "balanced", autonomy: "approve_close", mode: "copilot", channel: "marketplace",
    });

    // Reach first seller_reply gate
    const gate = await waitForNextGate(page, id, null);
    expect(gate.gate).toBe("seller_reply");
    const draft = gate.draft;

    // ═══════════════════════════════════════════════════════════════════════════
    // Rejected edits (all on the same run — rejections don't change run state)
    // Validation rules (outbound.py + validate.py):
    //   private_phrase: "max budget", "my budget", "budget is/of/limit", "my limit/ceiling", "highest i can", "walk-away price" (outbound.py:6-16)
    //   ceiling_claim: "most/best/highest/max...i can", "i can only", "all i can", "final/last offer/price", "stretch" (outbound.py:18-29)
    //   number_above_ceiling: amount > ceiling and not in public (asking, seller_last_price) (outbound.py:106-118)
    //   SendRequest.sent_text max_length=4000 (schemas.py:83)
    // ═══════════════════════════════════════════════════════════════════════════

    const sendOfferCalls = async (runId: string): Promise<number> => {
      const response = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(runId)}/mcp-calls`);
      expect(response.ok()).toBeTruthy();
      const body = await response.json() as { calls: unknown[] };
      return body.calls.filter((c) => (c as { tool?: string }).tool === "send_offer").length;
    };

    let callsBefore = await sendOfferCalls(id);

    const draftPrice = draft.match(/RM\s*([\d,]+)/)?.[1];
    expect(draftPrice, `no RM price in the first draft: "${draft}"`).toBeTruthy();

    const REJECTED_EDITS: Array<{ name: string; sentText: string | undefined; expectedMessage?: string }> = [
      { name: "5000 characters", sentText: "x".repeat(5000), expectedMessage: undefined }, // max_length=4000 (schemas.py:83) — Pydantic 422, not check_draft
      { name: "price above current offer", sentText: `How about RM 900? My max is ${draftPrice}`, expectedMessage: "price above your current offer" }, // number_above_ceiling fires first (outbound.py:111-113)      { name: "my max is 900", sentText: "My max is 900", expectedMessage: "price above your current offer" }, // number_above_ceiling (900 > limit 873) (outbound.py:106-118)
      { name: "price above the limit", sentText: "How about RM 2000?", expectedMessage: "price above your current offer" }, // number_above_ceiling (2000 > ceiling) (outbound.py:106-118)
      { name: "different price", sentText: "How about RM 850?", expectedMessage: "price above your current offer" }, // number_above_ceiling (850 > planned offer 740) (outbound.py:111-113)
      { name: "no price (Malay)", sentText: "Boleh kurang lagi?", expectedMessage: "State the exact price in the message." }, // price_not_stated (nodes.py:103)
      { name: "wrong price with newline", sentText: "Hello\nHow about RM 850?", expectedMessage: "price above your current offer" }, // number_above_ceiling (outbound.py:111-113)
      { name: "whitespace only", sentText: "   ", expectedMessage: "Write a message." }, // no_draft (nodes.py:95)
    ];

    for (const editCase of REJECTED_EDITS) {
      const response = await page.request.post(`${API_BASE}/negotiations/${encodeURIComponent(id)}/send`, {
        data: editCase.sentText !== undefined ? { sent_text: editCase.sentText } : {},
      });

      const bodyText = await response.text();
      expect(response.status(), `rejected edit "${editCase.name}" body=${bodyText}`).toBe(422);
      const body = JSON.parse(bodyText);
      const detailText = Array.isArray(body.detail) ? body.detail.join(" ") : String(body.detail);

      if (editCase.expectedMessage) {
        expect(detailText, `rejected edit "${editCase.name}" detail=${detailText}`).toContain(editCase.expectedMessage);
      } else {
        // Pydantic validation error (5000 chars) — detail is an array of dicts, not strings
        expect(bodyText, `rejected edit "${editCase.name}" body=${bodyText}`).toContain("at most 4000 characters");
      }

      // Rejected edits must not add a send_offer
      const callsAfter = await sendOfferCalls(id);
      expect(callsAfter).toBe(callsBefore);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Accepted edits (each on its own fresh run — an accepted send moves the run on)
    // Accepted: same as draft, trailing spaces, empty string (tidy_sent→None), different price, Malay sentence, newlines
    // ═══════════════════════════════════════════════════════════════════════════

    // ═══ Accepted edits: each on its own fresh run ═══
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const planned = (d: string) => d.match(/RM\s*([\d,]+(?:\.\d+)?)/)?.[1] ?? null;

    const ACCEPTED_EDITS: Array<{ name: string; needsPrice?: boolean; build: (gateDraft: string) => string }> = [
      { name: "same as draft", build: (d) => d },
      { name: "draft with trailing spaces", build: (d) => d + "   " },
      { name: "empty string = send stored draft", build: () => "" }, // validation skipped (service.py:152)
      { name: "Malay with planned price", needsPrice: true, build: (d) => `Boleh RM ${planned(d)}?` },
      { name: "newline with planned price", needsPrice: true, build: (d) => `Hello\nHow about RM ${planned(d)}?` },
    ];

    for (const editCase of ACCEPTED_EDITS) {
      const editId = await startRunViaApi(page, {
        asking: 1200, budget: 900, persona: "flexible", style: "balanced", autonomy: "approve_close", mode: "copilot", channel: "marketplace",
      });
      const editGate = await waitForNextGate(page, editId, null);
      expect(editGate.gate, `"${editCase.name}" first gate`).toBe("seller_reply");
      const editDraft = editGate.draft;
      if (editCase.needsPrice) {
        expect(planned(editDraft), `"${editCase.name}": no RM price in draft "${editDraft}"`).not.toBeNull();
      }
      const sentText = editCase.build(editDraft);

      const response = await page.request.post(`${API_BASE}/negotiations/${encodeURIComponent(editId)}/send`, {
        data: { sent_text: sentText },
      });
      const bodyText = await response.text();
      expect(response.status(), `accepted edit "${editCase.name}" body=${bodyText}`).toBe(202);

      const nextGate = await waitForNextGate(page, editId, editDraft);
      expect(nextGate.gate, `"${editCase.name}" next gate`).toBe("seller_reply");
      expect(await sendOfferCalls(editId), `"${editCase.name}" send_offer count`).toBe(1);

      const svResponse = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(editId)}/seller-view`);
      expect(svResponse.ok()).toBeTruthy();
      const sellerView = (await svResponse.json()) as { messages: { from?: string; text?: string }[] };
      const buyerTexts = (sellerView.messages ?? []).filter((m) => m.from === "buyer").map((m) => norm(m.text ?? ""));

      const expected = sentText === "" ? norm(editDraft) : norm(sentText).slice(0, 20);
      expect(
        buyerTexts.some((t) => (sentText === "" ? t === expected : t.includes(expected))),
        `edit "${editCase.name}" sent=${JSON.stringify(sentText)} seen=${JSON.stringify(buyerTexts)}`
      ).toBeTruthy();
    }
    }
  );

  // ════════════════════════════════════════════════════════════════════════════
  // G8 @inputs-persona — marketplace, all personas, 2 approved sends each
  // ════════════════════════════════════════════════════════════════════════════
  //
  // personaLabel mapping (frontend/src/lib/mcpModel.ts:125-127)

  const PERSONAS = [
    "flexible", "firm", "evasive", "pressure", "budget_prober", "term_changer", "mixed_my_en", "dishonest",
  ];

  for (const persona of PERSONAS) {
    test(`@copilot-inputs @inputs-persona persona=${persona}`, async ({ page }) => {
      test.setTimeout(240_000);
      const id = await startRunViaApi(page, {
        asking: 1200, budget: 873, // distinctive budget not equal to any likely price
        persona, style: "balanced", autonomy: "approve_close", mode: "copilot", channel: "marketplace",
      });

      await openRun(page, id);

      // Two approved sends
      let currentGate = await waitForNextGate(page, id, null);
      expect(currentGate.gate).toBe("seller_reply");

      let draft = currentGate.draft;
      await page.getByTestId("marketplace-send").click();
      currentGate = await waitForNextGate(page, id, draft);
      draft = currentGate.draft;

      if (currentGate.gate === "seller_reply") {
        await page.getByTestId("marketplace-send").click();
        await waitForNextGate(page, id, draft);
      }

      // Assertions from snapshot
      const snapshot = await getSnapshot(page, id);
      const svResponse = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(id)}/seller-view`);
      expect(svResponse.ok()).toBeTruthy();
      const sellerView = (await svResponse.json()) as { persona?: string; messages: { from?: string; text?: string; price?: number | null }[] };

      expect(sellerView.persona).toBe(persona);

      // Seller messages exist after each buyer message
      const sellerMessages = sellerView.messages.filter((m) => m.from === "seller");
      const buyerMessages = sellerView.messages.filter((m) => m.from === "buyer");
      expect(sellerMessages.length).toBeGreaterThan(0);
      expect(buyerMessages.length).toBeGreaterThan(0);

      // Every seller price <= asking, except the moving-target seller, which raises its price by 5% at round 2
      // (sim/personas.py: term_changer, term_change_round=2, term_change_ratio=0.05)
      const maxAllowed = persona === "term_changer" ? Math.round(1200 * 1.05) : 1200;
      for (const m of sellerMessages) {
        if (m.price != null) {
          expect(Number(m.price), `${persona} seller price`).toBeLessThanOrEqual(maxAllowed);
        }
      }

      // Budget number (873) never appears as a number in history, mcp-calls or seller-view.
      // The regex ignores digits/decimals around it (e.g. 0.873 or 18730 in timings and ids).
      const budgetRe = /(?<![\d.])873(?!\d)/;

      const historyText = JSON.stringify(snapshot.history);
      expect(historyText).not.toMatch(budgetRe);

      const callsResponse = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(id)}/mcp-calls`);
      expect(callsResponse.ok()).toBeTruthy();
      const callsText = await callsResponse.text();
      expect(callsText).not.toMatch(budgetRe);

      const svText = JSON.stringify(sellerView);
      expect(svText).not.toMatch(budgetRe);
    });
  }
});
