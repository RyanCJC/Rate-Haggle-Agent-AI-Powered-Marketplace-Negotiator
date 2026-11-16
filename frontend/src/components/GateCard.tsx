import { gateTitle } from "../state";
import type { Question } from "../types";

interface Props {
  question: Question;
  busy: boolean;
  onAnswer: (verdict: "approve" | "decline") => void;
}

export function GateCard({ question, busy, onAnswer }: Props) {
  return (
    <section className="card gate" aria-live="assertive">
      <h2>{gateTitle(question)}</h2>
      <p className="muted">
        {question.gate === "close_deal"
          ? "The agent is ready to close this deal. Nothing is final until you approve."
          : "The deal is agreed. Approve to book the pickup slot in the calendar."}
      </p>
      {question.draft && <blockquote>{question.draft}</blockquote>}
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => onAnswer("approve")}>
          Approve
        </button>
        <button disabled={busy} onClick={() => onAnswer("decline")}>
          Decline
        </button>
      </div>
    </section>
  );
}