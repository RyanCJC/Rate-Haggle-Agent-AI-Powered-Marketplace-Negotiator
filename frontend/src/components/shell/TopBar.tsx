import { Logo } from "../../ui/logo/logo";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./topbar.module.css";

export function TopBar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbar__inner}>
        <div className={styles.topbar__brand}>
          <Logo size={28} aria-label="Haggle" />
          <span className={styles.topbar__title}>Haggle</span>
        </div>
        <div className={styles.topbar__actions}>
          <span className={styles.topbar__chip}>Practice mode</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
