import { Badge } from "../../ui/badge/badge";
import { Card } from "../../ui/card/card";
import { normalizeDescription, serverStatusColor, statusLabel } from "../../lib/mcpModel";
import type { McpServer } from "../../types";
import styles from "./serverCard.module.css";

export interface ServerCardProps {
  server: McpServer;
}

export function ServerCard({ server }: ServerCardProps) {
  const color = serverStatusColor(server.status);
  return (
    <Card padding="none" className={styles.root} data-testid={`server-${server.id}`}>
      <header className={styles.header} aria-label={`${server.name} connection`}>
        <span className={styles.nodeLabel} aria-hidden="true">
          Haggle agent
        </span>
        <span className={styles.connector} aria-hidden="true">
          <span className={styles.line} />
          <span className={styles.transport}>{server.transport}</span>
          <span className={styles.arrow} />
        </span>
        <div className={styles.identity}>
          <span className={styles.name} title={server.name}>
            {server.name}
          </span>
          <Badge variant="neutral" className={styles.statusBadge} data-testid={`server-${server.id}-status`}>
            <span
              className={[styles.dot, `dot--${server.status}`].filter(Boolean).join(" ")}
              style={{ color }}
              aria-hidden="true"
            />
            <span className={styles.statusText}>{statusLabel(server.status)}</span>
          </Badge>
        </div>
      </header>
      <hr className={styles.divider} />
      {server.status === "connected" ? (
        <ul className={styles.tools} data-testid="server-tools">
          {server.tools.map((tool) => (
            <li key={tool.name} className={styles.tool} data-testid={`tool-${tool.name}`}>
              <div className={styles.toolHead}>
                <span className={styles.toolName}>{tool.name}</span>
                <span className={styles.params}>{formatParams(tool.params)}</span>
              </div>
              <details className={styles.description}>
                <summary className={styles.summary}>{normalizeDescription(tool.description)}</summary>
                <p className={styles.fullDescription}>{tool.description}</p>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.offline}>
          {server.status === "off" ? "Not enabled on this server." : "Not responding."}
        </p>
      )}
    </Card>
  );
}

function formatParams(params: { name: string; type: string; required: boolean }[]): string {
  return params
    .map((param) => `${param.name}${param.required ? "" : "?"}: ${param.type}`)
    .join(", ");
}
