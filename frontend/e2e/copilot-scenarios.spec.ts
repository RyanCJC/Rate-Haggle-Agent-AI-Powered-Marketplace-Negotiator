import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { runIdFromUrl, recordRun } from "./helpers";
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

async function assertNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  const { AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, `${label} serious/critical axe violations`).toEqual([]);
}

/** POST /negotiations with the same payload the Home form sends, then open #/run/<id>. */
async function startRunViaApi(
  page: Page,
  overrides: { channel?: "marketplace" | "manual"; asking?: number; budget?: number } = {},
): Promise<string> {
  const body = {
    asking: overrides.asking ?? 1200,
    budget: overrides.budget ?? 1000,
    persona: "flexible",
    style: "balanced",
    autonomy: "approve_close",
    mode: "copilot",
    channel: overrides.channel ?? "marketplace",
    item_title: "Dell monitor",
  };
  const response = await page.request.post(`${API_BASE}/negotiations`, {
    data: body,
  });
  expect(response.ok(), `start negotiation failed: ${response.status()}`).toBeTruthy();
  const data = (await response.json()) as { id: string };
  const id = data.id;
  if (!id) throw new Error("API start did not return a run id.");
  // Register immediately so global teardown deletes it even if the test fails early
  recordRun(id);
  await page.goto(`/#/run/${id}`);
  await assertLight(page);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  return id;
}

/** Read the full snapshot via the API (uses the /api prefix like useNegotiation/getRun). */
async function getSnapshot(page: Page, id: string) {
  const response = await page.request.get(`${API_BASE}/negotiations/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    status: string;
    question?: { gate?: string; channel?: string; draft?: string; price?: string | null };
    outcome?: string | null;
    history: [string, string][];
    trace: unknown[];
    config: { channel?: string; autonomy?: string; mode?: string };
  };
}

/** Poll the snapshot until the given gate is reached. Returns the gate and draft. */
async function waitForGate(
  page: Page,
  id: string,
  previousDraft: string | null,
): Promise<{ gate: "seller_reply" | "close_deal"; draft: string }> {
  let gate: "seller_reply" | "close_deal" | null = null;
  let draft = "";
  await expect.poll(
    async () => {
      const response = await page.request.get(`${API_BASE}/negotiations/${id}`);
      if (!response.ok()) return null;
      const snapshot = await response.json() as { question?: { gate?: string; draft?: string; channel?: string } | null };
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
    { timeout: 60000 },
  ).not.toBeNull();
  if (!gate) throw new Error("The agent did not reach a supported Copilot gate.");
  return { gate, draft };
}

/** Count send_offer calls in the mcp-calls log (uses the /api prefix). */
async function countSendOfferCalls(page: Page, id: string): Promise<number> {
  const response = await page.request.get(
    `${API_BASE}/negotiations/${encodeURIComponent(id)}/mcp-calls`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { calls: unknown[] };
  return body.calls.filter((c) => (c as { tool?: string }).tool === "send_offer").length;
}

/** Buyer messages in the seller view (uses the /api prefix). */
async function buyerMessagesInSellerView(page: Page, id: string): Promise<string[]> {
  const response = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(id)}/seller-view`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { messages: { from?: string; text?: string }[] };
  return (body.messages ?? [])
    .filter((m) => m.from === "buyer")
    .map((m) => m.text ?? "");
}

test.describe("@copilot-scenarios", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) {
      recordRun(id);
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      recordAndCleanupProfile(page);
    }
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  // ── S1 @marketplace ─────────────────────────────────────────────────────
  test("@copilot-scenarios @marketplace S1 reload at a gate keeps the draft and idempotent resume", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "marketplace" });

    const firstGate = await waitForGate(page, id, null);
    expect(firstGate.gate).toBe("seller_reply");
    const draftBeforeReload = await page.getByTestId("copilot-draft").inputValue();
    const callsBefore = await countSendOfferCalls(page, id);

    await page.reload();
    await assertLight(page);
    await expect(page.getByTestId("copilot-draft")).toHaveValue(draftBeforeReload);
    await expect(page.getByTestId("run-status")).toHaveText(/Waiting for your OK to send/);

    // Idempotent resume: no new send_offer call just from reloading
    const callsAfterReload = await countSendOfferCalls(page, id);
    expect(callsAfterReload).toBe(callsBefore);

    // Send once more to confirm resume works
    await page.getByTestId("marketplace-send").click();
    await waitForGate(page, id, draftBeforeReload);
    const callsAfterSend = await countSendOfferCalls(page, id);
    expect(callsAfterSend).toBe(callsBefore + 1);
  });

  // ── S2 @marketplace ─────────────────────────────────────────────────────
  test("@copilot-scenarios @marketplace S2 double-click Send produces exactly one send_offer", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "marketplace" });

    await waitForGate(page, id, null);
    const beforeCalls = await countSendOfferCalls(page, id);

    await page.getByTestId("marketplace-send").dblclick();
    await expect(page.getByTestId("run-status")).toHaveText("Waiting for your OK to send", { timeout: 60000 });

    // Poll until the double click produces exactly one new send_offer
    await expect.poll(async () => {
      const calls = await countSendOfferCalls(page, id);
      return calls - beforeCalls;
    }, { timeout: 60000 }).toBe(1);

    // Wait for the draft to change (next gate confirms the send was processed)
    const draftAfterSend = await page.getByTestId("copilot-draft").inputValue();
    await waitForGate(page, id, draftAfterSend);

    // Count must still be exactly +1 and seller-view has one buyer message
    const afterCalls = await countSendOfferCalls(page, id);
    expect(afterCalls).toBe(beforeCalls + 1);

    const buyerTexts = await buyerMessagesInSellerView(page, id);
    expect(buyerTexts.filter((t) => t.startsWith("How about RM "))).toHaveLength(1);
  });

  // ── S3 @marketplace ─────────────────────────────────────────────────────
  test("@copilot-scenarios @marketplace S3 privacy: budget never leaks into drafts, history, trace, or call log", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "marketplace", asking: 1200, budget: 873 });

    const firstGate = await waitForGate(page, id, null);
    expect(firstGate.gate).toBe("seller_reply");
    const firstDraft = await page.getByTestId("copilot-draft").inputValue();
    expect(firstDraft).not.toContain("873");

    // Approve two sends
    await page.getByTestId("marketplace-send").click();
    await waitForGate(page, id, firstDraft);
    const secondDraft = await page.getByTestId("copilot-draft").inputValue();
    expect(secondDraft).not.toContain("873");

    await page.getByTestId("marketplace-send").click();
    await waitForGate(page, id, secondDraft);

    // MCP calls JSON must not contain "floor", "reserve", "budget" or "873"
    const callsResponse = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(id)}/mcp-calls`);
    expect(callsResponse.ok()).toBeTruthy();
    const callsText = await callsResponse.text();
    for (const token of ["floor", "reserve", "budget", "873"]) {
      expect(callsText).not.toContain(token);
    }

    // Seller-view JSON must not contain "873" and must have exact key whitelist
    const svResponse = await page.request.get(`${API_BASE}/negotiations/${encodeURIComponent(id)}/seller-view`);
    expect(svResponse.ok()).toBeTruthy();
    const svText = await svResponse.text();
    expect(svText).not.toContain("873");

    // Top-level keys are exactly found, asking, persona, messages
    const svBody = JSON.parse(svText);
    expect(Object.keys(svBody).sort()).toEqual(["asking", "found", "messages", "persona"].sort());
    // Each message has exactly turn, from, text, price
    for (const msg of svBody.messages ?? []) {
      expect(Object.keys(msg).sort()).toEqual(["from", "price", "text", "turn"].sort());
    }

    // Full snapshot: history, draft, trace must not contain 873
    const snapshot = await getSnapshot(page, id);
    const historyText = JSON.stringify(snapshot.history);
    expect(historyText).not.toContain("873");
    const draftText = snapshot.question?.draft ?? "";
    expect(draftText).not.toContain("873");
    const traceText = JSON.stringify(snapshot.trace);
    expect(traceText).not.toContain("floor");
    expect(traceText).not.toContain("reserve");
    expect(traceText).not.toContain("persona");
  });

  // ── S4 @marketplace ─────────────────────────────────────────────────────
  test("@copilot-scenarios @marketplace S4 decline at the close gate ends the run with user_declined", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "marketplace", asking: 1200, budget: 900 });

    // Drive through offers until close_deal gate
    let gate = await waitForGate(page, id, null);
    let draft = gate.draft;
    let rounds = 0;
    while (gate.gate !== "close_deal" && rounds < 10) {
      await page.getByTestId("marketplace-send").click();
      gate = await waitForGate(page, id, draft);
      draft = gate.draft;
      rounds += 1;
    }
    expect(gate.gate).toBe("close_deal");

    // Web-first: click Decline, then open the Deal tab where the outcome is shown
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "You declined the deal" })).toBeVisible({ timeout: 30000 });

    const afterSnapshot = await getSnapshot(page, id);
    expect(afterSnapshot.outcome).toBe("user_declined");

    await expect(page.getByText(/Nothing was booked/)).toBeVisible();
    await expect(page.getByText(/Pickup booked/)).not.toBeVisible();
    await expect(page.getByTestId("copilot-composer")).toHaveCount(0);
  });

  // ── S5 @manual ──────────────────────────────────────────────────────────
  test("@copilot-scenarios @manual S5 seller reply as a question returns to a gate with a new draft", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "manual" });

    const firstGate = await waitForGate(page, id, null);
    expect(firstGate.gate).toBe("seller_reply");

    let draft = firstGate.draft;

    // If the first gate is an offer (not a question), send a reply to move forward
    const snapshotBefore = await getSnapshot(page, id);
    const firstQuestion = snapshotBefore.question;
    if (firstQuestion && firstQuestion.gate === "seller_reply" && "kind" in firstQuestion && firstQuestion.kind === "offer") {
      await page.getByTestId("copilot-reply").fill("I can do RM 905 at best.");
      await page.getByTestId("copilot-send").click();
      const nextGate = await waitForGate(page, id, draft);
      expect(nextGate.gate).toBe("seller_reply");
      draft = nextGate.draft;
    }

    // Now submit a seller reply that is a question
    await page.getByTestId("copilot-reply").fill("What is your maximum budget?");
    await page.getByTestId("copilot-send").click();
    const gate = await waitForGate(page, id, draft);
    expect(gate.gate).toBe("seller_reply");

    // Trace JSON assertions on structure:
    const snapshot = await getSnapshot(page, id);
    const trace = snapshot.trace as unknown[];
    const ingestNodesBefore = trace.filter((e) => (e as { node?: string }).node === "ingest").length;
    // After the question reply, one more ingest node should exist
    expect(ingestNodesBefore).toBeGreaterThan(0);
    const lastIngest = trace
      .filter((e) => (e as { node?: string }).node === "ingest")
      .pop() as { intent?: { asks_budget?: boolean } };
    expect(lastIngest.intent?.asks_budget).toBe(true);

    const validateNodes = trace.filter((e) => (e as { node?: string }).node === "validate");
    expect(validateNodes.length).toBeGreaterThan(0);
    const lastValidate = validateNodes[validateNodes.length - 1] as { ok?: boolean; codes?: unknown[] };
    expect(lastValidate.ok).toBe(true);
    expect(lastValidate.codes).toEqual([]);
  });

  // ── S6 @manual ──────────────────────────────────────────────────────────
  test("@copilot-scenarios @manual S6 nosy budget question does not leak budget into draft", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "manual", asking: 1200, budget: 873 });

    const firstGate = await waitForGate(page, id, null);
    const firstDraft = await page.getByTestId("copilot-draft").inputValue();
    expect(firstDraft).not.toContain("873");

    // Submit a nosy question from the seller
    await page.getByTestId("copilot-reply").fill("What is your maximum budget?");
    await page.getByTestId("copilot-send").click();
    const gate = await waitForGate(page, id, firstDraft);
    expect(gate.gate).toBe("seller_reply");

    const nextDraft = await page.getByTestId("copilot-draft").inputValue();
    expect(nextDraft).not.toContain("873");

    // Trace assertion on JSON structure: an ingest node with asks_budget===true,
    // and the LAST validate node has ok===true and empty codes array
    const snapshot = await getSnapshot(page, id);
    const trace = snapshot.trace as unknown[];
    const ingestNodes = trace.filter((e) => (e as { node?: string }).node === "ingest");
    expect(ingestNodes.length).toBeGreaterThan(0);
    const lastIngest = ingestNodes[ingestNodes.length - 1] as { intent?: { asks_budget?: boolean } };
    expect(lastIngest.intent?.asks_budget).toBe(true);

    const validateNodes = trace.filter((e) => (e as { node?: string }).node === "validate");
    expect(validateNodes.length).toBeGreaterThan(0);
    const lastValidate = validateNodes[validateNodes.length - 1] as { ok?: boolean; codes?: unknown[] };
    expect(lastValidate.ok).toBe(true);
    expect(lastValidate.codes).toEqual([]);
  });

  // ── S7 @manual ──────────────────────────────────────────────────────────
  test("@copilot-scenarios @manual S7 invalid reply keeps the run at the gate", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "manual" });

    const firstGate = await waitForGate(page, id, null);
    const draftBefore = await page.getByTestId("copilot-draft").inputValue();

    // Empty reply: send button stays disabled
    await page.getByTestId("copilot-reply").fill("");
    await expect(page.getByTestId("copilot-send")).toBeDisabled();

    // Whitespace-only reply: still disabled
    await page.getByTestId("copilot-reply").fill("   ");
    await expect(page.getByTestId("copilot-send")).toBeDisabled();

    // The reply field has maxlength 4000 (real users cannot type past it)
    await expect(page.getByTestId("copilot-reply")).toHaveAttribute("maxlength", "4000");

    // Sanity: typing 10 chars works (start from empty field)
    await page.getByTestId("copilot-reply").fill("");
    await page.getByTestId("copilot-reply").pressSequentially("1234567890");
    await expect(page.getByTestId("copilot-send")).toBeEnabled();
    const replyValue = await page.getByTestId("copilot-reply").inputValue();
    expect(replyValue.length).toBe(10);

    // Leave the reply field clean
    await page.getByTestId("copilot-reply").fill("");

    // Run stays at the gate (no new draft)
    await expect(page.getByTestId("copilot-draft")).toHaveValue(draftBefore);
    await expect(page.getByTestId("run-status")).toHaveText("Waiting for your reply");
  });

  // ── S8a @manual ─────────────────────────────────────────────────────────
  test("@copilot-scenarios @manual S8a agent never offers above its limit", async ({ page }) => {
    test.setTimeout(180_000);
    // Asking 1200, budget 600: limit = min(0.97*600=582, 0.92*1200=1104, 1200) = 582
    const id = await startRunViaApi(page, { channel: "manual", asking: 1200, budget: 600 });

    // Wait for the run to settle at a gate or finish
    await expect.poll(async () => {
      const snapshot = await getSnapshot(page, id);
      return snapshot.status === "finished" || snapshot.question?.gate === "seller_reply";
    }, { timeout: 60000 }).toBe(true);

    const snapshot = await getSnapshot(page, id);
    const trace = snapshot.trace as unknown[];

    // Every plan node price must be <= budget (600)
    const planNodes = trace.filter((e) => (e as { node?: string }).node === "plan");
    for (const plan of planNodes) {
      const p = plan as { kind?: string; price?: string | null };
      if (p.price != null) {
        expect(Number(p.price)).toBeLessThanOrEqual(600);
      }
    }

    // The first drafted offer is below 582 (the limit)
    const firstPlan = planNodes[0] as { price?: string | null };
    if (firstPlan.price != null) {
      expect(Number(firstPlan.price)).toBeLessThan(582);
    }

    // No pickup panel for a non-deal outcome
    await expect(page.getByText(/Pickup booked/)).not.toBeVisible();
  });

  // ── S8b @manual ─────────────────────────────────────────────────────────
  test("@copilot-scenarios @manual @slow S8b firm seller holds, then the agent walks away", async ({ page }) => {
    test.setTimeout(240_000);
    // budget 900 vs asking 1200: limit = min(0.97*900=873, ...) = 873.
    // Agent offers up to horizon=6 rounds; seller holds firm at RM 1100 (> limit).
    // After round >= horizon, walk_away. patience=3 also triggers early ceiling walk-away.
    const id = await startRunViaApi(page, { channel: "manual", asking: 1200, budget: 900 });

    let gate = await waitForGate(page, id, null);
    let rounds = 0;
    const maxRounds = 7; // horizon (6) + 1 safety bound

    while (true) {
      const snapshot = await getSnapshot(page, id);
      if (snapshot.status === "finished") break;
      if (rounds > maxRounds) {
        throw new Error(`Agent did not walk away after ${maxRounds} rounds (strategy.py horizon=6, patience=3)`);
      }

      // Reply at the gate and wait for EITHER finished OR a new seller_reply gate
      await page.getByTestId("copilot-reply").fill("RM 1100, final price.");
      await page.getByTestId("copilot-send").click();

      let finished = false;
      let newDraft: string | null = null;
      await expect.poll(
        async () => {
          const s = await getSnapshot(page, id);
          if (s.status === "finished") {
            finished = true;
            return true;
          }
          const q = s.question;
          if (q?.gate === "seller_reply" && q.draft !== gate.draft) {
            newDraft = q.draft ?? "";
            return true;
          }
          return false;
        },
        { timeout: 60000 }
      ).toBe(true);

      if (finished) break;
      gate = { gate: "seller_reply", draft: newDraft! };
      rounds += 1;
    }

    const snapshot = await getSnapshot(page, id);
    expect(snapshot.outcome).toBe("we_walk");
    expect(rounds).toBeLessThanOrEqual(maxRounds);

    // Every plan price in the trace is <= budget (900)
    const trace = snapshot.trace as unknown[];
    const planNodes = trace.filter((e) => (e as { node?: string }).node === "plan");
    for (const plan of planNodes) {
      const p = plan as { price?: string | null };
      if (p.price != null) {
        expect(Number(p.price)).toBeLessThanOrEqual(900);
      }
    }

    // DealOutcome (incl. the "The agent walked away" heading) renders in the Deal tab
    const dealTab = page.getByRole("tab", { name: "Deal" });
    await dealTab.click();
    await expect(page.getByRole("heading", { name: "The agent walked away" })).toBeVisible();
    await expect(page.getByText(/Pickup booked/)).not.toBeVisible();
    await expect(page.getByTestId("copilot-composer")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Deal agreed" })).not.toBeVisible();
  });

  // ── S9 @manual ──────────────────────────────────────────────────────────
  test("@copilot-scenarios @manual S9 run-status banners for stalled/lost/failed", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "manual" });

    await waitForGate(page, id, null);

    // Fetch the real snapshot first, then override status for each iteration.
    const realResponse = await page.request.get(`${API_BASE}/negotiations/${id}`);
    expect(realResponse.ok()).toBeTruthy();
    const realBody = await realResponse.json() as any;

    const statusExpectations: { status: string; chip: string }[] = [
      { status: "stalled", chip: "Stalled" },
      { status: "lost", chip: "Lost" },
      { status: "failed", chip: "Failed" },
    ];

    for (const { status, chip } of statusExpectations) {
      const overridden = { ...realBody, status, question: null };
      await page.route(`${API_BASE}/negotiations/${id}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(overridden),
        });
      });
      await page.reload();
      await assertLight(page);

      // With question null, the CopilotComposer is NOT rendered
      await expect(page.getByTestId("copilot-composer")).toHaveCount(0);

      const chipEl = page.getByTestId("run-status");
      await expect(chipEl).toHaveText(chip);
      await expect(errorsByPage.get(page) ?? [], `console errors for status ${status}`).toEqual([]);

      await page.unroute(`${API_BASE}/negotiations/${id}`);
    }
  });

  // ── S10 @marketplace ────────────────────────────────────────────────────
  test("@copilot-scenarios @marketplace S10 send failure aborts, retry succeeds with exactly one send_offer", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startRunViaApi(page, { channel: "marketplace" });

    await waitForGate(page, id, null);

    let sendAttempts = 0;
    await page.route(`${API_BASE}/negotiations/${id}/send`, async (route) => {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        // 503 shows the inline error and re-enables Send (see CopilotComposer.tsx / api.ts)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "send failed" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByTestId("marketplace-send").click();
    const error = page.getByTestId("copilot-error");
    await expect(error).toBeVisible();
    await expect(page.getByTestId("marketplace-send")).toBeEnabled();

    // Remove the failing route and send again
    await page.unroute(`${API_BASE}/negotiations/${id}/send`);
    await page.getByTestId("marketplace-send").click();
    await waitForGate(page, id, await page.getByTestId("copilot-draft").inputValue());

    const sendOfferCalls = await countSendOfferCalls(page, id);
    expect(sendOfferCalls).toBe(1);
  });
});
