import type { Question, TraceEntry } from "../types";

export type TraceNode =
  | "plan"
  | "clarify"
  | "compose"
  | "validate"
  | "fallback"
  | "execute"
  | "ingest"
  | "finalize"
  | "schedule";

export interface PlanStep {
  kind: string;
  price: string | null;
  reason: string;
}

export interface ComposeStep {
  attempt: number;
}

export interface ValidateStep {
  ok: boolean;
  codes: string[];
  rejectedDraft: string | null;
}

export interface ExecuteStep {
  action: string;
  price: string | null;
  declined?: boolean;
  error: string | null;
  relayed: boolean;
  edited: boolean;
}

export interface IngestStep {
  intent: {
    price: string | null;
    accepted: boolean;
    walked_away: boolean;
    asks_budget: boolean;
    pressure: boolean;
    terms_changed: boolean;
  };
  ignoredImplausiblePrice: string | null;
}

export interface FinalizeStep {
  outcome: string | null;
}

export interface ScheduleStep {
  status: string;
  startAt: string | null;
  detail: string | null;
}

export interface ClarifyStep {
  tools: string[];
}

export interface TraceStep {
  node: TraceNode;
  label: string;
  clarify?: ClarifyStep;
  plan?: PlanStep;
  compose?: ComposeStep;
  validate?: ValidateStep;
  execute?: ExecuteStep;
  ingest?: IngestStep;
  finalize?: FinalizeStep;
  schedule?: ScheduleStep;
}

export interface Turn {
  turn: number;
  title: string;
  steps: TraceStep[];
}

export interface TimelineModel {
  turns: Turn[];
  terminal: TraceStep[];
  pending: { label: string } | null;
}

const STEP_LABEL: Record<string, string> = {
  plan: "Plan",
  clarify: "Clarify",
  compose: "Write",
  validate: "Check",
  fallback: "Safe template used",
  execute: "Send",
  ingest: "Read reply",
  finalize: "Close",
  schedule: "Book pickup",
};

const VIOLATION_REASON: Record<string, string> = {
  private_phrase: "The message mentioned your private budget or limit.",
  ceiling_claim: "The message claimed an offer is your maximum or final price.",
  number_above_ceiling: "The message mentioned a price above your current offer.",
  price_not_stated: "The message did not state the exact price.",
  offer_decreases: "An offer cannot be lower than your previous offer.",
  accept_mismatch: "You can only accept the seller's latest price.",
  over_budget: "That price is above what you are allowed to pay.",
  above_asking: "Never offer more than the seller is asking.",
  phase_not_allowed: "That action is not allowed right now.",
  no_draft: "Write a message.",
  ungrounded_claim: "Blocked: the draft stated an item detail that is not in the listing or the chat.",
};

export function violationReason(code: string): string {
  return VIOLATION_REASON[code] ?? `The message broke a rule: ${code}.`;
}

function entryNode(entry: TraceEntry): string {
  return String(entry.node ?? "");
}

function asPlan(entry: TraceEntry): PlanStep {
  return {
    kind: String(entry.kind ?? ""),
    price: entry.price === null || entry.price === undefined ? null : String(entry.price),
    reason: String(entry.reason ?? ""),
  };
}

function asCompose(entry: TraceEntry): ComposeStep {
  return { attempt: Number(entry.attempt ?? 1) };
}

function asValidate(entry: TraceEntry): ValidateStep {
  return {
    ok: entry.ok === true,
    codes: Array.isArray(entry.codes) ? entry.codes.map(String) : [],
    rejectedDraft:
      entry.rejected_draft === null || entry.rejected_draft === undefined
        ? null
        : String(entry.rejected_draft),
  };
}

function asExecute(entry: TraceEntry): ExecuteStep {
  return {
    action: String(entry.action ?? ""),
    price: entry.price === null || entry.price === undefined ? null : String(entry.price),
    declined: entry.declined === true,
    error: entry.error === null || entry.error === undefined ? null : String(entry.error),
    relayed: entry.relayed === true,
    edited: entry.edited === true,
  };
}

function asIngest(entry: TraceEntry): IngestStep {
  const intent = entry.intent ?? {};
  return {
    intent: {
      price:
        (intent as { price?: unknown }).price === null ||
        (intent as { price?: unknown }).price === undefined
          ? null
          : String((intent as { price?: unknown }).price),
      accepted: (intent as { accepted?: boolean }).accepted === true,
      walked_away: (intent as { walked_away?: boolean }).walked_away === true,
      asks_budget: (intent as { asks_budget?: boolean }).asks_budget === true,
      pressure: (intent as { pressure?: boolean }).pressure === true,
      terms_changed: (intent as { terms_changed?: boolean }).terms_changed === true,
    },
    ignoredImplausiblePrice:
      entry.ignored_implausible_price === null ||
      entry.ignored_implausible_price === undefined
        ? null
        : String(entry.ignored_implausible_price),
  };
}

function asFinalize(entry: TraceEntry): FinalizeStep {
  return { outcome: entry.outcome === null || entry.outcome === undefined ? null : String(entry.outcome) };
}

function asSchedule(entry: TraceEntry): ScheduleStep {
  return {
    status: String(entry.status ?? ""),
    startAt: entry.start_at === null || entry.start_at === undefined ? null : String(entry.start_at),
    detail: entry.detail === null || entry.detail === undefined ? null : String(entry.detail),
  };
}

function stepLabel(node: TraceNode): string {
  return STEP_LABEL[node] ?? node;
}

function turnTitle(kind: string, price: string | null): string {
  const label =
    kind === "accept" ? "Accept" : kind === "walk_away" ? "Walk away" : kind === "ask_question" ? "Ask" : "Offer";
  const pricePart = price === null ? "" : ` RM ${price}`;
  return `${label}${pricePart}`;
}

export function buildTimeline(
  trace: TraceEntry[],
  question: Question | null = null,
  copilot = false,
): TimelineModel {
  const turns: Turn[] = [];
  const terminal: TraceStep[] = [];
  let current: Turn | null = null;
  let turnNumber = 0;
  let clarifyTools: string[] = [];

  const flushClarify = () => {
    if (clarifyTools.length > 0 && current) {
      const uniq = [...new Set(clarifyTools)];
      current.steps.push({
        node: "clarify",
        label: stepLabel("clarify"),
        clarify: { tools: uniq },
      });
      clarifyTools = [];
    }
  };

  for (const entry of trace) {
    const node = entryNode(entry);
    if (node === "plan") {
      flushClarify();
      turnNumber += 1;
      current = {
        turn: turnNumber,
        title: `Turn ${turnNumber}: ${turnTitle(asPlan(entry).kind, asPlan(entry).price)}`,
        steps: [],
      };
      turns.push(current);
      current.steps.push({ node: "plan", label: stepLabel("plan"), plan: asPlan(entry) });
      continue;
    }
    if (node === "schedule" && copilot) continue;
    if (node === "finalize" || node === "schedule") {
      flushClarify();
      terminal.push({
        node: node as TraceNode,
        label: stepLabel(node as TraceNode),
        ...(node === "finalize" ? { finalize: asFinalize(entry) } : { schedule: asSchedule(entry) }),
      });
      continue;
    }
    if (!current) continue;
    if (node === "clarify") {
      const tool = entry.tool === null || entry.tool === undefined ? null : String(entry.tool);
      if (tool) clarifyTools.push(tool);
      continue;
    }
    flushClarify();
    switch (node) {
      case "clarify":
        current.steps.push({ node: "clarify", label: stepLabel("clarify") });
        break;
      case "compose":
        current.steps.push({ node: "compose", label: stepLabel("compose"), compose: asCompose(entry) });
        break;
      case "validate":
        current.steps.push({ node: "validate", label: stepLabel("validate"), validate: asValidate(entry) });
        break;
      case "fallback":
        current.steps.push({ node: "fallback", label: stepLabel("fallback") });
        break;
      case "execute": {
        const execute = asExecute(entry);
        current.steps.push({
          node: "execute",
          label: execute.relayed
            ? "You sent this to the seller"
            : entry.action === "accept" || entry.action === "walk_away"
              ? "Close"
              : stepLabel("execute"),
          execute,
        });
        break;
      }
      case "ingest":
        current.steps.push({ node: "ingest", label: stepLabel("ingest"), ingest: asIngest(entry) });
        break;
      default:
        break;
    }
  }

  return {
    turns,
    terminal,
    pending: question?.gate === "seller_reply" ? { label: "Waiting for you to send the message" } : null,
  };
}
