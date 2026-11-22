import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinalMessagePanel } from "./Workspace";

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
