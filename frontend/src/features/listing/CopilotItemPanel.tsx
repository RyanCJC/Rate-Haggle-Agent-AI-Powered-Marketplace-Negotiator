import { factLabel, factStatusLabel, marketCheck } from "../../lib/listing";
import { categoryLabel } from "../../lib/categories";
import type { FactStatus, Snapshot } from "../../types";
import { Badge } from "../../ui/badge/badge";
import { Card } from "../../ui/card/card";
import { MarketCheckCard } from "./MarketCheckCard";
import { parseEvidence } from "../../lib/pickup";
import styles from "./copilotItemPanel.module.css";

interface CopilotItemPanelProps {
  snapshot: Snapshot;
}

const STATUS_VARIANT: Record<FactStatus, "success" | "neutral" | "warning"> = {
  confirmed: "success",
  claimed: "neutral",
  conflicting: "warning",
  missing: "neutral",
};

function sourceLabel(source: string): string {
  const sources = new Set(source.split("+"));
  if (sources.has("listing") && sources.has("seller_chat")) return "Listing and seller chat";
  if (sources.has("listing")) return "Listing";
  if (sources.has("seller_chat")) return "Seller chat";
  return "";
}

export function CopilotItemPanel({ snapshot }: CopilotItemPanelProps) {
  const facts = snapshot.facts;
  const allUnknown = facts.every((fact) => fact.status === "missing");
  const comparables = snapshot.config.comparables ?? [];
  const prices = comparables.map(Number);
  const hasMarketCheck =
    prices.length >= 2 &&
    marketCheck(prices, Number(snapshot.config.asking), Number(snapshot.config.budget)) !== null;
  const category = snapshot.config.category;
  const categoryGuessed = snapshot.config.category_guessed;

  return (
    <section className={styles.panel} aria-label="Item facts" data-testid="copilot-item-panel">
      {category && (
        <p className={styles.category} data-testid="item-category">
          {categoryLabel(category)}{categoryGuessed ? " (guessed from the title)" : ""}
        </p>
      )}
      <p className={styles.summary}>
        {allUnknown
          ? "No listing text was given, so the agent states no item details and asks instead."
          : "The agent states only these details."}
      </p>
      <div className={styles.tableWrap} data-testid="item-facts-container">
        <div className={styles.facts} role="list" data-testid="item-facts-list">
          {facts.map((fact) => {
            const unknown = fact.status === "missing";
            const evidence = unknown ? [] : parseEvidence(fact.evidence);
            const source = unknown ? "" : sourceLabel(fact.source);
            return (
              <article
                key={fact.key}
                className={styles.fact}
                role="listitem"
                data-testid={`item-fact-${fact.key}`}
              >
                <div className={styles.factHeading}>
                  <h3>{factLabel(fact.key)}</h3>
                  <Badge
                    variant={STATUS_VARIANT[fact.status]}
                    className={styles.status}
                    data-testid={`fact-status-${fact.key}`}
                  >
                    {factStatusLabel(fact.status)}
                  </Badge>
                </div>
                <p className={styles.value}>{unknown ? "—" : fact.value || "—"}</p>
                {!unknown && (source || evidence.length > 0) && (
                  <div className={styles.evidenceLine}>
                    {source && <span className={styles.source}>{source}</span>}
                    {evidence.length > 0 && (
                      <details className={styles.evidence} data-testid={`fact-evidence-${fact.key}`}>
                        <summary>Evidence</summary>
                        {evidence.map((entry, index) => (
                          <span key={`${entry.source}-${index}`} className={styles.evidenceQuote}>
                            <span>{entry.source}</span> <q>{entry.quote}</q>
                          </span>
                        ))}
                      </details>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
      {snapshot.memory_notes && snapshot.memory_notes.length > 0 && (
        <Card padding="md" className={styles.historyCard} data-testid="item-memory-notes">
          <h2>From your history</h2>
          <ul>
            {snapshot.memory_notes.map((note, index) => (
              <li key={`${note}-${index}`}>{note.replace(/^-\s*/, "")}</li>
            ))}
          </ul>
          <p>Used for tone only. Never shared with the seller.</p>
        </Card>
      )}
      {hasMarketCheck && (
        <MarketCheckCard
          prices={prices}
          asking={Number(snapshot.config.asking)}
          limit={Number(snapshot.config.budget)}
        />
      )}
      <Card padding="md" className={styles.note}>
        Facts come from the listing you pasted and from what the seller says. Your own edits to a draft are not checked against them.
      </Card>
    </section>
  );
}
