import { describe, expect, it } from "vitest";
import { dealSummary, formatMatch, outcomeLabel, savingPercent, shouldShowSimilarDeals } from "./memory";
import type { Deal } from "../types";

const outcomes: [Deal["outcome"], string][] = [
  ["deal", "Deal"],
  ["we_walk", "Walked away"],
  ["seller_walks", "Seller walked away"],
  ["extraction_miss", "Not completed"],
  ["timeout", "Timed out"],
  ["user_declined", "Declined"],
  ["user_stopped", "Stopped"],
];

const deal: Deal = {
  run_id: "r1",
  item_title: "Monitor",
  category: "monitors",
  asking: "1200",
  final_price: "880",
  outcome: "deal",
  mode: "copilot",
  rounds: 3,
  created_at: "2026-11-17T10:00:00+08:00",
  similarity: 0.84,
};

describe("profile memory helpers", () => {
  it.each(outcomes)("labels %s as %s", (outcome, label) => {
    expect(outcomeLabel(outcome)).toBe(label);
  });

  it("computes savings without negative percentages", () => {
    expect(savingPercent("1200", "880")).toBe(27);
    expect(savingPercent("1200", "1300")).toBe(0);
    expect(savingPercent("1200", null)).toBeNull();
    expect(savingPercent("0", "100")).toBeNull();
  });

  it("summarizes deals and non-deal outcomes", () => {
    expect(dealSummary(deal)).toBe("RM 880 (27% below asking RM 1,200)");
    expect(dealSummary({ ...deal, outcome: "we_walk" })).toBe("No deal");
  });

  it("formats similarity and derives when the card can show", () => {
    expect(formatMatch(0.84)).toBe("84% match");
    expect(shouldShowSimilarDeals("copilot", "monitor", [deal])).toBe(true);
    expect(shouldShowSimilarDeals("copilot", "mo", [deal])).toBe(false);
    expect(shouldShowSimilarDeals("simulate", "monitor", [deal])).toBe(false);
    expect(shouldShowSimilarDeals("copilot", "monitor", [])).toBe(false);
  });
});
