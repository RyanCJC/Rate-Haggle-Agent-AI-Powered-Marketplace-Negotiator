import { describe, expect, it } from "vitest";
import {
  describeSlot,
  mapPickupError,
  minimumPickupDate,
  parseEvidence,
  pickupSectionState,
} from "./pickup";

describe("parseEvidence", () => {
  it("labels and unwraps a single listing quote", () => {
    expect(parseEvidence("listing: 6 months warranty left")).toEqual([
      { source: "Listing", quote: "6 months warranty left" },
    ]);
  });

  it("splits and labels quotes from both sources", () => {
    expect(parseEvidence("listing: clean | seller_chat: small scratch")).toEqual([
      { source: "Listing", quote: "clean" },
      { source: "Seller chat", quote: "small scratch" },
    ]);
  });

  it("preserves evidence with an unrecognized source prefix", () => {
    expect(parseEvidence("marketplace: seller says new")).toEqual([
      { source: "Evidence", quote: "marketplace: seller says new" },
    ]);
  });

  it("returns no evidence for empty or missing values", () => {
    expect(parseEvidence(null)).toEqual([]);
    expect(parseEvidence("")).toEqual([]);
    expect(parseEvidence("  ")).toEqual([]);
  });
});

describe("describeSlot", () => {
  it("converts UTC input to Malaysia time", () => {
    expect(describeSlot("2026-03-03T07:00:00Z")).toBe("Tue 3 Mar, 3 pm");
  });

  it.each([
    ["2026-03-03T10:00:00+08:00", "Tue 3 Mar, 10 am"],
    ["2026-03-03T12:00:00+08:00", "Tue 3 Mar, 12 pm"],
    ["2026-03-03T19:00:00+08:00", "Tue 3 Mar, 7 pm"],
  ])("formats %s as %s", (iso, expected) => {
    expect(describeSlot(iso)).toBe(expected);
  });

  it("computes tomorrow by Malaysia's calendar date", () => {
    expect(minimumPickupDate(new Date("2026-03-03T17:00:00Z"))).toBe("2026-03-05");
  });
});

describe("pickupSectionState", () => {
  const copilotDeal = {
    status: "finished" as const,
    outcome: "deal",
    pickup: null,
    config: {
      asking: "1200",
      budget: "1000",
      persona: "flexible",
      style: "balanced" as const,
      autonomy: "approve_close" as const,
      seed: 1,
      mode: "copilot" as const,
    },
  };

  it("shows not-booked and booked states only for finished Copilot deals", () => {
    expect(pickupSectionState(copilotDeal)).toBe("not_booked");
    expect(
      pickupSectionState({
        ...copilotDeal,
        pickup: { status: "booked", start_at: "2026-03-03T10:00:00+08:00" },
      }),
    ).toBe("booked");
    expect(pickupSectionState({ ...copilotDeal, outcome: "user_stopped" })).toBe("hidden");
    expect(pickupSectionState({ ...copilotDeal, config: { ...copilotDeal.config, mode: "simulate" } })).toBe(
      "hidden",
    );
    expect(pickupSectionState({ ...copilotDeal, status: "running" })).toBe("hidden");
  });
});

describe("mapPickupError", () => {
  it("refreshes options after a time was taken", () => {
    expect(mapPickupError({ status: 409, message: "That time was just taken." })).toEqual({
      messages: ["That time was just taken."],
      recovery: "refresh_options",
    });
  });

  it("reloads the snapshot when another time is already booked", () => {
    expect(mapPickupError({ status: 409, message: "Cancel it first." })).toEqual({
      messages: ["Cancel it first."],
      recovery: "refresh_snapshot",
    });
  });

  it("shows backend validation messages and a safe fallback", () => {
    expect(mapPickupError({ status: 422, messages: ["Choose a valid date."] }).messages).toEqual([
      "Choose a valid date.",
    ]);
    expect(mapPickupError({ status: 422, messages: [1] }).messages).toEqual([
      "Please check the time",
    ]);
  });

  it("uses the calendar-unavailable message for 503", () => {
    expect(mapPickupError({ status: 503, message: "offline" }).messages).toEqual([
      "The calendar is unavailable. Try again in a moment.",
    ]);
  });
});
