import { Button } from "../../ui/button/button";
import styles from "./loadError.module.css";

export interface LoadErrorProps {
  message?: string;
  onRetry: () => void;
}

export function LoadError({ message = "Could not load MCP information.", onRetry }: LoadErrorProps) {
  return (
    <section className={styles.root} role="alert" aria-label="Load error" data-testid="load-error">
      <p className={styles.message}>{message}</p>
      <Button type="button" variant="secondary" onClick={onRetry} data-testid="load-error-retry">
        Retry
      </Button>
    </section>
  );
}
