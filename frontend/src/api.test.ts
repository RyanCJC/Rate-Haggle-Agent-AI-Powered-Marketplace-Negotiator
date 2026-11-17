import { afterEach, describe, expect, it, vi } from "vitest";
import { bookPickup, cancelPickup, getPickupOptions, replyToSeller } from "./api";

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
