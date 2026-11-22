import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SellerViewPanel } from "./SellerViewPanel";
import type { SellerViewResult } from "../../types";

const view: SellerViewResult = {
  kind: "ok",
  data: {
    found: true,
    asking: 1200,
    persona: "flexible",
    messages: [
      { turn: 0, from: "seller", text: "Hello, RM 1,200, can pick up anytime.", price: null },
      { turn: 1, from: "buyer", text: "How about RM 820?", price: 820 },
      { turn: 2, from: "seller", text: "Lowest I can go is RM 991.", price: 991 },
    ],
  },
};

describe("SellerViewPanel", () => {
  it("renders the transcript with seller and buyer labels", () => {
    const html = renderToStaticMarkup(<SellerViewPanel view={view} />);
    expect(html).toContain("Seller&#x27;s view");
    expect(html).toContain("Simulated marketplace · Flexible seller · asking RM 1,200");
    expect(html).toContain("You (seller)");
    expect(html).toContain("Buyer (Haggle)");
    expect(html).toContain("Hello, RM 1,200, can pick up anytime.");
    expect(html).toContain("How about RM 820?");
    expect(html).toContain("Lowest I can go is RM 991.");
    expect(html).toContain("turn 0");
    expect(html).toContain("turn 1");
    expect(html).toContain("turn 2");
  });

  it("does not repeat prices outside the message text", () => {
    const html = renderToStaticMarkup(<SellerViewPanel view={view} />);
    const textOnly = html.replace(/<[^>]*>/g, " ");
    expect(textOnly).not.toContain("Price:");
    expect(textOnly).not.toContain("RM 820.0");
  });

  it("hides the heading when showHeading is false (drawer layout)", () => {
    const html = renderToStaticMarkup(<SellerViewPanel view={view} showHeading={false} />);
    expect(html).not.toContain("<h2");
    expect(html).toContain("Simulated marketplace · Flexible seller · asking RM 1,200");
    expect(html).toContain("You (seller)");
    expect(html).toContain("Buyer (Haggle)");
  });

  it("renders the heading by default (page layout)", () => {
    const html = renderToStaticMarkup(<SellerViewPanel view={view} />);
    expect(html).toContain("Seller&#x27;s view");
  });

  it("renders not-marketplace state", () => {
    const html = renderToStaticMarkup(<SellerViewPanel view={{ kind: "not-marketplace" }} />);
    expect(html).toContain("This run does not use the marketplace server.");
    expect(html).toContain("Start a Copilot run with the marketplace channel to see the seller&#x27;s side.");
  });

  it("renders empty state when there are no messages", () => {
    const html = renderToStaticMarkup(<SellerViewPanel view={{ kind: "ok", data: { found: true, asking: null, persona: "flexible", messages: [] } }} />);
    expect(html).toContain("Nothing has been sent yet.");
  });
});
