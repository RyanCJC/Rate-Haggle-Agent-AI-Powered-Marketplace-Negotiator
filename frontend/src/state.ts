import type { Pickup, Question, Snapshot, Status, TraceEntry } from "./types";

export interface TraceItem {
  id: number;
  entry: TraceEntry;
}

export const STATUS_LABEL: Record<Status, string> = {
  running: "Working",
  waiting_for_approval: "Waiting for you",
  finished: "Finished",
  failed: "Failed",
  stalled: "Interrupted",
  lost: "Not found",
};

const STATUS_CHIP_LABEL: Record<Status, string> = {
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  finished: "Finished",
  failed: "Failed",
  stalled: "Stalled",
  lost: "Lost",
};

const OUTCOMES: Record<string, string> = {
  deal: "Deal agreed",
  we_walk: "The agent walked away",
  seller_walks: "The seller walked away",
  extraction_miss: "The conversation broke down",
  timeout: "No agreement in time",
  user_declined: "You declined the deal",
  user_stopped: "You ended the negotiation",
};

const STEPS: Record<string, string> = {
  plan: "Planning the next move",
  clarify: "Looking things up",
  compose: "Writing the message",
  validate: "Checking the message against the rules",
  fallback: "Using a safe template",
  execute: "Sending",
  ingest: "Reading the seller's reply",
  finalize: "Wrapping up",
  schedule: "Booking the pickup",
};

export function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "In progress";
  return OUTCOMES[outcome] ?? outcome;
}

export function stepLabel(node: string): string {
  return STEPS[node] ?? node;
}

export function formatRm(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const [whole, fraction] = (Number.isInteger(n) ? n.toString() : n.toFixed(2)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `RM ${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function savings(
  asking: string,
  final: string | null,
): { amount: number; percent: number } | null {
  if (final === null) return null;
  const a = Number(asking);
  const f = Number(final);
  if (!Number.isFinite(a) || !Number.isFinite(f) || a <= 0) return null;
  const amount = a - f;
  return { amount, percent: Math.round((amount / a) * 100) };
}

export function formatPickup(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(iso));
}

export function pickupLine(pickup: Pickup | null): string | null {
  if (!pickup) return null;
  switch (pickup.status) {
    case "booked":
    case "already_booked":
      return pickup.start_at
        ? `Pickup booked: ${formatPickup(pickup.start_at)} (Malaysia time)`
        : "Pickup booked";
    case "declined":
      return "Pickup not booked: you chose not to book it.";
    case "error":
      return "The calendar was unavailable, so no pickup is booked. The deal still stands.";
    case "no_slots":
      return "No free pickup slot was found.";
    default:
      return `Pickup status: ${pickup.status}`;
  }
}

export function gateTitle(question: Question): string {
  const price = formatRm(question.price);
  if (question.gate === "seller_reply") {
    return `Waiting for your reply${question.price ? `: ${price}` : ""}`;
  }
  if (question.gate === "close_deal") {
    return `Accept ${price}?`;
  }
  return `Book the pickup for the ${price} deal?`;
}

export function statusChipLabel(question: Question | null, status: Status = "running"): string {
  if (question?.gate === "seller_reply") return "Waiting for your reply";
  if (question?.gate === "close_deal") return "Waiting for approval";
  return STATUS_CHIP_LABEL[status] ?? "Running";
}

export const statusLabel = statusChipLabel;

export type ComposerState =
  | "waiting_for_reply"
  | "waiting_for_close_approval"
  | "busy"
  | "finished"
  | "stopped";

export function getComposerState(snapshot: Pick<Snapshot, "status" | "question" | "outcome">): ComposerState {
  if (snapshot.question?.gate === "seller_reply") return "waiting_for_reply";
  if (snapshot.question?.gate === "close_deal") return "waiting_for_close_approval";
  if (snapshot.outcome === "user_stopped") return "stopped";
  return snapshot.status === "running" ? "busy" : "finished";
}

export const composerState = getComposerState;
export const composerStatus = getComposerState;

/** Add a trace entry unless it is a replay: ids only ever go up. */
export function appendTrace(list: TraceItem[], id: number, entry: TraceEntry): TraceItem[] {
  const last = list.length ? list[list.length - 1].id : -1;
  return id > last ? [...list, { id, entry }] : list;
}