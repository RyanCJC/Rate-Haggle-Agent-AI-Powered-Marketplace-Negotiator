import { Logo } from "../../ui/logo/logo";
import { Badge } from "../../ui/badge/badge";
import { ThemeToggle } from "./ThemeToggle";
import type { Mode } from "../../types";
import styles from "./topbar.module.css";

export function TopBar({ mode }: { mode: Mode | null }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbar__inner}>
        <div className={styles.topbar__brand}>
          <Logo size={28} aria-label="Haggle" />
          <span className={styles.topbar__title}>Haggle</span>
        </div>
        <div className={styles.topbar__actions}>
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
