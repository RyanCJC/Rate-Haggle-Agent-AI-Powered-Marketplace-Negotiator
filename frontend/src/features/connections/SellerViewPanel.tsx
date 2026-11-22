import { formatRm } from "../../lib/format";
import { personaLabel } from "../../lib/mcpModel";
import type { SellerViewResult } from "../../types";
import styles from "./sellerViewPanel.module.css";

export interface SellerViewPanelProps {
  view: SellerViewResult;
  showHeading?: boolean;
}

export function SellerViewPanel({ view, showHeading = true }: SellerViewPanelProps) {
  if (view.kind === "not-marketplace") {
    return (
      <section className={styles.root} data-testid="seller-view" aria-label="Seller's view">
        <p className={styles.body}>This run does not use the marketplace server. Start a Copilot run with the marketplace channel to see the seller's side.</p>
      </section>
    );
  }

  const { data } = view;
  const messages = data.messages ?? [];

  return (
    <section className={styles.root} data-testid="seller-view" aria-label="Seller's view">
      {showHeading && (
        <header className={styles.header}>
          <h2 className={styles.title}>Seller's view</h2>
          <p className={styles.subline}>
            Simulated marketplace
            {data.persona ? ` · ${personaLabel(data.persona)}` : ""}
            {data.asking !== null ? ` · asking ${formatRm(data.asking)}` : ""}
          </p>
        </header>
      )}
      {!showHeading && (
        <p className={styles.subline}>
          Simulated marketplace
          {data.persona ? ` · ${personaLabel(data.persona)}` : ""}
          {data.asking !== null ? ` · asking ${formatRm(data.asking)}` : ""}
        </p>
      )}
      {messages.length === 0 ? (
        <p className={styles.empty}>Nothing has been sent yet.</p>
      ) : (
        <ul className={styles.transcript} aria-label="Conversation transcript">
          {messages.map((message, index) => {
            const isSeller = message.from === "seller";
            return (
              <li key={index} className={[styles.message, isSeller ? styles.messageSeller : styles.messageBuyer].filter(Boolean).join(" ")}>
                <span className={styles.label}>{isSeller ? "You (seller)" : "Buyer (Haggle)"}</span>
                <span className={styles.turn}>turn {message.turn}</span>
                <p className={styles.text}>{message.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
