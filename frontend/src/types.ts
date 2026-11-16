export type Status =
  | "running"
  | "waiting_for_approval"
  | "finished"
  | "failed"
  | "stalled"
  | "lost";
export type Mode = "simulate" | "copilot";
export type Autonomy = "auto" | "approve_close";
export type Style = "aggressive" | "balanced" | "safe";
export type Theme = "system" | "light" | "dark";
export type ListingCategory = "monitors" | "phones" | "laptops" | "other";
export type FactStatus = "confirmed" | "claimed" | "conflicting" | "missing";
export type Question =
  | { gate: "close_deal"; price: string | null; draft?: string }
  | { gate: "seller_reply"; kind: "offer" | "question"; price: string | null; draft: string }
  | { gate: "book_pickup"; price: string | null; draft?: string };

export interface ItemFact {
  key: string;
  value: string | null;
  status: FactStatus;
  source: string;
  evidence: string | null;
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
    mode?: Mode;
    item_title?: string | null;
    seller_opening?: string | null;
    category?: ListingCategory | null;
    listing_text?: string | null;
    comparables?: string[] | null;
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
  facts: ItemFact[];
}

export interface StartBody {
  asking: number;
  budget: number;
  persona: string;
  style: Style;
  autonomy: Autonomy;
  mode?: Mode;
  item_title?: string | null;
  seller_opening?: string | null;
  category?: ListingCategory | null;
  listing_text?: string | null;
  comparables?: number[] | null;
}