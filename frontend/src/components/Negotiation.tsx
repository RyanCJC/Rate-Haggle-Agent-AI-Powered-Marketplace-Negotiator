import { useState } from "react";
import { decide, resumeRun } from "../api";
import { formatRm, STATUS_LABEL, stepLabel } from "../state";
import { useNegotiation } from "../useNegotiation";
import { Chat } from "./Chat";
import { GateCard } from "./GateCard";
import { Outcome } from "./Outcome";

const message = (problem: unknown) => (problem instanceof Error ? problem.message : String(problem));

export function Negotiation({ runId, onHome }: { runId: string; onHome: () => void }) {
  const { snapshot, trace, error, refresh, reopen } = useNegotiation(runId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function answer(verdict: "approve" | "decline") {
    setBusy(true);
    setActionError(null);
    try {
      await decide(runId, verdict);
      await refresh();
    } catch (problem) {
      setActionError(message(problem));
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    setActionError(null);
    try {
      await resumeRun(runId);
      reopen();
    } catch (problem) {
      setActionError(message(problem));
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return error ? (
      <section className="card">
        <p className="error" role="alert">
          {error}
        </p>
        <button onClick={onHome}>Back</button>
      </section>
    ) : (
      <p className="muted">Loading…</p>
    );
  }

  const { status, config } = snapshot;
  const working = status === "running";
  const latest = trace.length ? stepLabel(trace[trace.length - 1].entry.node) : "Starting";

  return (
    <div className="stack">
      <section className="card head">
        <div>
          <h1>Negotiation</h1>
          <p className="muted">
            Asking {formatRm(config.asking)} · Your budget {formatRm(config.budget)} ·{" "}
            {config.autonomy === "auto" ? "Fully automatic" : "Ask before closing"}
          </p>
        </div>
        <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>
      </section>

      <Chat history={snapshot.history} working={working} />
      {working && <p className="muted live">{latest}…</p>}

      {status === "waiting_for_approval" && snapshot.question && (
        <GateCard question={snapshot.question} busy={busy} onAnswer={answer} />
      )}

      {status === "finished" && <Outcome snapshot={snapshot} />}

      {status === "failed" && (
        <section className="card">
          <h2>Something went wrong</h2>
          <p className="error">{snapshot.error}</p>
        </section>
      )}

      {status === "stalled" && (
        <section className="card">
          <h2>This negotiation was interrupted</h2>
          <p className="muted">It stopped part-way, for example after a restart. Nothing was lost.</p>
          <button className="primary" disabled={busy} onClick={resume}>
            Continue
          </button>
        </section>
      )}

      {status === "lost" && (
        <section className="card">
          <h2>No data found for this negotiation</h2>
        </section>
      )}

      {(actionError || error) && (
        <p className="error" role="alert">
          {actionError ?? error}
        </p>
      )}
      {status !== "running" && status !== "waiting_for_approval" && (
        <button onClick={onHome}>New negotiation</button>
      )}
    </div>
  );
}