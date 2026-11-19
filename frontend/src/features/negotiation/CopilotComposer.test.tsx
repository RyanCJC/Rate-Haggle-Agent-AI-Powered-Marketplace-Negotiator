import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CopilotComposer } from "./CopilotComposer";
import type { Question } from "../../types";

const question: Question = {
  gate: "seller_reply",
  kind: "question",
  price: null,
  draft: "What is your lowest price for this item?",
};

const offerQuestion: Question = {
  gate: "seller_reply",
  kind: "offer",
  price: "900",
  draft: "How about RM 900?",
};

describe("CopilotComposer", () => {
  it("renders question gate UI", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={question} />);
    expect(html).toContain("The agent wants to ask the seller");
    expect(html).toContain("What is your lowest price for this item?");
    expect(html).toContain('data-testid="copilot-draft"');
    expect(html).toContain("Draft to send");
    expect(html).toContain("Paste the seller&#x27;s reply");
    expect(html).toContain('data-testid="copilot-reply"');
    expect(html).not.toContain("Next message");
  });

  it("renders offer gate UI unchanged", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={offerQuestion} />);
    expect(html).toContain("Next message");
    expect(html).toContain("How about RM 900?");
    expect(html).toContain('data-testid="copilot-draft"');
    expect(html).toContain("Draft to send");
    expect(html).toContain("Paste the seller&#x27;s reply");
    expect(html).toContain('data-testid="copilot-reply"');
    expect(html).not.toContain("The agent wants to ask the seller");
  });
});
