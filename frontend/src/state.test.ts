import { describe, expect, it } from "vitest";
import {
  appendTrace,
  formatPickup,
  formatRm,
  gateTitle,
  getComposerState,
  outcomeLabel,
  pickupLine,
  savings,
  shouldShowTyping,
  statusChipLabel,
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
    expect(gateTitle({ gate: "seller_reply", kind: "offer", price: "880", draft: "hello" })).toBe(
      "Waiting for your reply: RM 880",
    );
  });

  it("derives chip labels at the seller and close gates", () => {
    expect(statusChipLabel({ gate: "seller_reply", kind: "offer", price: "990", draft: "ok" })).toBe(
      "Waiting for your reply",
    );
    expect(statusChipLabel({ gate: "close_deal", price: "880" }, "running")).toBe("Waiting for approval");
    expect(statusChipLabel(null, "running")).toBe("Running");
    expect(statusChipLabel(null, "waiting_for_approval")).toBe("Waiting for approval");
  });
});

describe("getComposerState", () => {
  it("classifies seller-reply and close-approval gates before status", () => {
    expect(getComposerState({ status: "running", question: { gate: "seller_reply", kind: "offer", price: "990", draft: "hey" }, outcome: null })).toBe("waiting_for_reply");
    expect(getComposerState({ status: "waiting_for_approval", question: { gate: "close_deal", price: "880" }, outcome: null })).toBe("waiting_for_close_approval");
  });

  it("classifies busy, finished, and stopped snapshots", () => {
    expect(getComposerState({ status: "running", question: null, outcome: null })).toBe("busy");
    expect(getComposerState({ status: "running", question: null, outcome: "user_stopped" })).toBe("stopped");
    expect(getComposerState({ status: "finished", question: null, outcome: "deal" })).toBe("finished");
    expect(getComposerState({ status: "failed", question: null, outcome: null })).toBe("finished");
  });
});

describe("shouldShowTyping", () => {
  it("shows typing while the agent composes and no gate is pending", () => {
    expect(shouldShowTyping("running", null)).toBe(true);
  });
  it("hides typing while waiting at a seller_reply gate, either channel", () => {
    const manual = { gate: "seller_reply", kind: "offer", price: "880", draft: "RM 880" } as const;
    const marketplace = { gate: "seller_reply", kind: "offer", price: "880", draft: "RM 880", channel: "marketplace" } as const;
    expect(shouldShowTyping("running", manual)).toBe(false);
    expect(shouldShowTyping("running", marketplace)).toBe(false);
    expect(shouldShowTyping("waiting_for_approval", manual)).toBe(false);
    expect(shouldShowTyping("waiting_for_approval", marketplace)).toBe(false);
  });
  it("hides typing at the close approval gate", () => {
    expect(shouldShowTyping("running", { gate: "close_deal", price: "880" } as const)).toBe(false);
  });
  it("shows typing again once the user has replied and no gate is pending", () => {
    expect(shouldShowTyping("running", null)).toBe(true);
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