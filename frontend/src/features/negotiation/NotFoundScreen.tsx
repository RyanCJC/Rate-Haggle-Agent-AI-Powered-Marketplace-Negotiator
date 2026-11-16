import { Button } from "../../ui/button/button";
import styles from "./notFound.module.css";

export interface NotFoundScreenProps {
  onHome: () => void;
}

export function NotFoundScreen({ onHome }: NotFoundScreenProps) {
  return (
    <section className={styles.notFound} role="alert" aria-label="Negotiation not found">
      <h2 className={styles.title}>Not found</h2>
      <p className={styles.body}>There is no negotiation with that ID.</p>
      <Button variant="primary" onClick={onHome} className={styles.backButton}>
        Back
      </Button>
    </section>
  );
}
