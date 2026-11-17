import { formatRm } from "./format";
import type { Deal } from "../types";

const OUTCOME_LABELS: Record<Deal["outcome"], string> = {
  deal: "Deal",
  we_walk: "Walked away",
  seller_walks: "Seller walked away",
  extraction_miss: "Not completed",
  timeout: "Timed out",
  user_declined: "Declined",
  user_stopped: "Stopped",
};

export function outcomeLabel(outcome: Deal["outcome"]): string {
  return OUTCOME_LABELS[outcome];
}

export function savingPercent(asking: string | number, final: string | number | null): number | null {
  const askingValue = Number(asking);
  if (final === null || !Number.isFinite(askingValue) || askingValue <= 0) return null;
  const finalValue = Number(final);
  if (!Number.isFinite(finalValue)) return null;
  return Math.max(0, Math.round(((askingValue - finalValue) / askingValue) * 100));
}

export function dealSummary(deal: Pick<Deal, "outcome" | "asking" | "final_price">): string {
  if (deal.outcome !== "deal" || deal.final_price === null) return "No deal";
  const saving = savingPercent(deal.asking, deal.final_price);
  if (saving === null) return formatRm(deal.final_price);
  return `${formatRm(deal.final_price)} (${saving}% below asking ${formatRm(deal.asking)})`;
}

export function formatMatch(similarity: number | null): string {
  if (similarity === null || !Number.isFinite(similarity)) return "— match";
  return `${Math.round(Math.max(0, Math.min(1, similarity)) * 100)}% match`;
}

export function shouldShowSimilarDeals(
  mode: "simulate" | "copilot",
  title: string,
  deals: Deal[],
): boolean {
  return mode === "copilot" && title.trim().length >= 3 && deals.length > 0;
}
