import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../ui/icon/icon";
import { buildTimeline, type TimelineModel, type TraceStep, violationReason } from "../../lib/traceModel";
import type { Snapshot, TraceEntry } from "../../types";
import styles from "./activityPanel.module.css";

export interface ActivityPanelProps {
  trace: TraceEntry[];
  connection: "live" | "reconnecting" | "closed";
  snapshot?: Snapshot;
}

function nodeIcon(node: string) {
  switch (node) {
    case "plan":
      return <Icon name="MapPin" size={16} />;
    case "clarify":
      return <Icon name="Search" size={16} />;
    case "compose":
      return <Icon name="Pen" size={16} />;
    case "validate":
      return <Icon name="ShieldCheck" size={16} />;
    case "fallback":
      return <Icon name="Copy" size={16} />;
    case "execute":
      return <Icon name="Send" size={16} />;
    case "ingest":
      return <Icon name="Inbox" size={16} />;
    case "finalize":
      return <Icon name="CheckCircle" size={16} />;
    case "schedule":
      return <Icon name="Calendar" size={16} />;
    default:
      return <Icon name="MoreHorizontal" size={16} />;
  }
}

export function ActivityPanel({ trace, connection, snapshot }: ActivityPanelProps) {
  const model: TimelineModel = buildTimeline(
    trace,
    snapshot?.question ?? null,
    snapshot?.config.mode === "copilot",
    snapshot?.config.channel ?? undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    setShowJump(!nearBottom);
  }, []);

  const handleJump = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    handleScroll();
  }, [handleScroll, trace.length]);

  return (
    <section className={styles.panel} aria-label="Activity" data-testid="activity">
      <div className={styles.header}>
        <h2 className={styles.title}>Activity</h2>
        <div className={styles.connection}>
          <span className={styles.connectionDot} aria-hidden="true"></span>
          <span className={styles.connectionText}>
            {connection === "live" ? "Live" : connection === "reconnecting" ? "Reconnecting" : "Closed"}
          </span>
        </div>
      </div>

      <div className={styles.scrollWrapper}>
        <div
          data-scroll-container
          className={styles.wrap}
        ref={containerRef}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label="Activity feed"
      >
        {model.turns.map((turn) => (
          <div key={turn.turn} className={styles.turn}>
            <div className={styles.turnTitle}>{turn.title}</div>
            <ul className={styles.steps}>
              {turn.steps.map((step, index) => (
                <li
                  key={index}
                  data-step
                  className={[styles.step, step.node === "validate" && !step.validate?.ok && styles.stepBlocked].filter(Boolean).join(" ")}
                >
                  <div data-step-icon className={styles.stepMarker}>{nodeIcon(step.node)}</div>
                  <div className={styles.stepBody}>
                    <div data-step-title className={styles.stepLabel}>{step.label}</div>
                    {renderStepDetail(step, snapshot?.config.mode === "copilot")}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {model.terminal.map((step, index) => (
          <div key={`terminal-${index}`} className={styles.turn}>
            <div className={styles.turnTitle}>{step.label}</div>
            <ul className={styles.steps}>
              <li data-step className={styles.step}>
                <div data-step-icon className={styles.stepMarker}>{nodeIcon(step.node)}</div>
                <div className={styles.stepBody}>
                  <div data-step-title className={styles.stepLabel}>{step.label}</div>
                  {renderStepDetail(step, snapshot?.config.mode === "copilot")}
                </div>
              </li>
            </ul>
          </div>
        ))}
        {model.pending && (
          <div className={styles.turn}>
            <div className={styles.turnTitle}>{model.pending.label}</div>
            <ul className={styles.steps}>
              <li data-step className={styles.step}>
                <div data-step-icon className={styles.stepMarker}><Icon name="Send" size={16} /></div>
                <div className={styles.stepBody}>
                  <div data-step-title className={styles.stepLabel}>{model.pending.label}</div>
                </div>
              </li>
            </ul>
          </div>
        )}
        {model.turns.length === 0 && model.terminal.length === 0 && (
          <p className={styles.empty}>No activity yet.</p>
        )}
        </div>
        {showJump && (
          <button data-jump-to-latest className={styles.jumpToLatest} onClick={handleJump} type="button">
            Jump to latest
          </button>
        )}
      </div>

    </section>
  );
}

function renderStepDetail(step: TraceStep, copilot = false): ReactNode {
  switch (step.node) {
    case "plan":
      return (
        <div className={styles.detail}>
          <span className={styles.detailKind}>{step.plan?.kind ?? ""}</span>
          {step.plan?.price != null && (
            <span className={styles.detailPrice}>RM {step.plan.price}</span>
          )}
          <span className={styles.detailReason}>{step.plan?.reason ?? ""}</span>
        </div>
      );
    case "clarify":
      return step.clarify?.tools.length ? (
        <div className={styles.clarifyGroup}>
          <span className={styles.detailTools}>
            {step.clarify.tools.join(", ")}
          </span>
          {step.clarify.results && step.clarify.results.length > 0 ? (
            <div className={styles.clarifyResults}>
              {step.clarify.results.map((result, index) => (
                <details key={index} className={styles.expandableText}>
                  <summary className={styles.expandableSummary}>Show more</summary>
                  <p className={styles.expandableBody}>{result}</p>
                </details>
              ))}
            </div>
          ) : null}
        </div>
      ) : null;
    case "compose":
      return <span className={styles.detailAttempt}>Draft attempt {step.compose?.attempt ?? 1}</span>;
    case "validate": {
      const validate = step.validate;
      if (!validate) return null;
      if (validate.ok) {
        return (
          <span className={styles.checkPassed}>
            <Icon name="CheckCircle" size={12} aria-hidden="true" />
            Passed all rules
          </span>
        );
      }
      return (
        <div className={styles.checkBlocked}>
          <span className={styles.checkBlockedLabel}>Blocked</span>
          <ul className={styles.violationList}>
            {validate.codes.map((code, index) => (
              <li key={index} className={styles.violationItem}>
                {violationReason(code)}
              </li>
            ))}
          </ul>
          {validate.rejectedDraft && !copilot && (
            <blockquote className={styles.rejectedDraft}>
              <span className={styles.rejectedDraftLabel}>Draft that was blocked</span>
              <span className={styles.rejectedDraftText}>{validate.rejectedDraft}</span>
            </blockquote>
          )}
        </div>
      );
    }
    case "fallback":
      return <span className={styles.detailText}>A safe template was used instead.</span>;
    case "execute": {
      const exec = step.execute;
      if (!exec) return null;
      if (exec.relayed) {
        const detail =
          exec.action === "offer" && exec.price != null
            ? `Offer RM ${exec.price}`
            : "Message sent";
        return (
          <span className={styles.detailText}>
            {detail}{exec.edited ? " · edited by you" : ""}
          </span>
        );
      }
      if (exec.action === "accept") {
        return <span className={styles.detailText}>Deal accepted at {exec.price != null ? `RM ${exec.price}` : "the seller's price"}.</span>;
      }
      if (exec.action === "walk_away") {
        return <span className={styles.detailText}>The agent walked away.</span>;
      }
      if (exec.error) {
        return <span className={styles.detailText}>{exec.error}</span>;
      }
      return <span className={styles.detailText}>Offer sent at RM {exec.price ?? "—"}.</span>;
    }
    case "ingest": {
      const intent = step.ingest?.intent;
      if (!intent) return null;
      const parts: string[] = [];
      if (intent.price != null) parts.push(`Seller: RM ${intent.price}`);
      const signals: string[] = [];
      if (intent.accepted) signals.push("accepted");
      if (intent.walked_away) signals.push("walked away");
      if (intent.asks_budget) signals.push("asked your budget");
      if (intent.pressure) signals.push("pressure");
      if (intent.terms_changed) signals.push("changed terms");
      if (signals.length) parts.push(`(${signals.join(", ")})`);
      return parts.length ? <span className={styles.detailText}>{parts.join(" ")}.</span> : null;
    }
    case "finalize":
      return step.finalize?.outcome
        ? <span className={styles.detailText}>Outcome: {step.finalize.outcome}.</span>
        : null;
    case "schedule":
      return step.schedule
        ? <span className={styles.detailText}>{step.schedule.status}{step.schedule.startAt ? ` — booked ${step.schedule.startAt}` : ""}{step.schedule.detail ? `. ${step.schedule.detail}` : ""}</span>
        : null;
    default:
      return null;
  }
}
