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

const marketplaceQuestion: Question = {
  gate: "seller_reply",
  kind: "offer",
  price: "900",
  draft: "How about RM 900?",
  channel: "marketplace",
};

const marketplaceQuestionQuestion: Question = {
  gate: "seller_reply",
  kind: "question",
  price: null,
  draft: "What is your lowest price?",
  channel: "marketplace",
};

describe("CopilotComposer marketplace variant", () => {
  it("renders Send to marketplace and End negotiation, no paste textarea", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={marketplaceQuestion} />);
    expect(html).toContain("Send to marketplace");
    expect(html).toContain("End negotiation");
    expect(html).not.toContain("Paste the seller");
    expect(html).not.toContain('data-testid="copilot-reply"');
    expect(html).toContain('data-testid="marketplace-send"');
    expect(html).toContain('data-testid="copilot-draft"');
    expect(html).toContain("Sent through the simulated marketplace when you approve.");
  });

  it("renders question heading for marketplace question gate", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={marketplaceQuestionQuestion} />);
    expect(html).toContain("The agent wants to ask the seller");
    expect(html).not.toContain("Paste the seller");
    expect(html).toContain("Sent through the simulated marketplace when you approve.");
  });

  it("keeps edit disclosure behavior for marketplace", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={marketplaceQuestion} />);
    expect(html).toContain("Edit before sending");
    expect(html).toContain('data-testid="copilot-edit"');
    expect(html).toContain("Your edit is checked for your limit and price rules, not for item facts.");
  });

  it("does not render the Copy button for the draft in marketplace mode", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={marketplaceQuestion} />);
    expect(html).toContain("Draft to send");
    expect(html).toContain('data-testid="copilot-draft"');
    expect(html).not.toContain("Copy");
    expect(html).not.toContain('data-testid="copilot-copy"');
  });

  it("does not render the Copy button for the draft in marketplace question mode", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={marketplaceQuestionQuestion} />);
    expect(html).not.toContain("Copy");
    expect(html).not.toContain('data-testid="copilot-copy"');
  });
});

describe("CopilotComposer", () => {
  it("renders question gate UI", () => {
    const html = renderToStaticMarkup(<CopilotComposer runId="run-1" question={question} />);
    expect(html).toContain("The agent wants to ask the seller");
    expect(html).toContain("What is your lowest price for this item?");
    expect(html).toContain('data-testid="copilot-draft"');
    expect(html).toContain("Draft to send");
    expect(html).toContain("Paste the seller&#x27;s reply");
    expect(html).toContain('data-testid="copilot-reply"');
    expect(html).toContain("Copy");
    expect(html).toContain('data-testid="copilot-copy"');
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
