import { formatRm } from "../../lib/format";
import { marketCheck } from "../../lib/listing";
import { Card } from "../../ui/card/card";
import styles from "./marketCheckCard.module.css";

interface MarketCheckCardProps {
  prices: number[];
  asking: number;
  limit: number;
}

function comparison(subject: string, percent: number): string {
  if (percent === 0) return `${subject} is at the median.`;
  const direction = percent > 0 ? "above" : "below";
  return `${subject} is ${Math.abs(percent)}% ${direction} the median.`;
}

export function MarketCheckCard({ prices, asking, limit }: MarketCheckCardProps) {
  const result = marketCheck(prices, asking, limit);
  if (!result) return null;

  return (
    <Card
      padding="md"
      className={styles.card}
      data-testid="market-check"
      aria-label="Market check"
    >
      <h3 className={styles.title}>Market check</h3>
      <p className={styles.median}>Median {formatRm(result.median)}</p>
      <p>{comparison("The asking price", result.askingPercent)}</p>
      <p>{comparison("Your limit", result.limitPercent)}</p>
      <p className={styles.count}>Based on {result.count} prices you entered.</p>
    </Card>
  );
}
