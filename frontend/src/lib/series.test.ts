import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPriceSeries } from "./series";
import type { TraceEntry } from "../types";

function fsPath(urlPath: string): string {
  return urlPath.replace(/^\//, "").replace(/^([A-Za-z])\//, "$1:/");
}

function loadFixture(name: string): { trace: TraceEntry[]; config: { asking: string; budget: string }; final_price: string | null } {
  const path = fsPath(
    new URL(`../test/fixtures/${name}.json`, import.meta.url).pathname,
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

const finished = loadFixture("run-deal-finished");

describe("buildPriceSeries", () => {
  it("builds our offers and seller asks from the trace, not our_offers/seller_prices", () => {
    const series = buildPriceSeries(
      finished.trace,
      Number(finished.config.asking),
      Number(finished.config.budget),
      null,
    );
    expect(series.asking).toBe(1200);
    expect(series.limit).toBe(1000);
    expect(series.dealPrice).toBeNull();

    expect(series.ourOffers).toEqual([
      { round: 1, price: 820 },
      { round: 2, price: 835 },
      { round: 3, price: 860 },
    ]);

    expect(series.sellerAsks).toEqual([
      { round: 1, price: 991 },
      { round: 2, price: 905 },
      { round: 3, price: 880 },
    ]);
  });

  it("finished run series ends with the final deal price", () => {
    const series = buildPriceSeries(
      finished.trace,
      Number(finished.config.asking),
      Number(finished.config.budget),
      Number(finished.final_price),
    );
    expect(series.dealPrice).toBe(880);
    // Last seller ask should equal the deal price
    expect(series.sellerAsks[series.sellerAsks.length - 1].price).toBe(880);
    // Last offer should equal the deal price too
    expect(series.ourOffers[series.ourOffers.length - 1].price).toBe(860);
  });

  it("skips entries without a price", () => {
    const trace: TraceEntry[] = [
      { node: "execute", action: "offer", price: null },
      { node: "execute", action: "accept", price: "880" },
      { node: "ingest", intent: { price: null } },
    ];
    const series = buildPriceSeries(trace, 1200, 1000, null);
    expect(series.ourOffers).toEqual([]);
    expect(series.sellerAsks).toEqual([]);
  });

  it("rounds seller asks to the preceding offer round", () => {
    const trace: TraceEntry[] = [
      { node: "execute", action: "offer", price: "500" },
      { node: "ingest", intent: { price: "700" } },
      { node: "execute", action: "offer", price: "600" },
      { node: "ingest", intent: { price: "650" } },
    ];
    const series = buildPriceSeries(trace, 1200, 1000, null);
    expect(series.ourOffers).toEqual([
      { round: 1, price: 500 },
      { round: 2, price: 600 },
    ]);
    expect(series.sellerAsks).toEqual([
      { round: 1, price: 700 },
      { round: 2, price: 650 },
    ]);
  });
});
