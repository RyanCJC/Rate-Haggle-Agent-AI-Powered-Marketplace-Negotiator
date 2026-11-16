import type { Snapshot, StartBody } from "./types";

const BASE: string = import.meta.env.VITE_API_URL ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      // keep the status text
    }
    throw new Error(detail);
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

export const resumeRun = (id: string) =>
  request<{ accepted: boolean }>(`/negotiations/${id}/resume`, { method: "POST" });

export const eventsUrl = (id: string) => `${BASE}/negotiations/${id}/events`;