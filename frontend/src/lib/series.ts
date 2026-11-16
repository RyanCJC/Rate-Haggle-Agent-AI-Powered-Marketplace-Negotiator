import type { TraceEntry } from "../types";

export interface PricePoint {
  round: number;
  price: number;
}

export interface PriceSeries {
  asking: number;
  limit: number;
  ourOffers: PricePoint[];
  sellerAsks: PricePoint[];
  dealPrice: number | null;
}

export function buildPriceSeries(
  trace: TraceEntry[],
  asking: number,
  limit: number,
  dealPrice: number | null,
): PriceSeries {
  const ourOffers: PricePoint[] = [];
  const sellerAsks: PricePoint[] = [];
  let round = 0;

  for (const entry of trace) {
    if (entry.node === "execute" && entry.action === "offer") {
      const price = entry.price == null ? null : Number(entry.price);
      if (price != null) {
        round += 1;
        ourOffers.push({ round, price });
      }
      continue;
    }
    if (entry.node === "ingest") {
      const intent = entry.intent as { price?: unknown } | undefined;
      const price = intent?.price == null ? null : Number(intent.price);
      if (price != null && round > 0) {
        sellerAsks.push({ round, price });
      }
    }
  }

  return { asking, limit, ourOffers, sellerAsks, dealPrice };
}
