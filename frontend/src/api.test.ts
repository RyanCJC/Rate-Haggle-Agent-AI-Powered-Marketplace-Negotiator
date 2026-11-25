import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, resetApiBaseForTesting, setApiBaseForTesting } from "./api";
import { bookPickup, cancelPickup, getPickupOptions, replyToSeller, retryRun } from "./api";

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

  describe("pickup API", () => {
    it("requests options and posts a selected time", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ slots: [], labels: [], message: null, pickup: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "booked", start_at: "2026-03-03T10:00:00+08:00" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await getPickupOptions("run-1", 3);
      await bookPickup("run-1", "2026-03-03T10:00:00+08:00");

      expect(fetchMock.mock.calls[0][0]).toBe("/api/negotiations/run-1/pickup/options?count=3");
      expect(fetchMock.mock.calls[1][0]).toBe("/api/negotiations/run-1/pickup");
      expect(fetchMock.mock.calls[1][1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({ start_at: "2026-03-03T10:00:00+08:00" }),
      });
    });

    it("deletes a booking and preserves HTTP status on errors", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "cancelled" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ detail: "That time was just taken." }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(cancelPickup("run-1")).resolves.toEqual({ status: "cancelled" });
      await expect(bookPickup("run-1", "2026-03-03T10:00:00+08:00")).rejects.toMatchObject({
        status: 409,
        message: "That time was just taken.",
      });
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

describe("apiUrl", () => {
  afterEach(() => {
    resetApiBaseForTesting();
  });

  it("falls back to /api when VITE_API_BASE is unset", () => {
    setApiBaseForTesting("/api");
    expect(apiUrl("/negotiations")).toBe("/api/negotiations");
    expect(apiUrl("/profile/deals")).toBe("/api/profile/deals");
  });

  it("uses VITE_API_BASE without trailing slash", () => {
    setApiBaseForTesting("https://a.vercel.app");
    expect(apiUrl("/negotiations")).toBe("https://a.vercel.app/negotiations");
    expect(apiUrl("/profile/similar?title=x&category=y")).toBe(
      "https://a.vercel.app/profile/similar?title=x&category=y",
    );
  });

  it("strips trailing slash from VITE_API_BASE", () => {
    setApiBaseForTesting("https://a.vercel.app/");
    expect(apiUrl("/negotiations")).toBe("https://a.vercel.app/negotiations");
    expect(apiUrl("/profile/deals/123")).toBe("https://a.vercel.app/profile/deals/123");
  });

  it("strips multiple trailing slashes", () => {
    setApiBaseForTesting("https://a.vercel.app///");
    expect(apiUrl("/negotiations")).toBe("https://a.vercel.app/negotiations");
  });
});

describe("retryRun", () => {
  it("posts to the retry endpoint and accepts a 202", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryRun("run-1")).resolves.toEqual({ accepted: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/negotiations/run-1/retry");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("propagates 404 for an unknown run", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryRun("run-1")).rejects.toMatchObject({ status: 404, message: "Not found" });
  });

  it("propagates 409 when the run is not retryable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: "conflict" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(retryRun("run-1")).rejects.toMatchObject({ status: 409, message: "conflict" });
  });
});
