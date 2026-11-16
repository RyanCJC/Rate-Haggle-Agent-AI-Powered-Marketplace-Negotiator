import { useCallback, useState } from "react";
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
import { useNegotiation } from "../../useNegotiation";
import styles from "./workspace.module.css";

export function Workspace({ runId, onHome: _onHome }: { runId: string; onHome: () => void }) {
  const { snapshot, trace, error, connection, reopen } = useNegotiation(runId);
  const [approving, setApproving] = useState(false);
  const [declining, setDeclining] = useState(false);

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

  return (
    <ErrorBoundary>
      <div className={styles.workspace}>
        <SummaryStrip snapshot={snapshot} />

        {waitingForApproval && question && (
          <ApprovalPanel
            question={question}
            onApprove={handleApprove}
            onDecline={handleDecline}
            inFlight={approving || declining}
          />
        )}

        <div className={styles.split}>
          <div className={styles.conversationCol}>
            <Conversation history={snapshot.history} typing={snapshot.status === "running"} />
          </div>
          <div className={styles.sideCol}>
            <Tabs
              items={[
                {
                  id: "activity",
                  label: "Activity",
                  panel: <ActivityPanel trace={trace.map((item) => item.entry)} connection={connection} />,
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
              ]}
            />
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
