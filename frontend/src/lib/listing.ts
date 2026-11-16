import type { FactStatus } from "../types";

const COMPARABLES_ERROR = "Enter prices as numbers, for example 850 900 920.";

export interface ComparableParseResult {
  prices: number[];
  error: string | null;
}

export interface MarketCheckResult {
  median: number;
  askingPercent: number;
  limitPercent: number;
  count: number;
}

const FACT_LABELS: Record<string, string> = {
  condition: "Condition",
  age: "Age",
  warranty: "Warranty",
  defects: "Defects",
  accessories: "Accessories",
  size_inch: "Screen size",
  refresh_rate: "Refresh rate",
  storage: "Storage",
  battery_health: "Battery health",
};

const FACT_STATUS_LABELS: Record<FactStatus, string> = {
  confirmed: "Confirmed",
  claimed: "Stated once",
  conflicting: "Sources disagree",
  missing: "Unknown",
};

export function parseComparables(input: string): ComparableParseResult {
  const prices: number[] = [];
  const chunks = input.trim().split(/[\s;]+/).filter(Boolean);

  for (const chunk of chunks) {
    const token = chunk.replace(/^RM/i, "");
    if (!token) continue;

    const isThousandsGrouped = /^\d{1,2}(?:,\d{3})+(?:\.\d+)?$/.test(token);
    const tokens = isThousandsGrouped ? [token.replace(/,/g, "")] : token.split(",");
    if (tokens.some((part) => !part)) {
      return { prices, error: COMPARABLES_ERROR };
    }

    for (const part of tokens) {
      const price = Number(part);
      if (!Number.isFinite(price) || price <= 0) {
        return { prices, error: COMPARABLES_ERROR };
      }
      prices.push(price);
      if (prices.length > 8) {
        return { prices, error: COMPARABLES_ERROR };
      }
    }
  }

  return { prices, error: null };
}

export function marketCheck(
  prices: number[],
  asking: number,
  limit: number,
): MarketCheckResult | null {
  if (
    prices.length < 2 ||
    !Number.isFinite(asking) ||
    asking <= 0 ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    prices.some((price) => !Number.isFinite(price) || price <= 0)
  ) {
    return null;
  }

  const ordered = [...prices].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 0
      ? (ordered[middle - 1] + ordered[middle]) / 2
      : ordered[middle];

  return {
    median,
    askingPercent: Math.round(((asking - median) / median) * 100),
    limitPercent: Math.round(((limit - median) / median) * 100),
    count: ordered.length,
  };
}

export function factLabel(key: string): string {
  const known = FACT_LABELS[key];
  if (known) return known;
  const label = key.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function factStatusLabel(status: FactStatus): string {
  return FACT_STATUS_LABELS[status];
}
