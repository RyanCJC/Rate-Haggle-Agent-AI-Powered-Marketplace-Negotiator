import type { Snapshot, StartBody } from "./types";

const BASE: string = import.meta.env.VITE_API_URL ?? "/api";

interface RequestError extends Error {
  messages?: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = response.statusText;
    let messages: string[] | undefined;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (response.status === 422 && Array.isArray(body.detail)) {
        if (body.detail.every((entry) => typeof entry === "string")) {
          messages = body.detail as string[];
        }
        detail = "Please check your input";
      } else if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (body.detail !== undefined) {
        detail = JSON.stringify(body.detail);
      }
    } catch {
      // keep the status text
    }
    const error = new Error(detail) as RequestError;
    if (messages && messages.length) {
      error.messages = messages;
    }
    throw error;
  }
  return (await response.json()) as T;
}

export const startRun = (body: StartBody) =>
  request<{ id: string }>("/negotiations", { method: "POST", body: JSON.stringify(body) });

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

export const eventsUrl = (id: string) => `${BASE}/negotiations/${id}/events`;