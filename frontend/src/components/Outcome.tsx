import { formatRm, outcomeLabel, pickupLine, savings } from "../state";
import type { Snapshot } from "../types";

export function Outcome({ snapshot }: { snapshot: Snapshot }) {
  const deal = snapshot.outcome === "deal";
  const saved = savings(snapshot.config.asking, snapshot.final_price);
  const pickup = pickupLine(snapshot.pickup);

  return (
    <section className={`card outcome ${deal ? "good" : ""}`}>
      <h2>{outcomeLabel(snapshot.outcome)}</h2>
      {deal && (
        <>
          <p className="price">{formatRm(snapshot.final_price)}</p>
          {saved && saved.amount > 0 && (
            <p className="muted">
              {formatRm(saved.amount)} ({saved.percent}%) below the {formatRm(snapshot.config.asking)}{" "}
              asking price
            </p>
          )}
        </>
      )}
      {snapshot.outcome === "user_declined" && <p className="muted">Nothing was booked.</p>}
      {pickup && <p>{pickup}</p>}
    </section>
  );
}