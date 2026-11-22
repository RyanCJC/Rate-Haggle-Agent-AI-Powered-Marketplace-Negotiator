import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionsPanel } from "./ConnectionsPanel";

describe("ConnectionsPanel drawer tabs", () => {
  it("defaults to the Calls tab, with Servers and Seller's view panels hidden", () => {
    const html = renderToStaticMarkup(
      <ConnectionsPanel runId="abc123def456" layout="drawer" runActive={false} />,
    );
    // First tab in markup is Calls and it is selected.
    const firstTab = /<button[^>]*id="[^"]*-tab-calls"[^>]*aria-selected="true"/;
    expect(firstTab.test(html)).toBe(true);
    const serversTab = /<button[^>]*id="[^"]*-tab-servers"[^>]*aria-selected="false"/;
    expect(serversTab.test(html)).toBe(true);

    // Calls panel is visible (no hidden attribute); the others are hidden.
    const panelOf = (id: string): string | null => {
      const match = html.match(new RegExp(`<div[^>]*id="[^"]*-panel-${id}"[^>]*>`));
      return match ? match[0] : null;
    };

    const callsPanel = panelOf("calls");
    expect(callsPanel).toBeTruthy();
    expect(callsPanel!).not.toContain("hidden");

    const serversPanel = panelOf("servers");
    expect(serversPanel).toBeTruthy();
    expect(serversPanel!).toContain("hidden");

    const sellerPanel = panelOf("seller");
    expect(sellerPanel).toBeTruthy();
    expect(sellerPanel!).toContain("hidden");
  });

  it("does not render inner section headings in drawer layout (tabs name them)", () => {
    const html = renderToStaticMarkup(
      <ConnectionsPanel runId="abc123def456" layout="drawer" runActive={false} />,
    );
    // The drawer panels carry no inner <h2> headings; the tabs provide the labels.
    expect(html).not.toContain("<h2");
  });

  it("renders inner section headings in page layout", () => {
    const html = renderToStaticMarkup(
      <ConnectionsPanel runId="abc123def456" layout="page" runActive={false} />,
    );
    expect(html).toContain("Servers");
    expect(html).toContain("Calls");
    // the seller panel heading is rendered by SellerViewPanel once data loads;
    // it is covered by SellerViewPanel.test.tsx
  });

  it("renders a servers-loading testid while servers are loading", () => {
    const html = renderToStaticMarkup(
      <ConnectionsPanel runId={null} layout="page" runActive={false} />,
    );
    expect(html).toContain('data-testid="servers-loading"');
    expect(html).toContain("Loading servers…");
  });
});
