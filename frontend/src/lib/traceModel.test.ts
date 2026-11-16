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
});
