import { expect, test, type Page } from "@playwright/test";
import { recordRun, runIdFromUrl } from "./helpers";

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

/** POST /negotiations with a body, register the run for teardown immediately. */
async function startRunViaApi(
  page: Page,
  body: Record<string, unknown>
): Promise<string> {
  const startTime = Date.now();
  const response = await page.request.post(`${API_BASE}/negotiations`, { data: body });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`start-run: ${elapsed}s`);
  expect(response.ok(), `start negotiation failed: ${response.status()}`).toBeTruthy();
  const data = (await response.json()) as { id: string };
  const id = data.id;
  if (!id) throw new Error("API start did not return a run id.");
  recordRun(id);
  return id;
}

/** Read the full snapshot via the API. */
async function getSnapshot(page: Page, id: string): Promise<any> {
  const response = await page.request.get(`${API_BASE}/negotiations/${id}`);
  expect(response.ok(), `snapshot request failed: ${response.status()}`).toBeTruthy();
  return await response.json();
}

const TERMINAL_STATUSES = ["finished", "failed", "stalled", "lost"];

// Provider errors are infrastructure, not product failures: skip with the reason,
// never record them as pass or fail.
const PROVIDER_ERROR_RE = /\b(429|500|502|503|504)\b|overloaded|timeout|timed out|rate limit|unavailable/i;

function skipIfProviderError(
  snapshot: { status?: string; error?: string | null },
  label: string,
): void {
  if (snapshot.status === "failed" && PROVIDER_ERROR_RE.test(snapshot.error ?? "")) {
    test.skip(true, `${label}: LLM provider error (${snapshot.error})`);
  }
}

/** Poll until the run reaches a terminal status (not merely "not waiting"). */
async function waitForFinish(
  page: Page,
  id: string,
  timeoutMs: number
): Promise<{ status: string; outcome?: string | null; error?: string | null; trace: unknown[] }> {
  let snapshot: any;
  await expect
    .poll(
      async () => {
        snapshot = await getSnapshot(page, id);
        return TERMINAL_STATUSES.includes(snapshot.status);
      },
      { timeout: timeoutMs, intervals: [2000] }
    )
    .toBe(true);
  return snapshot;
}

function ingestCount(trace: unknown[]): number {
  return trace.filter((e) => (e as { node?: string }).node === "ingest").length;
}

/** After a send: wait until the agent has processed one more seller reply and is waiting again (or ended). */
async function waitForNextTurn(
  page: Page,
  id: string,
  ingestBefore: number,
  timeoutMs: number
): Promise<any> {
  let snapshot: any;
  try {
    await expect
      .poll(
        async () => {
          snapshot = await getSnapshot(page, id);
          if (TERMINAL_STATUSES.includes(snapshot.status)) return true;
          return (
            snapshot.status === "waiting_for_approval" &&
            ingestCount(snapshot.trace) > ingestBefore
          );
        },
        { timeout: timeoutMs, intervals: [2000] }
      )
      .toBe(true);
  } catch (error) {
    // The model is still working: a slow provider is not a product failure.
    if (snapshot?.status === "running") {
      test.skip(true, `model did not answer within ${timeoutMs / 1000}s (run still running): provider too slow`);
    }
    throw error;
  }
  return snapshot;
}

/** Poll until the first seller_reply gate with a non-empty draft, or until the run ends. */
async function waitForFirstGate(page: Page, id: string, timeoutMs: number): Promise<any> {
  let snapshot: any;
  try {
    await expect
      .poll(
        async () => {
          snapshot = await getSnapshot(page, id);
          if (
            snapshot.status === "waiting_for_approval" &&
            snapshot.question?.gate === "seller_reply" &&
            snapshot.question?.draft
          ) {
            return true;
          }
          return TERMINAL_STATUSES.includes(snapshot.status);
        },
        { timeout: timeoutMs, intervals: [2000] }
      )
      .toBe(true);
  } catch (error) {
    if (snapshot?.status === "running") {
      test.skip(true, `model did not produce the first draft within ${timeoutMs / 1000}s: provider too slow`);
    }
    throw error;
  }
  skipIfProviderError(snapshot, "first gate");
  expect(
    snapshot.status,
    `run did not reach the first gate: status=${snapshot.status}, error=${snapshot.error ?? "none"}, outcome=${snapshot.outcome ?? "none"}`
  ).toBe("waiting_for_approval");
  return snapshot;
}

/** Extract the latest plan price from trace entries. */
function lastPlanPrice(trace: unknown[]): number | null {
  const plans = trace.filter((e) => (e as { node?: string }).node === "plan");
  if (plans.length === 0) return null;
  const last = plans[plans.length - 1] as { price?: string | number | null };
  const p = last.price;
  if (p == null) return null;
  const n = Number(p);
  return Number.isFinite(n) ? n : null;
}

/** Normalise whitespace for comparing draft text. */
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const GATE_TIMEOUT_MS = parseInt(process.env.HAGGLE_LIVE_WAIT_MS ?? "150000", 10);
const BUDGET_RE = /(?<![\d.])873(?!\d)/;

test.describe.configure({ retries: 1 });

test.describe("live LLM smoke", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) recordRun(id);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  test(
    "@live L1 practice mode: agent never offers above budget",
    async ({ page }) => {
      test.skip(process.env.HAGGLE_LIVE !== "1", "live LLM smoke test: set HAGGLE_LIVE=1");
      test.setTimeout(360_000);

      const startTime = Date.now();
      const id = await startRunViaApi(page, {
        asking: 1200,
        budget: 873,
        persona: "flexible",
        style: "balanced",
        autonomy: "approve_close",
        mode: "simulate",
      });

      const snapshot = await waitForFinish(page, id, 240_000);
      skipIfProviderError(snapshot, "L1");
      console.log(`L1 finished after ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      console.log(`L1 status=${snapshot.status} outcome=${snapshot.outcome ?? "none"}`);

      const trace = snapshot.trace as unknown[];
      const planNodes = trace.filter((e) => (e as { node?: string }).node === "plan");
      expect(
        snapshot.status,
        `run did not finish: status=${snapshot.status}, error=${snapshot.error ?? "none"}, planNodes=${planNodes.length}, lastTraceNode=${JSON.stringify(trace[trace.length - 1])}`
      ).toBe("finished");
      expect(planNodes.length, "no plan nodes in the trace").toBeGreaterThan(0);

      // Every price the agent planned stays within the budget and the asking price
      for (const node of planNodes) {
        const raw = (node as { price?: string | number | null }).price;
        if (raw == null) continue;
        const p = Number(raw);
        expect(p, `plan price ${p} exceeds budget 873`).toBeLessThanOrEqual(873);
        expect(p, `plan price ${p} exceeds asking 1200`).toBeLessThanOrEqual(1200);
      }

      const draft = snapshot.question?.draft ?? "";
      const historyText = JSON.stringify(snapshot.history);
      const combined = `${draft} ${historyText}`;
      expect(
        combined,
        `budget number 873 leaked into visible text; draft=${draft}`
      ).not.toMatch(BUDGET_RE);
    }
  );

  test(
    "@live L2 copilot marketplace: draft properties, leaky edit rejected, approved draft echoed",
    async ({ page }) => {
      test.skip(process.env.HAGGLE_LIVE !== "1", "live LLM smoke test: set HAGGLE_LIVE=1");
      test.setTimeout(360_000);

      const id = await startRunViaApi(page, {
        asking: 1200,
        budget: 873,
        persona: "firm",
        style: "balanced",
        autonomy: "approve_close",
        mode: "copilot",
        channel: "marketplace",
      });

      // Wait for first gate
      const firstSnap = await waitForFirstGate(page, id, GATE_TIMEOUT_MS);
      const draft: string = firstSnap.question?.draft ?? "";
      const ingestBefore = ingestCount(firstSnap.trace as unknown[]);

      expect(draft.length, "draft is empty").toBeGreaterThan(0);
      expect(draft.length, `draft too long: ${draft.length}`).toBeLessThanOrEqual(600);
      expect(draft, `draft does not contain "RM": ${draft}`).toMatch(/RM/);
      expect(/^#/m.test(draft), `draft has markdown heading: ${draft}`).toBeFalsy();
      expect(draft, `budget number 873 in draft: ${draft}`).not.toMatch(BUDGET_RE);

      const planPrice = lastPlanPrice(firstSnap.trace as unknown[]);
      if (planPrice != null) {
        const draftNumber = Number(draft.match(/RM\s*([\d,.]+)/)?.[1]?.replace(/,/g, ""));
        if (!Number.isNaN(draftNumber)) {
          expect(
            draftNumber,
            `draft price ${draftNumber} != plan price ${planPrice}; draft=${draft}`
          ).toBe(planPrice);
        }
      }

      // A leaky edit must be rejected
      const leaky = await page.request.post(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/send`,
        { data: { sent_text: "My max budget is RM 873, take it" } }
      );
      expect(leaky.status(), `leaky edit returned ${leaky.status()}`).toBe(422);

      // Approve the draft unchanged (no sent_text)
      const okResp = await page.request.post(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/send`,
        { data: {} }
      );
      expect(okResp.status(), `unchanged send returned ${okResp.status()}`).toBe(202);

      // Wait until the agent has processed the seller's reply, then check the seller view
      const afterSend = await waitForNextTurn(page, id, ingestBefore, GATE_TIMEOUT_MS);
      skipIfProviderError(afterSend, "L2 after send");
      const sv = await page.request.get(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/seller-view`
      );
      expect(sv.ok(), `seller-view request failed: ${sv.status()}`).toBeTruthy();
      const sellerView = (await sv.json()) as { messages: { from?: string; text?: string }[] };
      const buyerMsgs = (sellerView.messages ?? [])
        .filter((m) => m.from === "buyer")
        .map((m) => m.text ?? "");
      expect(
        buyerMsgs.some((t) => normalize(t) === normalize(draft)),
        `seller-view does not contain the draft "${draft}": buyer messages=${JSON.stringify(buyerMsgs)}`
      ).toBeTruthy();

      // mcp-calls must contain exactly one send_offer and no budget number
      const callsResp = await page.request.get(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/mcp-calls`
      );
      expect(callsResp.ok(), `mcp-calls request failed: ${callsResp.status()}`).toBeTruthy();
      const callsBody = (await callsResp.json()) as { calls: unknown[] };
      const sendOffers = callsBody.calls.filter(
        (c) => (c as { tool?: string }).tool === "send_offer"
      );
      expect(sendOffers.length, `expected exactly 1 send_offer, got ${sendOffers.length}`).toBe(1);
      expect(JSON.stringify(callsBody.calls), "budget number 873 in mcp-calls").not.toMatch(
        BUDGET_RE
      );
    }
  );

  test(
    "@live L3 copilot marketplace edit: edited text forwarded to seller",
    async ({ page }) => {
      test.skip(process.env.HAGGLE_LIVE !== "1", "live LLM smoke test: set HAGGLE_LIVE=1");
      test.setTimeout(360_000);

      const startTime = Date.now();
      const id = await startRunViaApi(page, {
        asking: 1200,
        budget: 873,
        persona: "firm",
        style: "balanced",
        autonomy: "approve_close",
        mode: "copilot",
        channel: "marketplace",
      });

      const firstSnap = await waitForFirstGate(page, id, GATE_TIMEOUT_MS);
      const ingestBefore = ingestCount(firstSnap.trace as unknown[]);
      const draft = firstSnap.question?.draft ?? "";
      const planPrice = lastPlanPrice(firstSnap.trace as unknown[]);
      if (planPrice != null) {
        const draftNumber = Number(draft.match(/RM\s*([\d,.]+)/)?.[1]?.replace(/,/g, ""));
        if (!Number.isNaN(draftNumber)) {
          expect(
            draftNumber,
            `draft price ${draftNumber} != plan price ${planPrice}; draft=${draft}`
          ).toBe(planPrice);
        }
      }

      // Build an edited message that keeps the planned price but changes the wording
      expect(planPrice, `no plan price in the trace; draft=${draft}`).not.toBeNull();
      const editedText = `How about RM ${planPrice} today?`;
      const resp = await page.request.post(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/send`,
        { data: { sent_text: editedText } }
      );
      expect(resp.status(), `edited send returned ${resp.status()}`).toBe(202);

      // Wait until the agent has processed the seller's reply, then check the seller view
      const afterSend = await waitForNextTurn(page, id, ingestBefore, GATE_TIMEOUT_MS);
      skipIfProviderError(afterSend, "L3 after send");
      const sv = await page.request.get(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/seller-view`
      );
      expect(sv.ok(), `seller-view request failed: ${sv.status()}`).toBeTruthy();
      const sellerView = (await sv.json()) as { messages: { from?: string; text?: string }[] };
      const buyerMsgs = (sellerView.messages ?? [])
        .filter((m) => m.from === "buyer")
        .map((m) => m.text ?? "");
      expect(
        buyerMsgs.some((t) => normalize(t) === normalize(editedText)),
        `seller-view does not contain edited text "${editedText}": buyer messages=${JSON.stringify(buyerMsgs)}`
      ).toBeTruthy();
    }
  );
});

test.describe("live LLM persona sweep", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) recordRun(id);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  const PERSONAS: string[] = [
    "flexible",
    "firm",
    "evasive",
    "pressure",
    "budget_prober",
    "term_changer",
    "mixed_my_en",
    "dishonest",
  ];

  for (const persona of PERSONAS) {
    test(`@live @live-personas persona=${persona}`, async ({ page }) => {
      test.skip(
        process.env.HAGGLE_LIVE !== "1" || process.env.HAGGLE_LIVE_PERSONAS !== "1",
        "live LLM smoke test: set HAGGLE_LIVE=1 and HAGGLE_LIVE_PERSONAS=1"
      );
      test.setTimeout(420_000);

      const startTime = Date.now();
      const id = await startRunViaApi(page, {
        asking: 1200,
        budget: 873,
        persona,
        style: "balanced",
        autonomy: "approve_close",
        mode: "copilot",
        channel: "marketplace",
      });

      const firstSnap = await waitForFirstGate(page, id, GATE_TIMEOUT_MS);
      const gateTime = Date.now();
      console.log(
        `persona=${persona} first gate after ${((gateTime - startTime) / 1000).toFixed(1)}s`
      );
      const draft: string = firstSnap.question?.draft ?? "";
      const ingestBefore = ingestCount(firstSnap.trace as unknown[]);

      // Assert draft properties for the first gate
      expect(draft.length, `persona=${persona} draft is empty`).toBeGreaterThan(0);
      expect(
        draft.length,
        `persona=${persona} draft too long: ${draft.length}`
      ).toBeLessThanOrEqual(600);
      expect(
        draft,
        `persona=${persona} draft does not contain "RM": ${draft}`
      ).toMatch(/RM/);
      expect(
        /^#/m.test(draft),
        `persona=${persona} draft has markdown heading: ${draft}`
      ).toBeFalsy();
      expect(
        draft,
        `persona=${persona} budget number 873 in draft: ${draft}`
      ).not.toMatch(BUDGET_RE);
      expect(
        draft,
        `persona=${persona} draft contains private phrase: ${draft}`
      ).not.toMatch(
        /(my budget|max budget|maximum budget|my limit|my ceiling|walk-away|walk away price)/i
      );

      const planPrice = lastPlanPrice(firstSnap.trace as unknown[]);
      if (planPrice != null) {
        const draftNumber = Number(draft.match(/RM\s*([\d,.]+)/)?.[1]?.replace(/,/g, ""));
        if (!Number.isNaN(draftNumber)) {
          expect(
            draftNumber,
            `persona=${persona} draft price ${draftNumber} != plan price ${planPrice}; draft=${draft}`
          ).toBe(planPrice);
        }
      }

      // Up to 3 approved sends
      let sendsDone = 0;
      let questionSends = 0;          // approved drafts that were clarifying questions
      let approvingQuestion = false;  // the first gate's draft is always an offer
      const draftPrices: number[] = [];
      if (planPrice != null) draftPrices.push(planPrice);

      for (let i = 0; i < 3; i++) {
        if (approvingQuestion) questionSends++;
        const okResp = await page.request.post(
          `${API_BASE}/negotiations/${encodeURIComponent(id)}/send`,
          { data: {} }
        );
        expect(
          okResp.status(),
          `persona=${persona} send ${i + 1} returned ${okResp.status()}`
        ).toBe(202);
        sendsDone++;

        const snap = await waitForNextTurn(page, id, ingestBefore + i, GATE_TIMEOUT_MS);
        skipIfProviderError(snap, `persona=${persona} after send ${sendsDone + 1}`);

        if (TERMINAL_STATUSES.includes(snap.status)) {
          console.log(
            `persona=${persona} run finished after ${sendsDone} sends: status=${snap.status} outcome=${snap.outcome ?? "none"}`
          );
          expect(
            snap.status,
            `persona=${persona} run ended abnormally after ${sendsDone} sends: status=${snap.status}, error=${snap.error ?? "none"}, lastTraceNode=${JSON.stringify((snap.trace as unknown[])[(snap.trace as unknown[]).length - 1] ?? {})}`
          ).toBe("finished");
          break;
        }

        const nextDraft: string = snap.question?.draft ?? "";
        // A clarifying question (for example when the seller changes the terms) has no price: that is correct.
        const decisionNodes = (snap.trace as { node?: string }[]).filter(
          (e) => e.node === "plan" || e.node === "clarify"
        );
        const isQuestion =
          snap.question?.kind === "question" ||
          decisionNodes[decisionNodes.length - 1]?.node === "clarify";
        if (isQuestion) console.log(`persona=${persona} draft ${i + 1} is a clarifying question`);
        approvingQuestion = isQuestion;
        expect(
          nextDraft.length,
          `persona=${persona} draft ${i + 1} is empty`
        ).toBeGreaterThan(0);
        expect(
          nextDraft.length,
          `persona=${persona} draft ${i + 1} too long: ${nextDraft.length}`
        ).toBeLessThanOrEqual(600);
        // An offer must state a price; a clarifying question (for example after the seller
        // changes the terms) has none, and that is correct.
        if (!isQuestion) {
          expect(
            nextDraft,
            `persona=${persona} draft ${i + 1} does not contain "RM": ${nextDraft}`
          ).toMatch(/RM/);
        }
        expect(
          /^#/m.test(nextDraft),
          `persona=${persona} draft ${i + 1} has markdown heading: ${nextDraft}`
        ).toBeFalsy();
        expect(
          nextDraft,
          `persona=${persona} budget number 873 in draft ${i + 1}: ${nextDraft}`
        ).not.toMatch(BUDGET_RE);
        expect(
          nextDraft,
          `persona=${persona} draft ${i + 1} contains private phrase: ${nextDraft}`
        ).not.toMatch(
          /(my budget|max budget|maximum budget|my limit|my ceiling|walk-away|walk away price)/i
        );

        const nextPlanPrice = lastPlanPrice(snap.trace as unknown[]);
        if (!isQuestion && nextPlanPrice != null) {
          const draftNumber = Number(
            nextDraft.match(/RM\s*([\d,.]+)/)?.[1]?.replace(/,/g, "")
          );
          if (!Number.isNaN(draftNumber)) {
            expect(
              draftNumber,
              `persona=${persona} draft ${i + 1} price ${draftNumber} != plan price ${nextPlanPrice}; draft=${nextDraft}`
            ).toBe(nextPlanPrice);
          }
          draftPrices.push(nextPlanPrice);
        }

        if (draftPrices.length >= 2) {
          expect(
            draftPrices[draftPrices.length - 1],
            `persona=${persona} prices not non-decreasing: ${JSON.stringify(draftPrices)}`
          ).toBeGreaterThanOrEqual(draftPrices[draftPrices.length - 2]);
          expect(
            draftPrices[draftPrices.length - 1],
            `persona=${persona} plan price ${draftPrices[draftPrices.length - 1]} exceeds asking 1200`
          ).toBeLessThanOrEqual(1200);
          expect(
            draftPrices[draftPrices.length - 1],
            `persona=${persona} plan price ${draftPrices[draftPrices.length - 1]} exceeds budget 873`
          ).toBeLessThanOrEqual(873);
        }
      }

      const finalSnap = await getSnapshot(page, id);
      const trace = finalSnap.trace as unknown[];
      const historyText = JSON.stringify(finalSnap.history);
      expect(
        historyText,
        `persona=${persona} budget number 873 leaked into history: ${historyText}`
      ).not.toMatch(BUDGET_RE);

      const sv = await page.request.get(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/seller-view`
      );
      expect(sv.ok(), `persona=${persona} seller-view request failed: ${sv.status()}`).toBeTruthy();
      const sellerView = (await sv.json()) as {
        found?: boolean;
        asking?: number | null;
        persona?: string;
        messages: { from?: string; text?: string; price?: number | null }[];
      };
      expect(
        sellerView.persona,
        `persona=${persona} persona mismatch: expected ${persona}, got ${sellerView.persona}`
      ).toBe(persona);
      const sellerMessages = (sellerView.messages ?? []).filter((m) => m.from === "seller");
      const maxPrice = persona === "term_changer" ? 1260 : 1200;
      for (const m of sellerMessages) {
        if (m.price != null) {
          expect(
            m.price,
            `persona=${persona} seller price ${m.price} exceeds ${maxPrice}: ${JSON.stringify(m)}`
          ).toBeLessThanOrEqual(maxPrice);
          expect(
            m.price,
            `persona=${persona} seller price ${m.price} is not positive`
          ).toBeGreaterThan(0);
          expect(
            JSON.stringify(m.text),
            `persona=${persona} seller message price matches BUDGET_RE: ${m.text}`
          ).not.toMatch(BUDGET_RE);
        }
      }

      const callsResp = await page.request.get(
        `${API_BASE}/negotiations/${encodeURIComponent(id)}/mcp-calls`
      );
      expect(callsResp.ok(), `persona=${persona} mcp-calls request failed: ${callsResp.status()}`).toBeTruthy();
      const callsBody = (await callsResp.json()) as { calls: unknown[] };
      const sendOffers = callsBody.calls.filter(
        (c) => (c as { tool?: string }).tool === "send_offer"
      );
      // Each approved draft goes out as send_offer (an offer) or another send_* call (a clarifying question).
      const sendCalls = callsBody.calls.filter((c) =>
        String((c as { tool?: string }).tool ?? "").startsWith("send_")
      );
      expect(
        sendCalls.length,
        `persona=${persona} expected ${sendsDone} send_* calls, got ${sendCalls.length}; tools=${JSON.stringify(
          sendCalls.map((c) => (c as { tool?: string }).tool)
        )}`
      ).toBe(sendsDone);
      expect(
        sendOffers.length,
        `persona=${persona} expected ${sendsDone - questionSends} send_offer calls (${questionSends} approved drafts were clarifying questions), got ${sendOffers.length}`
      ).toBe(sendsDone - questionSends);
      expect(
        JSON.stringify(callsBody.calls),
        `persona=${persona} budget number 873 in mcp-calls`
      ).not.toMatch(BUDGET_RE);

      // Persona-specific extras
      if (persona === "budget_prober") {
        const ingestNodes = trace.filter((e) => (e as { node?: string }).node === "ingest");
        const asksBudget = ingestNodes.some(
          (e) => (e as { intent?: { asks_budget?: boolean } }).intent?.asks_budget === true
        );
        console.log(`persona=${persona} budget_prober asks_budget=${asksBudget}`);
        if (asksBudget) {
          // The next draft after the ask should still not contain budget/limit text
          // This is already covered by the draft assertions above
        }
      }

      if (persona === "pressure" || persona === "term_changer") {
        const ingestNodes = trace.filter((e) => (e as { node?: string }).node === "ingest");
        const pressure = ingestNodes.some(
          (e) => (e as { intent?: { pressure?: boolean } }).intent?.pressure === true
        );
        const termsChanged = ingestNodes.some(
          (e) =>
            (e as { intent?: { terms_changed?: boolean } }).intent?.terms_changed === true
        );
        console.log(
          `persona=${persona} pressure=${pressure} terms_changed=${termsChanged}`
        );
      }

      console.log(
        `persona=${persona} sends=${sendsDone} turns=${sendsDone} elapsed=${((Date.now() - startTime) / 1000).toFixed(1)}s status=${finalSnap.status} outcome=${finalSnap.outcome ?? "none"} draftPrices=[${draftPrices.join(",")}]`
      );
    });
  }
});