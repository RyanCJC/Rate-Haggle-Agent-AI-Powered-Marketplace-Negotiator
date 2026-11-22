import { describe, expect, it } from "vitest";
import { replyArguments } from "./replyPayload";

describe("replyPayload", () => {
  it("no sentText when edit unchanged", () => {
    const args = replyArguments("offer", "How about RM 900?", "How about RM 900?", "How about RM 900?");
    expect(args.reply).toBe("How about RM 900?");
    expect(args.sentText).toBeUndefined();
  });

  it("no sentText when draft differs but edit is empty", () => {
    const args = replyArguments("offer", "How about RM 900?", "How about RM 800?", "");
    expect(args.reply).toBe("How about RM 900?");
    expect(args.sentText).toBe("");
  });

  it("sentText is the edited draft when changed", () => {
    const args = replyArguments("offer", "How about RM 900?", "How about RM 800?", "Would RM 900 work?");
    expect(args.reply).toBe("How about RM 900?");
    expect(args.sentText).toBe("Would RM 900 work?");
  });

  it("kind does not affect sentText", () => {
    const args = replyArguments("question", "What is your price?", "What is your price?", "Would RM 900 work?");
    expect(args.sentText).toBe("Would RM 900 work?");
  });
});
