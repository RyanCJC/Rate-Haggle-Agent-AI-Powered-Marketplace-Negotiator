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
export type PickupHours = "any" | "morning" | "afternoon" | "evening";
export type Theme = "system" | "light" | "dark";
export type ListingCategory =
  | "monitors"
  | "phones"
  | "laptops"
  | "cameras"
  | "consoles"
  | "furniture"
  | "appliances"
  | "other";
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

export interface BookedPickup {
  status: "booked";
  start_at: string;
}

export interface PickupOptions {
  slots: string[];
  labels: string[];
  message: string | null;
  pickup: BookedPickup | null;
}

export type CancelPickupResult = { status: "cancelled" | "not_found" };

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
    category_guessed?: boolean;
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
  memory_notes?: string[];
}

export interface Preferences {
  style: Style | null;
  pickup_hours: PickupHours;
  pickup_area: string | null;
}

export type DealOutcome =
  | "deal"
  | "we_walk"
  | "seller_walks"
  | "extraction_miss"
  | "timeout"
  | "user_declined"
  | "user_stopped";

export interface Deal {
  run_id: string;
  item_title: string;
  category: ListingCategory | null;
  asking: string;
  final_price: string | null;
  outcome: DealOutcome;
  mode: "copilot";
  rounds: number;
  created_at: string;
  similarity: number | null;
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