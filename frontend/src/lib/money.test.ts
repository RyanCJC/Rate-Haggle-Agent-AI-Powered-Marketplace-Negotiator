import { describe, expect, it } from "vitest";
import { isAmountValid, parseMoney } from "./money";

describe("parseMoney", () => {
  const accepted: Array<[string, number]> = [
    ["1200", 1200],
    ["  1200  ", 1200],
    ["1200.50", 1200.5],
    ["1,200", 1200],
    ["RM 1200", 1200],
    ["rm1,200.50", 1200.5],
    ["RM1200", 1200],
    ["99999999", 99999999],
    ["1,000", 1000],
  ];

  for (const [input, expected] of accepted) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      expect(parseMoney(input)).toBe(expected);
    });
  }

  const acceptedAtMin: Array<[string, number]> = [
    ["10", 10],
    ["RM 10", 10],
    ["1,000", 1000],
  ];

  for (const [input, expected] of acceptedAtMin) {
    it(`accepts at minimum ${JSON.stringify(input)}`, () => {
      expect(parseMoney(input)).toBe(expected);
    });
  }

  const rejected: string[] = [
    "",
    "0",
    "-500",
    "abc",
    "1,2",
    "12,34,567",
    "1e3",
    "RM",
    "1.2.3",
    "RM -5",
  ];

  for (const input of rejected) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parseMoney(input)).toBeNull();
    });
  }
});

describe("isAmountValid", () => {
  const accepted: Array<number | null> = [10, 10.5, 100, 1000, 99999999];
  for (const value of accepted) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(isAmountValid(value)).toBe(true);
    });
  }

  const rejected: Array<number | null> = [null, 0, 9, 9.99, -5];
  for (const value of rejected) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(isAmountValid(value)).toBe(false);
    });
  }
});
