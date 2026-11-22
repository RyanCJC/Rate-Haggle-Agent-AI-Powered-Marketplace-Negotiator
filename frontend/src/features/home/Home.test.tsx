import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListingCategory } from "../../types";
import { CATEGORIES } from "../../lib/categories";
import { Home, CategoryOtherHint, ChannelChoice } from "./Home";

const EXPECTED_CATEGORIES: ListingCategory[] = [
  "monitors",
  "phones",
  "laptops",
  "cameras",
  "consoles",
  "furniture",
  "appliances",
  "other",
];

const EXPECTED_LABELS: Record<ListingCategory, string> = {
  monitors: "Monitor",
  phones: "Phone",
  laptops: "Laptop",
  cameras: "Camera",
  consoles: "Game console",
  furniture: "Furniture",
  appliances: "Home appliance",
  other: "Other",
};

describe("Home category values", () => {
  it("declares all 8 category values in source order", () => {
    const values = CATEGORIES.map((c) => c.value);
    expect(values).toEqual(EXPECTED_CATEGORIES);
  });

  it("uses the correct labels from the backend category definitions", () => {
    const labels = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
    expect(labels).toEqual(EXPECTED_LABELS);
  });

  it("keeps 'other' as the last category", () => {
    const values = CATEGORIES.map((c) => c.value);
    expect(values[values.length - 1]).toBe("other");
  });
});

vi.mock("../../api", () => ({
  getCapabilities: vi.fn().mockResolvedValue({ marketplace_channel: false }),
  getPreferences: vi.fn(),
  getSimilar: vi.fn(),
  startRun: vi.fn(),
}));

// readRecents() touches window.localStorage during render; provide a stub.
Object.defineProperty(globalThis, "window", {
  value: { localStorage: { getItem: () => null, setItem: () => {} } },
  writable: true,
});

describe("Home mode-specific rendering", () => {
  it("Practice mode does not contain &mdash; or &amp;mdash; or General guidance only", () => {
    const html = renderToStaticMarkup(<Home onStart={() => {}} />);
    expect(html).not.toContain("&mdash;");
    expect(html).not.toContain("&amp;mdash;");
    expect(html).not.toContain("General guidance only");
  });

  it("Copilot mode with capabilities off does not show channel choice", () => {
    const html = renderToStaticMarkup(
      <Home onStart={() => {}} mode="copilot" capabilities={{ marketplace_channel: false }} />,
    );
    expect(html).not.toContain("How messages reach the seller");
  });

  it("Copilot mode with capabilities on shows the channel choice", () => {
    const html = renderToStaticMarkup(
      <Home onStart={() => {}} mode="copilot" capabilities={{ marketplace_channel: true }} />,
    );
    expect(html).toContain("How messages reach the seller");
    expect(html).toContain("I send them myself (real seller)");
    expect(html).toContain("Haggle sends them after I approve (simulated marketplace)");
  });

  it("Copilot mode with capabilities on shows seller opening field by default (manual)", () => {
    const html = renderToStaticMarkup(
      <Home onStart={() => {}} mode="copilot" capabilities={{ marketplace_channel: true }} />,
    );
    expect(html).toContain("Seller\u2019s first message");
  });

  it("ChannelChoice marketplace renders both options", () => {
    const html = renderToStaticMarkup(
      <ChannelChoice channel="marketplace" onChannelChange={vi.fn()} />,
    );
    expect(html).toContain("How messages reach the seller");
    expect(html).toContain("I send them myself (real seller)");
    expect(html).toContain("Haggle sends them after I approve (simulated marketplace)");
  });

  it("Copilot marketplace selected hides seller opening field and shows persona picker", () => {
    const html = renderToStaticMarkup(
      <Home onStart={() => {}} mode="copilot" channel="marketplace" capabilities={{ marketplace_channel: true }} />,
    );
    expect(html).not.toContain("Seller\u2019s first message");
    expect(html).toContain("Flexible seller");
    expect(html).toContain("The seller is simulated. You approve every message before it is sent.");
  });

  it("ChannelChoice manual renders both options", () => {
    const html = renderToStaticMarkup(
      <ChannelChoice channel="manual" onChannelChange={vi.fn()} />,
    );
    expect(html).toContain("I send them myself (real seller)");
    expect(html).toContain("Haggle sends them after I approve (simulated marketplace)");
  });

  it("Copilot mode with category other contains General guidance only", () => {
    const html = renderToStaticMarkup(
      <CategoryOtherHint isCopilot={true} category={"other"} />,
    );
    expect(html).toContain("General guidance only");
  });

  it("Practice mode with category other does not contain General guidance only", () => {
    const html = renderToStaticMarkup(
      <CategoryOtherHint isCopilot={false} category={"other"} />,
    );
    expect(html).not.toContain("General guidance only");
  });

  it("Copilot mode with non-other category does not contain General guidance only", () => {
    const html = renderToStaticMarkup(
      <CategoryOtherHint isCopilot={true} category={"monitors"} />,
    );
    expect(html).not.toContain("General guidance only");
  });
});
