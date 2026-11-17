import type {
  CancelPickupResult,
  Deal,
  PickupOptions,
  Preferences,
  Snapshot,
  StartBody,
  BookedPickup,
} from "./types";
import { getProfileId } from "./lib/profile";

const BASE: string = import.meta.env.VITE_API_URL ?? "/api";

export interface ApiError extends Error {
  status: number;
  messages?: string[];
  kind?: "unavailable";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let detail = response.statusText;
    let messages: string[] | undefined;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (response.status === 422 && Array.isArray(body.detail)) {
        messages = body.detail.flatMap((entry: unknown): string[] => {
          if (typeof entry === "string") return [entry];
          if (entry && typeof entry === "object" && "msg" in entry && typeof entry.msg === "string") {
            const location = "loc" in entry && Array.isArray(entry.loc)
              ? entry.loc.filter((part): part is string => typeof part === "string").slice(-1)[0]
              : undefined;
            return [location ? `${location}: ${entry.msg}` : entry.msg];
          }
          return [];
        });
        detail = "Please check your input";
      } else if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (body.detail !== undefined) {
        detail = JSON.stringify(body.detail);
      }
    } catch {
      // keep the status text
    }
    const error = new Error(detail) as ApiError;
    error.status = response.status;
    if (response.status === 503) error.kind = "unavailable";
    if (messages && messages.length) {
      error.messages = messages;
    }
    throw error;
  }
  return (await response.json()) as T;
}

export const startRun = (body: StartBody) => {
  const headers = body.mode === "copilot" ? { "X-Profile-Id": getProfileId() } : undefined;
  return request<{ id: string }>("/negotiations", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
};

function profileHeaders(): HeadersInit {
  return { "X-Profile-Id": getProfileId() };
}

export const getPreferences = () =>
  request<Preferences>("/profile/preferences", { headers: profileHeaders() });

export const putPreferences = (preferences: Preferences) =>
  request<Preferences>("/profile/preferences", {
    method: "PUT",
    headers: profileHeaders(),
    body: JSON.stringify(preferences),
  });

export const getDeals = () =>
  request<{ deals: Deal[] }>("/profile/deals", { headers: profileHeaders() });

export const getSimilar = (title: string, category: string, signal?: AbortSignal) => {
  const params = new URLSearchParams({ title, category });
  return request<{ deals: Deal[] }>(`/profile/similar?${params}`, {
    headers: profileHeaders(),
    signal,
  });
};

export const forgetDeal = (runId: string) =>
  request<{ removed: boolean }>(`/profile/deals/${encodeURIComponent(runId)}`, {
    method: "DELETE",
    headers: profileHeaders(),
  });

export const clearProfile = () =>
  request<{ removed: number }>("/profile", {
    method: "DELETE",
    headers: profileHeaders(),
  });

export const getRun = (id: string) => request<Snapshot>(`/negotiations/${id}`);

export const decide = (id: string, verdict: "approve" | "decline") =>
  request<{ accepted: boolean }>(`/negotiations/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ verdict }),
  });

export const replyToSeller = (id: string, reply: string, sentText?: string) =>
  request<{ accepted: boolean }>(`/negotiations/${id}/reply`, {
    method: "POST",
    body: JSON.stringify({ reply, ...(sentText !== undefined ? { sent_text: sentText } : {}) }),
  });

export const stopRun = (id: string) =>
  request<{ accepted: boolean }>(`/negotiations/${id}/stop`, { method: "POST" });

export const resumeRun = (id: string) =>
  request<{ accepted: boolean }>(`/negotiations/${id}/resume`, { method: "POST" });

export const getPickupOptions = (id: string, count = 5) =>
  request<PickupOptions>(`/negotiations/${id}/pickup/options?count=${count}`);

export const bookPickup = (id: string, startAt: string) =>
  request<BookedPickup>(`/negotiations/${id}/pickup`, {
    method: "POST",
    body: JSON.stringify({ start_at: startAt }),
  });

export const cancelPickup = (id: string) =>
  request<CancelPickupResult>(`/negotiations/${id}/pickup`, { method: "DELETE" });

export const eventsUrl = (id: string) => `${BASE}/negotiations/${id}/events`;