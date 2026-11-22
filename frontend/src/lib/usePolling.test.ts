import { describe, expect, it } from "vitest";
import { planPolling } from "./usePolling";

describe("planPolling", () => {
  const now = 1000;

  it("does not fetch and schedules nothing when inactive", () => {
    expect(planPolling({ active: false, intervalMs: 2000, lastFetchTime: null, now })).toEqual({
      fetchNow: false,
      nextIntervalMs: null,
    });
    expect(planPolling({ active: false, intervalMs: 2000, lastFetchTime: 500, now })).toEqual({
      fetchNow: false,
      nextIntervalMs: null,
    });
  });

  it("fetches immediately on the first tick when active", () => {
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: null, now })).toEqual({
      fetchNow: true,
      nextIntervalMs: 2000,
    });
  });

  it("does not fetch within the interval", () => {
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: 900, now })).toEqual({
      fetchNow: false,
      nextIntervalMs: 2000,
    });
  });

  it("fetches when the interval has elapsed", () => {
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: 900, now: 2900 })).toEqual({
      fetchNow: true,
      nextIntervalMs: 2000,
    });
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: 900, now: 2901 })).toEqual({
      fetchNow: true,
      nextIntervalMs: 2000,
    });
  });

  it("treats exactly one interval as due", () => {
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: 900, now: 2900 })).toEqual({
      fetchNow: true,
      nextIntervalMs: 2000,
    });
  });

  it("does not restart after a settled fetch within the interval", () => {
    // A fetch just completed at now-500 with a 2000 ms interval: not due yet.
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: 900, now: 1400 })).toEqual({
      fetchNow: false,
      nextIntervalMs: 2000,
    });
  });

  it("fetches again once the interval has elapsed after a settled fetch", () => {
    expect(planPolling({ active: true, intervalMs: 2000, lastFetchTime: 900, now: 2901 })).toEqual({
      fetchNow: true,
      nextIntervalMs: 2000,
    });
  });

  it("does not schedule anything when inactive even if overdue", () => {
    expect(planPolling({ active: false, intervalMs: 2000, lastFetchTime: 0, now: 99999 })).toEqual({
      fetchNow: false,
      nextIntervalMs: null,
    });
  });
});
