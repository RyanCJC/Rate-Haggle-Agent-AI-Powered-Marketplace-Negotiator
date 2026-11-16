import { afterEach, describe, expect, it, vi } from "vitest";
import { replyToSeller } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("replyToSeller 422 errors", () => {
  it("attaches plain-language validation messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: ["Do not mention your budget."] }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(replyToSeller("run-1", "seller reply", "edited draft")).rejects.toMatchObject({
      message: "Please check your input",
      messages: ["Do not mention your budget."],
    });
  });

  it("uses the generic input message for body-validation detail objects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: [{ loc: ["body", "reply"], msg: "too long" }] }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(replyToSeller("run-1", "seller reply")).rejects.toMatchObject({
      message: "Please check your input",
    });
  });
});
