import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../ui/icon/icon";
import { ConnectionsPanel } from "./ConnectionsPanel";
import styles from "./connectionsDrawer.module.css";

export interface ConnectionsDrawerProps {
  runId: string;
  runActive: boolean;
  open?: boolean;
}

export function ConnectionsDrawer({ runId, runActive, open: openProp = false }: ConnectionsDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(openProp);

  const close = useCallback(() => {
    setOpen(false);
    const trigger = triggerRef.current;
    if (trigger) trigger.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    },
    [close],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
    return undefined;
  }, [open, handleKeyDown]);

  const popoutUrl = `#/connections/${runId}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="connections-drawer"
        onClick={() => setOpen(true)}
        data-testid="open-connections"
      >
        <Icon name="Plug" size={16} aria-hidden="true" />
        <span>Connections</span>
      </button>
      {open && (
        <div
          className={styles.backdrop}
          onClick={close}
          aria-hidden="true"
        />
      )}
      {open && (
        <div
          className={[styles.drawer, styles.drawerOpen].filter(Boolean).join(" ")}
          id="connections-drawer"
          role="dialog"
          aria-label="Connections"
          aria-modal="false"
        >
          <header className={styles.drawerHeader}>
            <span className={styles.drawerTitle}>Connections</span>
            <a
              href={popoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.popout}
              data-testid="connections-popout"
            >
              Open in a new window <Icon name="ExternalLink" size={14} aria-hidden="true" />
            </a>
            <button
              type="button"
              className={styles.closeButton}
              onClick={close}
              data-testid="close-connections"
              aria-label="Close"
            >
              <Icon name="X" size={14} aria-hidden="true" />
              <span className={styles.closeLabel}>Close</span>
            </button>
          </header>
          <div className={styles.content}>
            <ConnectionsPanel runId={runId} layout="drawer" runActive={runActive} />
          </div>
        </div>
      )}
    </>
  );
}
