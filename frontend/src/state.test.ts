import { describe, expect, it } from "vitest";
import {
  appendTrace,
  formatPickup,
  formatRm,
  gateTitle,
  outcomeLabel,
  pickupLine,
  savings,
  stepLabel,
} from "./state";

describe("formatRm", () => {
  it("groups thousands and only shows cents when needed", () => {
    expect(formatRm("1200")).toBe("RM 1,200");
    expect(formatRm(925.5)).toBe("RM 925.50");
    expect(formatRm("880")).toBe("RM 880");
  });
  it("shows a dash for missing or unreadable values", () => {
    expect(formatRm(null)).toBe("—");
    expect(formatRm("None")).toBe("—");
    expect(formatRm(undefined)).toBe("—");
  });
});

describe("savings", () => {
  it("is the amount and rounded percentage below asking", () => {
    expect(savings("1200", "880")).toEqual({ amount: 320, percent: 27 });
  });
  it("is null when there is nothing to compare", () => {
    expect(savings("1200", null)).toBeNull();
    expect(savings("0", "100")).toBeNull();
    expect(savings("abc", "100")).toBeNull();
  });
});

describe("labels", () => {
  it("names every outcome and passes unknown ones through", () => {
    expect(outcomeLabel("deal")).toBe("Deal agreed");
    expect(outcomeLabel("user_declined")).toBe("You declined the deal");
    expect(outcomeLabel(null)).toBe("In progress");
    expect(outcomeLabel("something_new")).toBe("something_new");
  });
  it("names the agent's steps", () => {
    expect(stepLabel("validate")).toBe("Checking the message against the rules");
    expect(stepLabel("unknown_node")).toBe("unknown_node");
  });
  it("titles both gates", () => {
    expect(gateTitle({ gate: "close_deal", price: "880" })).toBe("Accept RM 880?");
    expect(gateTitle({ gate: "book_pickup", price: "925" })).toBe(
      "Book the pickup for the RM 925 deal?",
    );
  });
});

describe("pickup", () => {
  it("shows the slot in Malaysia time whatever timezone the server used", () => {
    expect(formatPickup("2026-11-16T10:00:00+00:00")).toContain("18:00");
    expect(formatPickup("2026-11-16T18:00:00+08:00")).toContain("18:00");
  });
  it("explains each pickup status in plain words", () => {
    expect(pickupLine(null)).toBeNull();
    expect(pickupLine({ status: "booked", start_at: "2026-11-16T18:00:00+08:00" })).toContain(
      "Pickup booked",
    );
    expect(pickupLine({ status: "declined" })).toContain("not booked");
    expect(pickupLine({ status: "error" })).toContain("deal still stands");
  });
});

describe("appendTrace", () => {
  const entry = { node: "plan" };
  it("keeps order and ignores replays", () => {
    let list = appendTrace([], 0, entry);
    list = appendTrace(list, 1, entry);
    expect(list.map((item) => item.id)).toEqual([0, 1]);
    expect(appendTrace(list, 1, entry)).toBe(list);
    expect(appendTrace(list, 0, entry)).toBe(list);
    expect(appendTrace(list, 5, entry).map((item) => item.id)).toEqual([0, 1, 5]);
  });
});