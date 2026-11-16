import { factLabel, factStatusLabel, marketCheck } from "../../lib/listing";
import type { FactStatus, Snapshot } from "../../types";
import { Badge } from "../../ui/badge/badge";
import { Card } from "../../ui/card/card";
import { MarketCheckCard } from "./MarketCheckCard";
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
  return "None";
}

export function CopilotItemPanel({ snapshot }: CopilotItemPanelProps) {
  const facts = snapshot.facts;
  const allUnknown = facts.every((fact) => fact.status === "missing");
  const comparables = snapshot.config.comparables ?? [];
  const prices = comparables.map(Number);
  const hasMarketCheck =
    prices.length >= 2 &&
    marketCheck(prices, Number(snapshot.config.asking), Number(snapshot.config.budget)) !== null;

  return (
    <section className={styles.panel} aria-label="Item facts" data-testid="copilot-item-panel">
      <p className={styles.summary}>
        {allUnknown
          ? "No listing text was given, so the agent states no item details and asks instead."
          : "The agent states only these details."}
      </p>
      <div className={styles.tableWrap} data-testid="item-facts-container">
        <table className={styles.table} data-testid="item-facts-table">
          <caption className={styles.visuallyHidden}>Facts about the item</caption>
          <thead>
            <tr>
              <th scope="col">Fact</th>
              <th scope="col">Value</th>
              <th scope="col">Status</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {facts.map((fact) => (
              <tr key={fact.key} data-testid={`item-fact-${fact.key}`}>
                <th scope="row">{factLabel(fact.key)}</th>
                <td>{fact.value || "Unknown"}</td>
                <td>
                  <Badge
                    variant={STATUS_VARIANT[fact.status]}
                    className={styles.status}
                    data-testid={`fact-status-${fact.key}`}
                  >
                    {factStatusLabel(fact.status)}
                  </Badge>
                </td>
                <td>
                  <span>{sourceLabel(fact.source)}</span>
                  {fact.evidence && (
                    <details className={styles.evidence}>
                      <summary>Evidence</summary>
                      <q>{fact.evidence}</q>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
