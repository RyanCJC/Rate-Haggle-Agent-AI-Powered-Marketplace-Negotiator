import type { Snapshot } from "../../types";
import { formatRm } from "../../lib/format";
import { Badge } from "../../ui/badge/badge";
import styles from "./summaryStrip.module.css";

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  finished: "Finished",
  failed: "Failed",
  stalled: "Stalled",
  lost: "Lost",
};

export interface SummaryStripProps {
  snapshot: Snapshot;
}

export function SummaryStrip({ snapshot }: SummaryStripProps) {
  const { config, our_offers, seller_prices, status } = snapshot;
  const asking = Number(config.asking);
  const bestOffer = our_offers.length ? Number(our_offers[our_offers.length - 1]) : null;
  const sellerLatest = seller_prices.length ? Number(seller_prices[seller_prices.length - 1]) : null;
  const gap = bestOffer === null ? null : asking - bestOffer;

  const statusLabel = STATUS_LABEL[status] ?? status;

  return (
    <div className={styles.strip}>
      <div className={styles.cell}>
        <span className={styles.label}>Asking</span>
        <span className={styles.price}>{formatRm(config.asking)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.label}>Your limit</span>
        <span className={styles.price}>{formatRm(config.budget)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.label}>Best offer so far</span>
        <span className={styles.price}>{bestOffer === null ? "—" : formatRm(bestOffer)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.label}>Seller&rsquo;s latest</span>
        <span className={styles.price}>{sellerLatest === null ? "—" : formatRm(sellerLatest)}</span>
      </div>
      <div className={styles.cell}>
        <span className={styles.label}>Gap to close</span>
        <span className={styles.price}>{gap === null ? "—" : formatRm(gap)}</span>
      </div>
      <div className={styles.status} data-testid="run-status">
        <Badge variant="neutral" />
        <span className={styles.statusValue}>{statusLabel}</span>
      </div>
    </div>
  );
}
