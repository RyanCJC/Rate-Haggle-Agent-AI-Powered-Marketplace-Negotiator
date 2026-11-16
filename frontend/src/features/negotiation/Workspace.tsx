import { useCallback, useEffect, useState } from "react";
import { decide } from "../../api";
import { SummaryStrip } from "./SummaryStrip";
import { Conversation } from "./Conversation";
import { ApprovalPanel } from "./ApprovalPanel";
import { ActivityPanel } from "./ActivityPanel";
import { Deal } from "./Deal";
import { Tabs } from "../../ui/tabs/tabs";
import { Skeleton } from "../../ui/skeleton/skeleton";
import { Button } from "../../ui/button/button";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotFoundScreen } from "./NotFoundScreen";
import { CopilotComposer } from "./CopilotComposer";
import { CopilotItemPanel } from "../listing/CopilotItemPanel";
import { useNegotiation } from "../../useNegotiation";
import type { Mode } from "../../types";
import styles from "./workspace.module.css";

export function Workspace({
  runId,
  onHome: _onHome,
  onModeChange,
}: {
  runId: string;
  onHome: () => void;
  onModeChange: (mode: Mode | null) => void;
}) {
  const { snapshot, trace, error, connection, reopen } = useNegotiation(runId);
  const [approving, setApproving] = useState(false);
  const [declining, setDeclining] = useState(false);

  useEffect(() => {
    onModeChange(snapshot?.config.mode ?? null);
  }, [onModeChange, snapshot?.config.mode]);

  const notFound = !snapshot && error != null && /unknown/i.test(error);
  const onHome = useCallback(() => {
    window.location.hash = "";
  }, []);

  const handleApprove = useCallback(async () => {
    setApproving(true);
    try {
      await decide(runId, "approve");
      // decide() drives the graph to the next pause or the end; a subsequent
      // resume() would conflict when the graph already advanced, so we rely on
      // the SSE refresh loop to reflect the outcome instead.
    } finally {
      setApproving(false);
    }
  }, [runId]);

  const handleDecline = useCallback(async () => {
    setDeclining(true);
    try {
      await decide(runId, "decline");
    } finally {
      setDeclining(false);
    }
  }, [runId]);

  const handleRetry = useCallback(() => {
    reopen();
  }, [reopen]);

  if (notFound) {
    return <ErrorBoundary><NotFoundScreen onHome={onHome} /></ErrorBoundary>;
  }

  if (!snapshot) {
    return (
      <ErrorBoundary>
        <div className={styles.workspace}>
          <div className={styles.loading}>
            <Skeleton width="40%" height={20} />
            <Skeleton width="20%" height={16} className={styles.skeletonMargin} />
          </div>
          {error && (
            <div className={styles.errorState}>
              <p className={styles.errorMessage}>{error}</p>
              <Button variant="primary" onClick={handleRetry}>Retry</Button>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }

  const question = snapshot.question ?? null;
  const waitingForApproval = snapshot.status === "waiting_for_approval" && !!question;
  const showCloseGate = waitingForApproval && question?.gate === "close_deal";
  const showSellerReplyGate = waitingForApproval && question?.gate === "seller_reply";
  const isCopilot = snapshot.config.mode === "copilot";
  const pendingDraft =
    isCopilot &&
    showSellerReplyGate &&
    question?.gate === "seller_reply" &&
    snapshot.outcome !== "user_stopped" &&
    snapshot.status !== "finished"
      ? question.draft
      : null;
  const finalMessage =
    isCopilot && snapshot.status === "finished" && snapshot.outcome === "deal"
      ? [...snapshot.history].reverse().find(([role]) => role === "buyer")?.[1] ?? null
      : null;

  return (
    <ErrorBoundary>
      <div className={styles.workspace}>
        <SummaryStrip snapshot={snapshot} />

        {showCloseGate && question && (
          <ApprovalPanel
            question={question}
            onApprove={handleApprove}
            onDecline={handleDecline}
            inFlight={approving || declining}
            copilot={isCopilot}
          />
        )}

        {finalMessage && <FinalMessagePanel message={finalMessage} />}

        <div className={styles.split}>
          <div className={[styles.conversationCol, isCopilot && styles.conversationColCopilot].filter(Boolean).join(" ")}>
            <Conversation
              history={snapshot.history}
              typing={snapshot.status === "running"}
              pendingDraft={pendingDraft}
              copilot={isCopilot}
            />
            {isCopilot && (
              <CopilotComposer
                runId={runId}
                question={question?.gate === "seller_reply" ? question : null}
              />
            )}
          </div>
          <div className={styles.sideCol}>
            <Tabs
              items={[
                {
                  id: "activity",
                  label: "Activity",
                  panel: (
                    <ActivityPanel
                      trace={trace.map((item) => item.entry)}
                      connection={connection}
                      snapshot={snapshot}
                    />
                  ),
                },
                {
                  id: "deal",
                  label: "Deal",
                  panel: (
                    <Deal
                      snapshot={snapshot}
                      trace={trace.map((item) => item.entry)}
                      notFound={false}
                      onHome={onHome}
                    />
                  ),
                },
                ...(isCopilot
                  ? [{
                      id: "item",
                      label: "Item",
                      panel: <CopilotItemPanel snapshot={snapshot} />,
                    }]
                  : []),
              ]}
            />
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

function FinalMessagePanel({ message }: { message: string }) {
  const [notice, setNotice] = useState("");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setNotice("Copied");
    } catch {
      const field = document.getElementById("copilot-final-message");
      if (field instanceof HTMLTextAreaElement) {
        field.focus();
        field.select();
      }
      setNotice("Press Ctrl+C to copy");
    }
  };

  return (
    <section className={styles.finalMessage} aria-labelledby="final-message-title" data-testid="copilot-final-message-panel">
      <h2 id="final-message-title">Send this to the seller</h2>
      <label className={styles.srOnly} htmlFor="copilot-final-message">Final message</label>
      <textarea id="copilot-final-message" readOnly value={message} rows={3} />
      <Button type="button" variant="secondary" onClick={() => void copy()} data-testid="copilot-final-copy">
        Copy
      </Button>
      <p>Then agree a pickup time with the seller.</p>
      <span className={styles.srOnly} aria-live="polite">{notice}</span>
    </section>
  );
}
