import { PriceLadder } from "./PriceLadder";
import { DealOutcome } from "./DealOutcome";
import { NotFoundScreen } from "./NotFoundScreen";
import { Card } from "../../ui/card/card";
import type { Snapshot, TraceEntry } from "../../types";
import styles from "./deal.module.css";

export interface DealProps {
  snapshot: Snapshot | null;
  trace: TraceEntry[];
  notFound: boolean;
  onHome: () => void;
}

export function Deal({ snapshot, trace, notFound, onHome }: DealProps) {
  if (notFound) {
    return <NotFoundScreen onHome={onHome} />;
  }
  if (!snapshot) {
    return null;
  }

  const { status, final_price, config } = snapshot;
  const asking = Number(config.asking);
  const limit = Number(config.budget);
  const dealPrice = final_price == null ? null : Number(final_price);

  return (
    <section className={styles.deal}>
      <PriceLadder trace={trace} asking={asking} limit={limit} dealPrice={dealPrice} />
      {status === "finished" ? (
        <DealOutcome snapshot={snapshot} asking={asking} dealPrice={dealPrice} onHome={onHome} />
      ) : (
        <Card padding="lg" className={styles.placeholder}>
          Deal details appear here when a negotiation finishes.
        </Card>
      )}
    </section>
  );
}
