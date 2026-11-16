import { useCallback, useState } from "react";
import { Card } from "../../ui/card/card";
import { Button } from "../../ui/button/button";
import { savings, pickupLine } from "../../lib/format";
import type { Snapshot } from "../../types";
import styles from "./dealOutcome.module.css";

export interface DealOutcomeProps {
  snapshot: Snapshot;
  asking: number;
  dealPrice: number | null;
  onHome: () => void;
}

interface DealReceiptProps {
  snapshot: Snapshot;
  asking: number;
  dealPrice: number;
  onHome: () => void;
}

interface DealCalmProps {
  snapshot: Snapshot;
  onHome: () => void;
}

export function DealOutcome({ snapshot, asking, dealPrice, onHome }: DealOutcomeProps) {
  const { outcome, final_price } = snapshot;

  if (outcome === "deal" && dealPrice != null && final_price != null) {
    return <DealReceipt snapshot={snapshot} asking={asking} dealPrice={dealPrice} onHome={onHome} />;
  }

  return <DealCalm snapshot={snapshot} onHome={onHome} />;
}

function DealReceipt({ snapshot, asking, dealPrice, onHome }: DealReceiptProps) {
  const { final_price, pickup, approvals } = snapshot;
  const saved = savings(String(asking), final_price);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const lines: string[] = [];
    lines.push("Haggle deal");
    lines.push(`Asking RM ${asking.toLocaleString()}`);
    lines.push(`Final price RM ${Number(final_price).toLocaleString()}`);
    if (saved) lines.push(`Saved RM ${saved.amount} (${saved.percent}%)`);
    const pickupText = pickupLine(pickup);
    if (pickupText) lines.push(pickupText);
    if (approvals.length) lines.push("You approved the close.");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }, [asking, final_price, saved, pickup, approvals]);

  return (
    <section className={styles.outcome}>
      <Card padding="lg" className={[styles.card, styles.receipt].filter(Boolean).join(" ")}>
        <h2 className={styles.title}>Deal agreed</h2>
        <p className={styles.price}>
          RM <span className={styles.priceNumber}>{Number(dealPrice).toLocaleString()}</span>
        </p>
        {saved && (
          <p className={styles.savings}>
            RM {saved.amount} below the asking price ({saved.percent}%)
          </p>
        )}
        <hr className={styles.perforation} />
        <p className={styles.pickup}>
          {pickup ? pickupLine(pickup) : "Pickup not booked."}
        </p>
        <p className={styles.approvals}>
          {approvals.length ? "You approved the close." : "Agreement recorded."}
        </p>
        <Button
          variant="ghost"
          onClick={handleCopy}
          className={styles.copyButton}
        >
          {copied ? "Copied" : "Copy summary"}
        </Button>
      </Card>
      <Button variant="primary" onClick={onHome} className={styles.continueButton}>
        Back to home
      </Button>
    </section>
  );
}

function DealCalm({ snapshot, onHome }: DealCalmProps) {
  const { outcome, error } = snapshot;
  const labelMap: Record<string, { title: string; body: string }> = {
    user_declined: {
      title: "You declined the deal",
      body: "Nothing was booked. The seller keeps the listing.",
    },
    we_walk: {
      title: "The agent walked away",
      body: "The offer stayed below what the seller would accept.",
    },
    seller_walks: {
      title: "The seller walked away",
      body: "The seller ended the negotiation.",
    },
    stalled: {
      title: "The negotiation was interrupted",
      body: "No agreement was reached in time.",
    },
    extraction_miss: {
      title: "The conversation broke down",
      body: "No agreement could be recorded.",
    },
    timeout: {
      title: "No agreement in time",
      body: "The negotiation ran out of rounds.",
    },
  };
  const info = labelMap[outcome ?? ""] || {
    title: "No deal",
    body: error || "The negotiation did not reach an agreement.",
  };

  const isFailed = outcome === "failed" || outcome === "lost";

  return (
    <section className={styles.outcome}>
      <Card padding="lg" className={styles.card}>
        <h2 className={styles.title}>{info.title}</h2>
        <p className={styles.body}>{info.body}</p>
        {isFailed && error && (
          <p className={styles.errorDetail}>{error}</p>
        )}
      </Card>
      {!isFailed && (
        <Button variant="primary" onClick={onHome} className={styles.continueButton}>
          Continue
        </Button>
      )}
    </section>
  );
}
