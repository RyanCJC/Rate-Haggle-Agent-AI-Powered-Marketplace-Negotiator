import { describe, expect, it } from "vitest";
import type { FactStatus } from "../types";
import { factLabel, factStatusLabel, marketCheck, parseComparables } from "./listing";

describe("parseComparables", () => {
  it("splits prices and strips leading RM, including thousands separators", () => {
    expect(parseComparables("RM 1,200\n850; RM900")).toEqual({
      prices: [1200, 850, 900],
      error: null,
    });
  });

  it("treats a comma between three-digit prices as a separator", () => {
    expect(parseComparables("850,900")).toEqual({ prices: [850, 900], error: null });
  });

  it.each(["abc", "0", "-10", "850,,900", "1 2 3 4 5 6 7 8 9"])(
    "rejects invalid input %s with the specified error",
    (input) => {
      expect(parseComparables(input).error).toBe(
        "Enter prices as numbers, for example 850 900 920.",
      );
    },
  );
});

describe("marketCheck", () => {
  it("uses the middle value for an odd number of prices", () => {
    expect(marketCheck([900, 700, 800], 900, 750)).toEqual({
      median: 800,
      askingPercent: 13,
      limitPercent: -6,
      count: 3,
    });
  });

  it("averages the middle pair for an even number of prices", () => {
    expect(marketCheck([920, 780, 900, 850], 900, 750)).toEqual({
      median: 875,
      askingPercent: 3,
      limitPercent: -14,
      count: 4,
    });
  });

  it("returns null with only one price", () => {
    expect(marketCheck([850], 900, 750)).toBeNull();
  });

  it("rounds positive and negative percentages to whole percentages", () => {
    expect(marketCheck([100, 200], 160, 140)).toEqual({
      median: 150,
      askingPercent: 7,
      limitPercent: -7,
      count: 2,
    });
  });
});

describe("fact labels", () => {
  it("maps supported keys and capitalizes unknown keys", () => {
    expect(factLabel("condition")).toBe("Condition");
    expect(factLabel("size_inch")).toBe("Screen size");
    expect(factLabel("unused_key")).toBe("Unused key");
  });

  it("maps fact statuses to plain-language labels", () => {
    const statuses: FactStatus[] = ["confirmed", "claimed", "conflicting", "missing"];
    expect(statuses.map(factStatusLabel)).toEqual([
      "Confirmed",
      "Stated once",
      "Sources disagree",
      "Unknown",
    ]);
  });
});
