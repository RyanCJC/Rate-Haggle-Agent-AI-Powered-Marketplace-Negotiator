export type Status =
  | "running"
  | "waiting_for_approval"
  | "finished"
  | "failed"
  | "stalled"
  | "lost";
export type Autonomy = "auto" | "approve_close";
export type Style = "aggressive" | "balanced" | "safe";
export type Theme = "system" | "light" | "dark";

export interface Question {
  gate: "close_deal" | "book_pickup";
  price: string | null;
  draft?: string;
}

export interface Pickup {
  status: string;
  start_at?: string;
  detail?: string;
}

export interface TraceEntry {
  node: string;
  [key: string]: unknown;
}

export interface Snapshot {
  id: string;
  status: Status;
  config: {
    asking: string;
    budget: string;
    persona: string;
    style: Style;
    autonomy: Autonomy;
    seed: number;
  };
  error: string | null;
  question: Question | null;
  outcome: string | null;
  final_price: string | null;
  pickup: Pickup | null;
  approvals: string[];
  history: [string, string][];
  our_offers: string[];
  seller_prices: string[];
  trace: TraceEntry[];
}

export interface StartBody {
  asking: number;
  budget: number;
  persona: string;
  style: Style;
  autonomy: Autonomy;
}