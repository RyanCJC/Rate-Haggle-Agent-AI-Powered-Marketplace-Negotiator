import { useCallback, useEffect, useRef, useState } from "react";
import { eventsUrl, getRun } from "./api";
import { appendTrace, type TraceItem } from "./state";
import type { Snapshot, TraceEntry } from "./types";

export type ConnectionState = "live" | "reconnecting" | "closed";

export function useNegotiation(runId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [trace, setTrace] = useState<TraceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("reconnecting");
  const [epoch, setEpoch] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getRun(runId));
      setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [runId]);

  useEffect(() => {
    setSnapshot(null);
    setTrace([]);
    setError(null);
    setConnection("reconnecting");
    void refresh();

    const source = new EventSource(eventsUrl(runId));
    const soon = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void refresh(), 250);
    };
    source.addEventListener("open", () => setConnection("live"));
    source.addEventListener("error", () => setConnection("reconnecting"));
    source.addEventListener("trace", (event) => {
      const message = event as MessageEvent<string>;
      const entry = JSON.parse(message.data) as TraceEntry;
      setTrace((previous) => appendTrace(previous, Number(message.lastEventId), entry));
      setConnection("live");
      soon();
    });
    source.addEventListener("gate", () => void refresh());
    source.addEventListener("done", () => {
      void refresh();
      setConnection("closed");
      source.close(); // otherwise the browser would reconnect to a finished stream forever
    });
    // No onerror handler needed: the browser reconnects by itself and Last-Event-ID resumes it.

    return () => {
      window.clearTimeout(timer.current);
      setConnection("closed");
      source.close();
    };
  }, [runId, refresh, epoch]);

  const reopen = useCallback(() => setEpoch((n) => n + 1), []);
  return { snapshot, trace, error, connection, refresh, reopen };
}
