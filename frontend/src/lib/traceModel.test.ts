import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTimeline, violationReason } from "./traceModel";
import type { TraceEntry } from "../types";

function fsPath(urlPath: string): string {
  return urlPath.replace(/^\//, "").replace(/^([A-Za-z])\//, "$1:/");
}

function loadFixture(name: string): { trace: TraceEntry[] } {
  const path = fsPath(
    new URL(`../test/fixtures/${name}.json`, import.meta.url).pathname,
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

const finished = loadFixture("run-deal-finished");
const rejected = loadFixture("run-rejected");

describe("buildTimeline", () => {
  it("groups the real fixture trace into turns with plan/compose/validate/execute/ingest", () => {
    const model = buildTimeline(finished.trace);
    expect(model.turns.length).toBeGreaterThan(0);

    const first = model.turns[0];
    expect(first.title).toContain("Turn 1:");
    expect(first.title).toContain("Offer");
    expect(first.steps.map((s) => s.node)).toContain("plan");
    expect(first.steps.map((s) => s.node)).toContain("validate");
    expect(first.steps.map((s) => s.node)).toContain("ingest");

    for (const turn of model.turns) {
      for (const step of turn.steps) {
        if (step.node === "validate") {
          expect(step.validate?.ok).toBe(true);
          expect(step.validate?.rejectedDraft).toBeNull();
        }
      }
    }

    // Finished run has terminal steps, tested separately.
    expect(model.terminal.length).toBeGreaterThan(0);
  });

  it("finished run has Close and Book-pickup terminal steps labelled correctly", () => {
    const model = buildTimeline(finished.trace);
    expect(model.terminal.length).toBe(2);

    const [close, pickup] = model.terminal;
    expect(close.node).toBe("finalize");
    expect(close.label).toBe("Close");
    expect(close.finalize?.outcome).toBe("deal");

    expect(pickup.node).toBe("schedule");
    expect(pickup.label).toBe("Book pickup");
    expect(pickup.schedule?.status).toBe("booked");
  });

  it("maps a rejected validate entry to a blocked check step with reasons and the draft", () => {
    const model = buildTimeline(rejected.trace);
    const turn = model.turns[0];
    expect(turn.title).toBe("Turn 1: Offer RM 740");

    const validate = turn.steps.find((s) => s.node === "validate");
    expect(validate?.validate?.ok).toBe(false);
    expect(validate?.validate?.rejectedDraft).toBe(
      "My max budget is RM 900, so how about RM 700?",
    );
  });

  it("maps violation codes to human reasons for rejected fixture", () => {
    const model = buildTimeline(rejected.trace);
    const blockedSteps = [];
    for (const turn of model.turns) {
      for (const step of turn.steps) {
        if (step.node === "validate" && !step.validate?.ok) {
          blockedSteps.push(step);
        }
      }
    }
    expect(blockedSteps.length).toBeGreaterThan(0);

    for (const step of blockedSteps) {
      const codes = step.validate!.codes;
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        const reason = violationReason(code);
        expect(reason).not.toContain(code);
        expect(reason.length).toBeGreaterThan(0);
      }
      expect(step.validate!.rejectedDraft).toBe(
        "My max budget is RM 900, so how about RM 700?",
      );
    }
  });

  it("passing validate entries never carry a rejected_draft", () => {
    for (const fx of [finished, rejected]) {
      const model = buildTimeline(fx.trace);
      for (const turn of model.turns) {
        for (const step of turn.steps) {
          if (step.node === "validate" && step.validate?.ok) {
            expect(step.validate?.rejectedDraft).toBeNull();
            expect(step.validate?.codes).toEqual([]);
          }
        }
      }
    }
  });

  it("derives the pending-message step from the snapshot question", () => {
    const model = buildTimeline(
      [{ node: "plan", kind: "offer", price: "900", reason: "counter" }],
      { gate: "seller_reply", kind: "offer", price: "900", draft: "Would RM 900 work?" },
      true,
    );
    expect(model.pending?.label).toBe("Waiting for you to send the message");
    expect(model.terminal.some((step) => step.node === "schedule")).toBe(false);
  });

  it("omits pickup scheduling from Copilot timelines", () => {
    const model = buildTimeline(
      [
        { node: "plan", kind: "offer", price: "900", reason: "counter" },
        { node: "schedule", status: "booked", start_at: "2025-01-01T10:00:00Z" },
      ],
      null,
      true,
    );
    expect(model.terminal.some((step) => step.node === "schedule")).toBe(false);
    expect(model.terminal.map((step) => step.label)).not.toContain("Book pickup");
  });

  it("labels relayed and edited Copilot messages as sent by the user", () => {
    const model = buildTimeline([
      { node: "plan", kind: "offer", price: "900", reason: "counter" },
      { node: "execute", action: "offer", price: "900", relayed: true },
      { node: "plan", kind: "offer", price: "920", reason: "counter" },
      { node: "execute", action: "offer", price: "920", relayed: true, edited: true },
    ]);
    const labels = model.turns.flatMap((turn) => turn.steps.map((step) => step.label));
    expect(labels.filter((label) => label === "You sent this to the seller")).toHaveLength(2);
    const executeSteps = model.turns.flatMap((turn) =>
      turn.steps.filter((step) => step.node === "execute"),
    );
    expect(executeSteps[0].execute?.edited).toBe(false);
    expect(executeSteps[1].execute?.edited).toBe(true);
  });

  it("maps ungrounded claims to the listing-and-chat explanation", () => {
    expect(violationReason("ungrounded_claim")).toBe(
      "Blocked: the draft stated an item detail that is not in the listing or the chat.",
    );
  });

  it("groups clarify entries under 'Research before this offer' with human tool labels", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "clarify", step: 1, tool: "get_listing" },
      { node: "clarify", step: 2, tool: "get_market_stats" },
      { node: "clarify", step: 3, tool: "search_knowledge" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "820" },
    ];
    const model = buildTimeline(trace);
    const clarifySteps = model.turns.flatMap((t) =>
      t.steps.filter((s) => s.node === "clarify"),
    );
    expect(clarifySteps).toHaveLength(1);
    expect(clarifySteps[0].label).toBe("Research before this offer");
    expect(clarifySteps[0].clarify?.tools).toEqual([
      "Read the listing",
      "Checked market prices",
      "Searched buying guidance",
    ]);
  });

  it("does not show a clarify heading when there are no clarify entries", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "820" },
    ];
    const model = buildTimeline(trace);
    const clarifySteps = model.turns.flatMap((t) =>
      t.steps.filter((s) => s.node === "clarify"),
    );
    expect(clarifySteps).toHaveLength(0);
  });

  it("shows clarify result text when the entry carries a note", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "clarify", step: 1, tool: "ask_seller", note: "ask refused" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "820" },
    ];
    const model = buildTimeline(trace);
    const clarifySteps = model.turns.flatMap((t) =>
      t.steps.filter((s) => s.node === "clarify"),
    );
    expect(clarifySteps).toHaveLength(1);
    expect(clarifySteps[0].clarify?.results).toContain("ask refused");
  });

  it("places clarify group only in the turn where clarify entries occur", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "820" },
      { node: "ingest", intent: { price: "820", accepted: true, walked_away: false, asks_budget: false, pressure: false, terms_changed: false } },
      { node: "plan", kind: "offer", price: "835", reason: "counter" },
      { node: "clarify", step: 1, tool: "get_listing" },
      { node: "clarify", step: 2, tool: "get_market_stats" },
      { node: "clarify", step: 3, tool: "ask_seller" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "835" },
    ];
    const model = buildTimeline(trace);
    expect(model.turns).toHaveLength(2);

    const turn1 = model.turns[0];
    expect(turn1.title).toContain("Turn 1");
    expect(turn1.steps.filter((s) => s.node === "clarify")).toHaveLength(0);

    const turn2 = model.turns[1];
    expect(turn2.title).toContain("Turn 2");
    const clarifySteps = turn2.steps.filter((s) => s.node === "clarify");
    expect(clarifySteps).toHaveLength(1);
    expect(clarifySteps[0].label).toBe("Research before this offer");

    // Placed after plan, before compose/write.
    const nodeOrder = turn2.steps.map((s) => s.node);
    const planIndex = nodeOrder.indexOf("plan");
    const clarifyIndex = nodeOrder.indexOf("clarify");
    const composeIndex = nodeOrder.indexOf("compose");
    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(clarifyIndex).toBeGreaterThan(planIndex);
    expect(composeIndex).toBeGreaterThan(clarifyIndex);

    expect(clarifySteps[0].clarify?.tools).toEqual([
      "Read the listing",
      "Checked market prices",
      "Asked the seller",
    ]);
  });

  it("shows clarify entries when the trace ends right after them (no compose after)", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "clarify", step: 1, tool: "get_listing" },
      { node: "clarify", step: 2, tool: "ask_seller" },
    ];
    const model = buildTimeline(trace);
    expect(model.turns).toHaveLength(1);
    const turn = model.turns[0];
    const clarifySteps = turn.steps.filter((s) => s.node === "clarify");
    expect(clarifySteps).toHaveLength(1);
    expect(clarifySteps[0].label).toBe("Research before this offer");
    expect(clarifySteps[0].clarify?.tools).toEqual(["Read the listing", "Asked the seller"]);
  });
});
