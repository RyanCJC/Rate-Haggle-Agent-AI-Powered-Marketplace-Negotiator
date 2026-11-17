import type { Snapshot } from "../types";

export interface ParsedEvidence {
  source: string;
  quote: string;
}

export type PickupSectionState = "hidden" | "not_booked" | "booked";

export interface PickupErrorView {
  messages: string[];
  recovery: "refresh_options" | "refresh_snapshot" | null;
}

export function parseEvidence(evidence: string | null | undefined): ParsedEvidence[] {
  if (!evidence?.trim()) return [];

  return evidence.split(" | ").map((entry) => {
    const match = /^(listing|seller_chat):\s*(.*)$/i.exec(entry.trim());
    if (!match) return { source: "Evidence", quote: entry.trim() };
    return {
      source: match[1].toLowerCase() === "listing" ? "Listing" : "Seller chat",
      quote: match[2],
    };
  }).filter((entry) => entry.quote.length > 0);
}

export function pickupSectionState(
  snapshot: Pick<Snapshot, "status" | "outcome" | "pickup" | "config">,
): PickupSectionState {
  if (
    snapshot.status !== "finished" ||
    snapshot.outcome !== "deal" ||
    snapshot.config.mode !== "copilot"
  ) {
    return "hidden";
  }
  return snapshot.pickup?.status === "booked" ? "booked" : "not_booked";
}

export function describeSlot(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "Invalid pickup time";
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const period = part("dayPeriod").toLowerCase();
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")} ${period}`;
}

export function minimumPickupDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1))
    .toISOString()
    .slice(0, 10);
}

export function mapPickupError(problem: unknown): PickupErrorView {
  const error = problem as { status?: unknown; message?: unknown; messages?: unknown } | null;
  const status = error?.status;
  const message = typeof error?.message === "string" ? error.message : "Please try again.";

  if (status === 409) {
    if (/taken/i.test(message)) {
      return { messages: [message], recovery: "refresh_options" };
    }
    if (/cancel it first/i.test(message)) {
      return { messages: [message], recovery: "refresh_snapshot" };
    }
    return { messages: [message], recovery: null };
  }
  if (status === 422) {
    const messages =
      Array.isArray(error?.messages) &&
      error.messages.length > 0 &&
      error.messages.every((item) => typeof item === "string")
        ? error.messages
        : ["Please check the time"];
    return { messages, recovery: null };
  }
  if (status === 503) {
    return {
      messages: ["The calendar is unavailable. Try again in a moment."],
      recovery: null,
    };
  }
  return { messages: [message], recovery: null };
}
