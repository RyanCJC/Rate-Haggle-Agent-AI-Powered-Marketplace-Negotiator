import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinalMessagePanel } from "./Workspace";
import { Workspace } from "./Workspace";
import type { Snapshot } from "../../types";
import * as api from "../../api";

const retryRun = vi.mocked(api.retryRun);

const freshSnapshot = (error_kind: string | null): Snapshot => ({
  id: "run-1",
  status: "failed",
  error: "The AI model was unavailable. Nothing was sent to the seller. Your progress is saved.",
  error_kind,
  config: { asking: "1200", budget: "1000", persona: "flexible", style: "balanced", autonomy: "auto", seed: 0 },
  question: null,
  outcome: null,
  final_price: null,
  pickup: null,
  approvals: [],
  history: [],
  our_offers: [],
  seller_prices: [],
  trace: [],
  facts: [],
});

let currentSnapshot: Snapshot | null;

vi.mock("../../useNegotiation", () => ({
  useNegotiation: () => ({
    snapshot: currentSnapshot,
    trace: [],
    error: null,
    connection: "live",
    refresh: vi.fn(),
    reopen: vi.fn(),
  }),
}));

vi.mock("../../api", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../../api");
  return { ...actual, retryRun: vi.fn(async () => ({ accepted: true })) };
});

beforeEach(() => {
  currentSnapshot = null;
  retryRun.mockClear();
});

describe("FinalMessagePanel", () => {
  const message = "Okay, RM 880 works for me. Deal.";

  it("manual channel shows the seller-facing panel", () => {
    const html = renderToStaticMarkup(
      <FinalMessagePanel message={message} onArrangePickup={() => {}} channel="manual" />,
    );
    expect(html).toContain("Send this to the seller");
    expect(html).toContain("Then agree a pickup time with the seller.");
    expect(html).toContain("Arrange pickup");
    expect(html).toContain('data-testid="copilot-final-copy"');
    expect(html).toContain(message);
  });

  it("absent channel shows the seller-facing panel", () => {
    const html = renderToStaticMarkup(<FinalMessagePanel message={message} onArrangePickup={() => {}} />);
    expect(html).toContain("Send this to the seller");
    expect(html).toContain("Then agree a pickup time with the seller.");
    expect(html).toContain('data-testid="copilot-final-copy"');
    expect(html).toContain(message);
  });

  it("marketplace channel shows the recorded-in-chat panel without Copy", () => {
    const html = renderToStaticMarkup(
      <FinalMessagePanel message={message} onArrangePickup={() => {}} channel="marketplace" />,
    );
    expect(html).toContain("Closing message");
    expect(html).toContain(
      "Recorded in the chat. The marketplace here is simulated, so there is no one to send it to.",
    );
    expect(html).toContain("Next: arrange a pickup time.");
    expect(html).toContain("Arrange pickup");
    expect(html).toContain('data-testid="final-arrange-pickup"');
    expect(html).not.toContain("Send this to the seller");
    expect(html).not.toContain("Then agree a pickup time with the seller.");
    expect(html).not.toContain('data-testid="copilot-final-copy"');
  });
});

describe("Workspace failed run", () => {
  it("shows the friendly message and a Retry button for llm_unavailable", () => {
    currentSnapshot = freshSnapshot("llm_unavailable");
    const html = renderToStaticMarkup(
      <Workspace runId="run-1" onHome={() => {}} onModeChange={() => {}} />,
    );
    expect(html).toContain("The AI model was unavailable. Nothing was sent to the seller. Your progress is saved.");
    expect(html).toContain('data-testid="run-retry"');
    expect(html).toContain("Retry");
  });

  it("keeps today's behaviour for other failure kinds", () => {
    currentSnapshot = freshSnapshot(null);
    const html = renderToStaticMarkup(
      <Workspace runId="run-1" onHome={() => {}} onModeChange={() => {}} />,
    );
    expect(html).not.toContain("The AI model was unavailable");
    expect(html).not.toContain('data-testid="run-retry"');
  });

  it("omits the Retry button when the run has not failed", () => {
    currentSnapshot = { ...freshSnapshot(null), status: "running" };
    const html = renderToStaticMarkup(
      <Workspace runId="run-1" onHome={() => {}} onModeChange={() => {}} />,
    );
    expect(html).not.toContain('data-testid="run-retry"');
  });
});
