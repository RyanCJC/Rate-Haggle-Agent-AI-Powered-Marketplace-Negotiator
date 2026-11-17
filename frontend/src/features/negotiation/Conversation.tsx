import type { Snapshot } from "../../types";
import styles from "./conversation.module.css";

export interface ConversationProps {
  history: Snapshot["history"];
  typing: boolean;
  pendingDraft?: string | null;
  copilot?: boolean;
}

const AVATAR: Record<string, { label: string; className: string }> = {
  buyer: { label: "A", className: styles.avatarAgent },
  seller: { label: "S", className: styles.avatarSeller },
};

export function Conversation({ history, typing, pendingDraft, copilot = false }: ConversationProps) {
  return (
    <div
      className={[styles.conversation, copilot && styles.conversationCopilot].filter(Boolean).join(" ")}
      tabIndex={copilot ? 0 : undefined}
      role={copilot ? "region" : undefined}
      aria-label={copilot ? "Conversation history" : undefined}
      data-testid={copilot ? "conversation-card" : undefined}
    >
      <div className={styles.messages}>
        {history.map(([role, text], index) => {
          const avatar = AVATAR[role] ?? AVATAR.seller;
          return (
            <div
              key={index}
              className={[styles.message, role === "buyer" ? styles.messageBuyer : styles.messageSeller].filter(Boolean).join(" ")}
              style={{ animationDelay: `${index * 40}ms` }}
              data-testid="conversation-message"
            >
              <div className={avatar.className} aria-hidden="true">
                {avatar.label}
              </div>
              <div className={styles.bubble} data-testid="conversation-bubble">
                <p className={styles.text}>{text}</p>
              </div>
            </div>
          );
        })}
        {copilot && history.length === 0 && (
          <p className={styles.emptyHistory}>No messages sent yet.</p>
        )}
        {typing && (
          <div className={styles.typing} role="status" aria-label="Agent is writing">
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
          </div>
        )}
        {!copilot && pendingDraft && (
          <div className={styles.pendingDraft} data-testid="pending-draft">
            <span className={styles.pendingLabel}>Draft to send</span>
            <p className={styles.text}>{pendingDraft}</p>
          </div>
        )}
      </div>
      <div className={styles.live} aria-live="polite">
        {history.length > 0 ? `New message: ${history[history.length - 1][1]}` : ""}
      </div>
    </div>
  );
}
