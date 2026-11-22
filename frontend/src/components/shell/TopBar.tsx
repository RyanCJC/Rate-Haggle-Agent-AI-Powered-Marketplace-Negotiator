import { Logo } from "../../ui/logo/logo";
import { Badge } from "../../ui/badge/badge";
import { ThemeToggle } from "./ThemeToggle";
import type { Mode } from "../../types";
import styles from "./topbar.module.css";

export function TopBar({ mode, activePage }: { mode: Mode | null; activePage: "profile" | "connections" | null }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbar__inner}>
        <div className={styles.topbar__brand}>
          <Logo size={28} aria-label="Haggle" />
          <span className={styles.topbar__title}>Haggle</span>
        </div>
        <div className={styles.topbar__actions}>
          <a
            className={[styles.topbar__link, activePage === "profile" && styles.topbar__linkActive].filter(Boolean).join(" ")}
            href="#/profile"
            aria-current={activePage === "profile" ? "page" : undefined}
          >
            Profile
          </a>
          <a
            className={[styles.topbar__link, activePage === "connections" && styles.topbar__linkActive].filter(Boolean).join(" ")}
            href="#/connections"
            aria-current={activePage === "connections" ? "page" : undefined}
          >
            Connections
          </a>
          {mode && (
            <Badge
              variant={mode === "copilot" ? "default" : "neutral"}
              data-testid="run-mode"
            >
              {mode === "copilot" ? "Copilot" : "Practice"}
            </Badge>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
