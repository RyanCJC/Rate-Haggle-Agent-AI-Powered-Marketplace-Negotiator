import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityPanel } from "./ActivityPanel";
import type { TraceEntry } from "../../types";

describe("ActivityPanel", () => {
  it("renders the clarify group heading and human tool labels", () => {
    const trace: TraceEntry[] = [
      { node: "clarify", tool: "get_listing" },
      { node: "clarify", tool: "get_market_stats" },
      { node: "clarify", tool: "search_knowledge" },
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "compose", attempt: 1 },
    ];
    const html = renderToStaticMarkup(<ActivityPanel trace={trace} connection="live" />);
    expect(html).toContain("Research before this offer");
    expect(html).toContain("Read the listing");
    expect(html).toContain("Checked market prices");
    expect(html).toContain("Searched buying guidance");
  });

  it("does not render a clarify heading when there are no clarify entries", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "compose", attempt: 1 },
    ];
    const html = renderToStaticMarkup(<ActivityPanel trace={trace} connection="live" />);
    expect(html).not.toContain("Research before this offer");
  });

  it("places the clarify group after Turn 2 text, never before", () => {
    const trace: TraceEntry[] = [
      { node: "plan", kind: "offer", price: "820", reason: "round 0" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "820" },
      { node: "ingest", intent: { price: "820", accepted: true, walked_away: false, asks_budget: false, pressure: false, terms_changed: false } },
      { node: "plan", kind: "offer", price: "835", reason: "counter" },
      { node: "clarify", step: 1, tool: "get_listing" },
      { node: "clarify", step: 2, tool: "get_market_stats" },
      { node: "clarify", step: 3, tool: "ask_seller" },
      { node: "compose", attempt: 1 },
      { node: "validate", ok: true, codes: [] },
      { node: "execute", action: "offer", price: "835" },
    ];
    const html = renderToStaticMarkup(<ActivityPanel trace={trace} connection="live" />);
    const headingCount = (html.match(/Research before this offer/g) ?? []).length;
    expect(headingCount).toBe(1);

    const turn2Index = html.indexOf("Turn 2");
    const headingIndex = html.indexOf("Research before this offer");
    expect(turn2Index).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeGreaterThan(turn2Index);
  });
});
