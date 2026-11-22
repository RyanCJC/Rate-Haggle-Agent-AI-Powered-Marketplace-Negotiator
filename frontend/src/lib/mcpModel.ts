import { formatRm, formatTime } from "./format";
import type { McpCall, McpServer } from "../types";

const PERSONA_LABELS: Record<string, string> = {
  flexible: "Flexible seller",
  firm: "Firm seller",
  evasive: "Evasive seller",
  pressure: "Pushy seller",
  budget_prober: "Nosy seller",
  term_changer: "Moving-target seller",
  mixed_my_en: "Malay-English seller",
  dishonest: "Bluffing seller",
};

export function normalizeDescription(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const sentenceEnd = collapsed.indexOf(". ");
  const end = sentenceEnd !== -1 ? sentenceEnd : collapsed.length;
  const cut = end > 140 ? 140 : end;
  let result = collapsed.slice(0, cut);
  if (collapsed.length > 140 && cut === 140) result += "...";
  return result;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "<1 ms";
  if (ms === 0) return "<1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

export function describeCall(call: McpCall): string {
  const { tool, args } = call;
  switch (tool) {
    case "send_offer":
    case "send_message": {
      const parts: string[] = [];
      if (args.turn !== undefined && args.turn !== null) parts.push(`turn ${args.turn}`);
      if (args.price !== undefined && args.price !== null && Number.isFinite(args.price))
        parts.push(formatRm(args.price));
      return parts.length ? parts.join(", ") : tool;
    }
    case "open_conversation": {
      const conv = args.conversation ?? "";
      return `conversation ${String(conv).slice(0, 8)}`;
    }
    case "propose_slots": {
      const parts: string[] = [];
      if (args.count !== undefined && args.count !== null) parts.push(`up to ${args.count} slots`);
      if (args.from_iso) parts.push(`from ${formatTime(args.from_iso)}`);
      return parts.length ? parts.join(" ") : "propose slots";
    }
    case "book_slot": {
      if (args.start_at) return `slot ${formatTime(args.start_at)}`;
      return "book slot";
    }
    case "cancel_booking":
      return "pickup booking";
    default: {
      const entries = Object.entries(args).filter(
        ([, value]) => value !== undefined && value !== null,
      );
      return entries.length
        ? entries.map(([key, value]) => `${key} ${value}`).join(" ")
        : tool;
    }
  }
}

export interface CallRow {
  kind: "normal" | "reopened";
  call: McpCall;
  count?: number;
}

export function groupCalls(calls: McpCall[]): CallRow[] {
  const rows: CallRow[] = [];
  const opened = new Set<string>();
  let pending: { conversation: string; count: number; call: McpCall } | null = null;

  const flush = () => {
    if (pending) {
      rows.push({ kind: "reopened", call: pending.call, count: pending.count });
      pending = null;
    }
  };

  for (const call of calls) {
    if (call.tool === "open_conversation") {
      const conversation = call.args.conversation;
      if (conversation && opened.has(conversation)) {
        if (pending && pending.conversation === conversation) {
          pending.count += 1;
        } else {
          flush();
          pending = { conversation, count: 1, call };
        }
        continue;
      }
      flush();
      rows.push({ kind: "normal", call });
      if (conversation) opened.add(conversation);
    } else {
      flush();
      rows.push({ kind: "normal", call });
    }
  }
  flush();
  return rows;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "connected";
    case "off":
      return "off";
    case "down":
      return "not responding";
    default:
      return status;
  }
}

export function personaLabel(id: string): string {
  return PERSONA_LABELS[id] ?? id;
}

export function serverStatusColor(status: McpServer["status"]): string {
  switch (status) {
    case "connected":
      return "var(--color-success-text)";
    case "off":
      return "var(--color-muted)";
    case "down":
      return "var(--color-danger)";
    default:
      return "var(--color-muted)";
  }
}
