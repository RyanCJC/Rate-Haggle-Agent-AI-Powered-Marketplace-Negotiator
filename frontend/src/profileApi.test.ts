import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProfile,
  forgetDeal,
  getDeals,
  getPreferences,
  getSimilar,
  putPreferences,
  startRun,
} from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function installProfileBrowser(): void {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: vi.fn(() => "a".repeat(32)),
      setItem: vi.fn(),
    },
  });
  vi.stubGlobal("crypto", { randomUUID: () => "b".repeat(8) + "-0000-0000-0000-000000000000" });
}

describe("profile memory API", () => {
  it("sends the browser profile header on profile requests and Copilot starts only", async () => {
    installProfileBrowser();
    const fetchMock = vi.fn().mockImplementation(
      () => new Response(JSON.stringify({ deals: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const prefs = { style: "safe" as const, pickup_hours: "evening" as const, pickup_area: "Bangsar" };

    await getPreferences();
    await putPreferences(prefs);
    await getDeals();
    await getSimilar("27 inch monitor", "monitors");
    await forgetDeal("run-1");
    await clearProfile();
    await startRun({
      asking: 1200,
      budget: 1000,
      persona: "flexible",
      style: "balanced",
      autonomy: "approve_close",
      mode: "copilot",
    });
    await startRun({
      asking: 1200,
      budget: 1000,
      persona: "flexible",
      style: "balanced",
      autonomy: "approve_close",
      mode: "simulate",
    });

    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      const headers = new Headers(init.headers);
      if (!url.endsWith("/negotiations")) {
        expect(headers.get("X-Profile-Id")).toBe("a".repeat(32));
      }
    }
    expect(new Headers(fetchMock.mock.calls[6][1].headers).get("X-Profile-Id")).toBe("a".repeat(32));
    expect(new Headers(fetchMock.mock.calls[7][1].headers).has("X-Profile-Id")).toBe(false);
  });

  it("keeps a validation message list and marks 503 errors as unavailable", async () => {
    installProfileBrowser();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: [{ loc: ["body", "pickup_area"], msg: "at most 80 characters" }] }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "profile memory is unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(putPreferences({
      style: null,
      pickup_hours: "any",
      pickup_area: "x".repeat(81),
    })).rejects.toMatchObject({
      status: 422,
      messages: ["pickup_area: at most 80 characters"],
    });
    await expect(getDeals()).rejects.toMatchObject({
      status: 503,
      kind: "unavailable",
      message: "profile memory is unavailable",
    });
  });
});
