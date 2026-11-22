import { useCallback, useEffect, useState } from "react";
import { Tabs, type TabItem } from "../../ui/tabs/tabs";
import { Button } from "../../ui/button/button";
import { Card } from "../../ui/card/card";
import { ServerCard } from "./ServerCard";
import { CallLog } from "./CallLog";
import { SellerViewPanel } from "./SellerViewPanel";
import { LoadError } from "./LoadError";
import { getConnections, getMcpCalls, getSellerView } from "../../api";
import { usePolling } from "../../lib/usePolling";
import type { McpServer } from "../../types";
import styles from "./connectionsPanel.module.css";

type Layout = "drawer" | "page";

export interface ConnectionsPanelProps {
  runId?: string | null;
  layout: Layout;
  runActive: boolean;
}

function serverNodes(servers: McpServer[] | null) {
  return (servers ?? []).map((server) => (
    <li key={server.id} className={styles.serverItem}>
      <ServerCard server={server} />
    </li>
  ));
}

export function ConnectionsPanel({ runId, layout, runActive }: ConnectionsPanelProps) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [serversError, setServersError] = useState<unknown | null>(null);
  const [serversLoading, setServersLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("calls");

  const loadServers = useCallback(async () => {
    setServersLoading(true);
    try {
      const { servers: next } = await getConnections();
      setServers(next);
      setServersError(null);
    } catch (problem) {
      setServersError(problem);
      setServers(null);
    } finally {
      setServersLoading(false);
    }
  }, []);

  // Fetch the servers once on mount so the drawer/page is never stuck in
  // "Loading servers…". Retry is available via the LoadError button.
  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const calls = usePolling(
    useCallback(async () => {
      if (!runId) return { calls: [], note: null };
      return getMcpCalls(runId);
    }, [runId]),
    2000,
    Boolean(runId && runActive),
  );

  const seller = usePolling(
    useCallback(async () => {
      if (!runId) return { kind: "not-marketplace" } as const;
      return getSellerView(runId);
    }, [runId]),
    2000,
    Boolean(runId && runActive),
  );

  const hasCalls = Boolean(runId);
  const hasSeller = Boolean(runId);

  const serversPanel = (
    <>
      {serversLoading ? (
        <p className={styles.muted} data-testid="servers-loading">
          Loading servers…
        </p>
      ) : serversError != null ? (
        <LoadError message="Could not load MCP information." onRetry={loadServers} />
      ) : (
        <ul className={styles.serverList}>{serverNodes(servers)}</ul>
      )}
    </>
  );

  const callsPanel = hasCalls ? (
    <section className={styles.section}>
      {layout === "page" && <h2 className={styles.sectionTitle}>Calls</h2>}
      {calls.loading ? (
        <p className={styles.muted}>Loading calls…</p>
      ) : calls.error != null || calls.data == null ? (
        <p className={styles.muted}>
          {sellerNotFound(calls.error)
            ? "This negotiation was not found."
            : "Could not load MCP calls."}
        </p>
      ) : (
        <>
          <CallLog calls={calls.data.calls} note={calls.data.note ?? null} compact={layout === "drawer"} />
          {!runActive && (
            <Button type="button" variant="secondary" size="sm" onClick={calls.refresh}>
              Refresh
            </Button>
          )}
        </>
      )}
    </section>
  ) : null;

  const sellerPanel = hasSeller ? (
    <section className={styles.section}>
      {seller.loading ? (
        <p className={styles.muted}>Loading seller's view…</p>
      ) : seller.error != null ? (
        <p className={styles.muted}>
          {sellerNotFound(seller.error) ? "This negotiation was not found." : "Could not load the seller's view."}
        </p>
      ) : seller.data ? (
        <SellerViewPanel view={seller.data} showHeading={layout === "page"} />
      ) : null}
    </section>
  ) : null;

  if (layout === "drawer") {
    // Tab order: Calls first (default), then Servers, then Seller's view.
    const items: TabItem[] = [
      { id: "calls", label: "Calls", panel: <Card padding="lg">{callsPanel}</Card> },
      { id: "servers", label: "Servers", panel: <Card padding="lg">{serversPanel}</Card> },
    ];
    if (hasSeller) items.push({ id: "seller", label: "Seller's view", panel: <Card padding="lg">{sellerPanel}</Card> });
    return <Tabs items={items} activeId={activeTab} onChange={setActiveTab} />;
  }

  // page layout
  return (
    <div className={styles.page}>
      <section className={styles.column}>
        <h2 className={styles.sectionTitle}>Servers</h2>
        {serversPanel}
        {callsPanel}
      </section>
      {hasSeller && <section className={styles.column}>{sellerPanel}</section>}
    </div>
  );
}

function sellerNotFound(error: unknown): boolean {
  const apiError = error as Partial<{ status: number }>;
  return apiError.status === 404;
}
