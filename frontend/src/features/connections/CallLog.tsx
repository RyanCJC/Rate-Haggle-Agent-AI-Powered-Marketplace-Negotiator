import { Icon } from "../../ui/icon/icon";
import type { McpCall } from "../../types";
import { describeCall, formatDuration, groupCalls, type CallRow } from "../../lib/mcpModel";
import styles from "./callLog.module.css";

export interface CallLogProps {
  calls: McpCall[];
  note: string | null;
  compact?: boolean;
}

function hhmmss(iso: string): string {
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function CallLog({ calls, note, compact }: CallLogProps) {
  const rows: CallRow[] = groupCalls(calls);

  if (rows.length === 0) {
    return (
      <section className={styles.root} data-testid="call-log">
        <p className={styles.empty}>No MCP calls recorded for this run. The server may have restarted since.</p>
        {note && <p className={styles.note}>{note}</p>}
      </section>
    );
  }

  return (
    <section className={styles.root} data-testid="call-log">
      {note && <p className={styles.note}>{note}</p>}
      <ul className={[styles.list, compact && styles.compactList].filter(Boolean).join(" ")}>
        {rows.map((row, index) => {
          if (row.kind === "reopened") {
            return (
              <li key={index} className={[styles.row, styles.reopened].filter(Boolean).join(" ")} data-testid="call-reopened">
                <span className={styles.muted}>Conversation re-opened (resume)</span>
                <span className={styles.count}>{"\u00d7"}{row.count}</span>
              </li>
            );
          }
          const call = row.call;
          const isOk = call.ok;
          const resultClass = [styles.result, isOk ? styles.resultOk : styles.resultFail]
            .filter(Boolean)
            .join(" ");
          const resultLabel = isOk ? "ok" : `error: ${call.error ?? "unknown"}`;
          const summary = describeCall(call);
          const duration = formatDuration(call.ms);
          const tool = `${call.server}.${call.tool}`;
          return (
            <li key={index} className={styles.row} data-testid="call-row">
              <div className={styles.line1}>
                <time className={styles.time} title={call.ts}>
                  {hhmmss(call.ts)}
                </time>
                <span className={styles.tool}>
                  {tool}
                </span>
                <span className={resultClass} aria-label={resultLabel}>
                  {isOk ? (
                    <>
                      <Icon name="Check" size={12} aria-hidden="true" />
                      <span className={styles.visuallyHidden}>ok</span>
                    </>
                  ) : (
                    <>
                      <Icon name="X" size={12} aria-hidden="true" />
                      <span className={styles.errorText}>{call.error ?? "unknown"}</span>
                    </>
                  )}
                </span>
              </div>
              <div className={styles.line2}>
                <span className={styles.summary} title={summary}>
                  {summary}
                </span>
                <span className={styles.duration} title={`${duration}`}>
                  {duration}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
