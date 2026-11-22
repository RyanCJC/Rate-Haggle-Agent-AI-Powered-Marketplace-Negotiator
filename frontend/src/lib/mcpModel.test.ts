import { describe, expect, it } from "vitest";
import {
  describeCall,
  formatDuration,
  groupCalls,
  normalizeDescription,
  personaLabel,
  statusLabel,
} from "./mcpModel";
import type { McpCall } from "../types";

function call(overrides: Partial<McpCall>): McpCall {
  return {
    ts: "2026-11-21T13:54:19.985868+00:00",
    run: null,
    server: "marketplace",
    tool: "send_offer",
    ok: true,
    ms: 16,
    error: null,
    args: {},
    ...overrides,
  };
}

describe("normalizeDescription", () => {
  it("collapses whitespace and returns the first sentence", () => {
    expect(normalizeDescription("  List the earliest   free   slots.  Hourly from 10:00.")).toBe(
      "List the earliest free slots",
    );
  });

  it("returns the whole text when there is no sentence boundary", () => {
    expect(normalizeDescription("Just a simple description")).toBe("Just a simple description");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeDescription("")).toBe("");
    expect(normalizeDescription("   ")).toBe("");
  });

  it("truncates at 140 chars with an ellipsis when no sentence boundary", () => {
    const long = "a".repeat(200);
    expect(normalizeDescription(long)).toBe("a".repeat(140) + "...");
  });

  it("does not add ellipsis when at or under 140 chars", () => {
    expect(normalizeDescription("a".repeat(140))).toBe("a".repeat(140));
    expect(normalizeDescription("a".repeat(139))).toBe("a".repeat(139));
  });
});

describe("formatDuration", () => {
  it("renders zero as <1 ms", () => {
    expect(formatDuration(0)).toBe("<1 ms");
  });

  it("renders under a second as ms", () => {
    expect(formatDuration(16)).toBe("16 ms");
    expect(formatDuration(999)).toBe("999 ms");
  });

  it("renders over a second as seconds with one decimal", () => {
    expect(formatDuration(1250)).toBe("1.3 s");
    expect(formatDuration(1000)).toBe("1.0 s");
    expect(formatDuration(2500)).toBe("2.5 s");
  });
});

describe("describeCall", () => {
  it("send_offer with turn and price", () => {
    expect(
      describeCall(call({ tool: "send_offer", args: { turn: 0, price: 820 } })),
    ).toBe("turn 0, RM 820");
  });

  it("send_offer omits missing parts", () => {
    expect(describeCall(call({ tool: "send_offer", args: { turn: 3 } }))).toBe("turn 3");
    expect(describeCall(call({ tool: "send_offer", args: { price: 835 } }))).toBe("RM 835");
    expect(describeCall(call({ tool: "send_offer", args: {} }))).toBe("send_offer");
  });

  it("send_message follows the same shape", () => {
    expect(
      describeCall(call({ tool: "send_message", args: { turn: 1, price: 900 } })),
    ).toBe("turn 1, RM 900");
  });

  it("open_conversation shows the first 8 chars of the conversation", () => {
    expect(
      describeCall(call({ tool: "open_conversation", args: { conversation: "08f7dd66b522" } })),
    ).toBe("conversation 08f7dd66");
  });

  it("open_conversation without conversation id", () => {
    expect(describeCall(call({ tool: "open_conversation", args: {} }))).toBe("conversation ");
  });

  it("propose_slots with count and from_iso", () => {
    expect(
      describeCall(
        call({
          tool: "propose_slots",
          args: { count: 5, from_iso: "2026-12-02T10:00:00+08:00" },
        }),
      ),
    ).toBe("up to 5 slots from 2 Dec, 10:00");
  });

  it("propose_slots with only count", () => {
    expect(
      describeCall(call({ tool: "propose_slots", args: { count: 3 } })),
    ).toBe("up to 3 slots");
  });

  it("book_slot with start_at", () => {
    expect(
      describeCall(call({ tool: "book_slot", args: { start_at: "2026-12-02T10:00:00+08:00" } })),
    ).toBe("slot 2 Dec, 10:00");
  });

  it("cancel_booking", () => {
    expect(describeCall(call({ tool: "cancel_booking", args: {} }))).toBe("pickup booking");
  });

  it("unknown tool joins args as key value", () => {
    expect(
      describeCall(call({ tool: "weird_tool", args: { a: 1, b: "two" } })),
    ).toBe("a 1 b two");
  });

  it("unknown tool with no args returns the tool name", () => {
    expect(describeCall(call({ tool: "weird_tool", args: {} }))).toBe("weird_tool");
  });
});

describe("groupCalls", () => {
  it("collapses consecutive open_conversation duplicates into one reopened row", () => {
    const open = (conversation: string) =>
      call({ tool: "open_conversation", args: { conversation } });
    const offer = () => call({ tool: "send_offer", args: { turn: 0, price: 820 } });

    const rows = groupCalls([open("cal-1"), open("cal-1"), offer()]);
    expect(rows.map((r) => r.kind)).toEqual(["normal", "reopened", "normal"]);
    expect(rows[1].count).toBe(1);
    expect(rows[0].call.tool).toBe("open_conversation");
    expect(rows[2].call.tool).toBe("send_offer");
  });

  it("interleaved example collapses each non-consecutive reopen", () => {
    const open = () =>
      call({ tool: "open_conversation", args: { conversation: "conv-1" } });
    const offer = () => call({ tool: "send_offer", args: { turn: 0, price: 820 } });

    const calls = [open(), open(), offer(), open(), offer(), open(), offer(), open()];
    const rows = groupCalls(calls);

    expect(rows.length).toBe(8);
    expect(rows.map((r) => r.kind)).toEqual([
      "normal",
      "reopened",
      "normal",
      "reopened",
      "normal",
      "reopened",
      "normal",
      "reopened",
    ]);
    rows.filter((r) => r.kind === "reopened").forEach((r) => expect(r.count).toBe(1));
  });

  it("three consecutive opens become one reopened row with count 2", () => {
    const open = () =>
      call({ tool: "open_conversation", args: { conversation: "conv-1" } });
    const rows = groupCalls([open(), open(), open()]);
    expect(rows.map((r) => r.kind)).toEqual(["normal", "reopened"]);
    expect(rows[1].count).toBe(2);
  });

  it("different conversations each open normally", () => {
    const rows = groupCalls([
      call({ tool: "open_conversation", args: { conversation: "a" } }),
      call({ tool: "open_conversation", args: { conversation: "b" } }),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["normal", "normal"]);
  });

  it("empty input returns no rows", () => {
    expect(groupCalls([])).toEqual([]);
  });
});

describe("statusLabel", () => {
  it("maps statuses", () => {
    expect(statusLabel("connected")).toBe("connected");
    expect(statusLabel("off")).toBe("off");
    expect(statusLabel("down")).toBe("not responding");
    expect(statusLabel("unknown")).toBe("unknown");
  });
});

describe("personaLabel", () => {
  it("maps known personas", () => {
    expect(personaLabel("flexible")).toBe("Flexible seller");
    expect(personaLabel("firm")).toBe("Firm seller");
    expect(personaLabel("dishonest")).toBe("Bluffing seller");
  });

  it("falls back to the id for unknown personas", () => {
    expect(personaLabel("weird_persona")).toBe("weird_persona");
    expect(personaLabel("")).toBe("");
  });
});
