import type { Snapshot } from "../../types";
import styles from "./conversation.module.css";

export interface ConversationProps {
  history: Snapshot["history"];
  typing: boolean;
}

const AVATAR: Record<string, { label: string; className: string }> = {
  buyer: { label: "A", className: styles.avatarAgent },
  seller: { label: "S", className: styles.avatarSeller },
};

export function Conversation({ history, typing }: ConversationProps) {
  return (
    <div className={styles.conversation}>
      <div className={styles.messages}>
        {history.map(([role, text], index) => {
          const avatar = AVATAR[role] ?? AVATAR.seller;
          return (
            <div
              key={index}
              className={[styles.message, role === "buyer" ? styles.messageBuyer : styles.messageSeller].filter(Boolean).join(" ")}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <div className={avatar.className} aria-hidden="true">
                {avatar.label}
              </div>
              <div className={styles.bubble}>
                <p className={styles.text}>{text}</p>
              </div>
            </div>
          );
        })}
        {typing && (
          <div className={styles.typing}>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span aria-hidden="true"></span>
            <span className={styles.srOnly}>Agent is writing</span>
          </div>
        )}
      </div>
      <div className={styles.live} aria-live="polite">
        {history.length > 0 ? `New message: ${history[history.length - 1][1]}` : ""}
      </div>
    </div>
  );
}
