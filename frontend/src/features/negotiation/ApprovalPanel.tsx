import { useCallback, useEffect, useRef, useState } from "react";
import type { Question } from "../../types";
import { Button } from "../../ui/button/button";
import { formatRm } from "../../lib/format";
import styles from "./approvalPanel.module.css";

export interface ApprovalPanelProps {
  question: Question | null;
  onApprove: () => void;
  onDecline: () => void;
  inFlight: boolean;
}

export function ApprovalPanel({ question, onApprove, onDecline, inFlight }: ApprovalPanelProps) {
  const approveRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(!!question);
    if (question) {
      void new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
        approveRef.current?.focus();
      });
    }
  }, [question]);

  const handleApprove = useCallback(() => {
    onApprove();
  }, [onApprove]);
  const handleDecline = useCallback(() => {
    onDecline();
  }, [onDecline]);

  if (!question || !mounted) return null;

  const price = question.price === null ? null : Number(question.price);

  return (
    <section className={styles.panel} aria-labelledby="approval-title">
      <h2 id="approval-title" className={styles.title}>
        {price === null ? "Agent’s closing offer" : `Accept RM ${price.toLocaleString()}?`}
      </h2>
      <p className={styles.price}>
        {question.price === null ? "Price not stated" : formatRm(question.price)}
      </p>
      {question.draft && (
        <div className={styles.message}>
          <p className={styles.messageText}>{question.draft}</p>
        </div>
      )}
      <p className={styles.hint}>Nothing is final until you approve.</p>
      <div className={styles.actions}>
        <Button
          ref={approveRef}
          variant="primary"
          onClick={handleApprove}
          disabled={inFlight}
          loading={inFlight}
        >
          Approve
        </Button>
        <Button variant="secondary" onClick={handleDecline} disabled={inFlight}>
          Decline
        </Button>
      </div>
      <p className={styles.enterHint} aria-hidden="true">
        Press Enter to approve
      </p>
    </section>
  );
}
