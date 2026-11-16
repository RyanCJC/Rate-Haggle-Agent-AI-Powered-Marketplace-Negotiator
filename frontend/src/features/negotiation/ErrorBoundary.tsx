import { Component, ErrorInfo, type ReactNode } from "react";
import { Button } from "../../ui/button/button";
import styles from "./errorBoundary.module.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(_error: Error): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally no logging to keep output clean; the error is surfaced in UI.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <section className={styles.boundary} role="alert" aria-label="Something went wrong">
          <h2 className={styles.title}>Something went wrong</h2>
          <p className={styles.body}>Reload to try again.</p>
          <Button variant="primary" onClick={() => window.location.reload()} className={styles.reload}>
            Reload
          </Button>
        </section>
      );
    }
    return this.props.children;
  }
}
