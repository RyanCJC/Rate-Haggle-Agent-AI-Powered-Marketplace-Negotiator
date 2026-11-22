import { Button } from "../../ui/button/button";
import { ConnectionsPanel } from "./ConnectionsPanel";
import styles from "./connectionsPage.module.css";

export interface ConnectionsPageProps {
  runId?: string | null;
}

export function ConnectionsPage({ runId }: ConnectionsPageProps) {
  const runActive = true;
  const shortId = runId ? runId.slice(0, 8) : null;

  if (!runId) {
    return (
      <section className={styles.page} aria-label="MCP servers">
        <header className={styles.header}>
          <h1 className={styles.title}>MCP servers</h1>
          <p className={styles.subline}>
            Haggle talks to these tools over the Model Context Protocol (stdio).
          </p>
        </header>
        <ConnectionsPanel runId={null} layout="page" runActive={runActive} />
      </section>
    );
  }

  return (
    <section className={styles.page} aria-label="Connections">
      <header className={styles.header}>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void (window.location.hash = `/run/${runId}`)}
            className={styles.backButton}
            data-testid="connections-back"
          >
            Back to negotiation
          </Button>
          <h1 className={styles.title}>
            Connections
            <span className={styles.runId}>· {shortId}</span>
          </h1>
        </div>
      </header>
      <ConnectionsPanel runId={runId} layout="page" runActive={runActive} />
    </section>
  );
}
