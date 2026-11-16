import { useCallback, useState, type FormEvent } from "react";
import { startRun } from "../../api";
import { Button } from "../../ui/button/button";
import { Card } from "../../ui/card/card";
import { formatRm } from "../../lib/format";
import type { Autonomy, Style } from "../../types";
import styles from "./home.module.css";

const PERSONAS = [
  { id: "flexible", label: "Flexible seller", hint: "Has room to move on price" },
  { id: "firm", label: "Firm seller", hint: "Rarely drops below asking" },
  { id: "evasive", label: "Evasive seller", hint: "Sometimes dodges the price" },
  { id: "pressure", label: "Pushy seller", hint: "Another buyer is coming later" },
  { id: "budget_prober", label: "Nosy seller", hint: "Keeps asking your budget" },
  { id: "term_changer", label: "Moving-target seller", hint: "Changes the price mid-way" },
  { id: "mixed_my_en", label: "Malay-English seller", hint: "Mixes Malay and English" },
  { id: "dishonest", label: "Bluffing seller", hint: "Tries tricks on the buyer" },
];

const STYLES: { value: Style; label: string; hint: string }[] = [
  { value: "aggressive", label: "Aggressive", hint: "Pushes harder for a low price" },
  { value: "balanced", label: "Balanced", hint: "Polite, friendly and reasonable" },
  { value: "safe", label: "Safe", hint: "Prioritises closing smoothly" },
];

const AUTONOMY: { value: Autonomy; label: string; hint: string }[] = [
  {
    value: "approve_close",
    label: "Ask me before closing",
    hint: "The agent negotiates alone and stops for your OK on the final deal.",
  },
  {
    value: "auto",
    label: "Fully automatic",
    hint: "The agent closes and books the pickup without asking.",
  },
];

const RECENT_KEY = "haggle-recents";

function readRecents(): { id: string; asking: number; createdAt: string }[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { id: string; asking: number; createdAt: string } =>
        item && typeof item.id === "string" && typeof item.asking === "number" && typeof item.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function writeRecents(recents: { id: string; asking: number; createdAt: string }[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, 20)));
  } catch {
    // localStorage unavailable: recents won't persist
  }
}

export function Home({ onStart }: { onStart: (id: string) => void }) {
  const [asking, setAsking] = useState("1200");
  const [budget, setBudget] = useState("1000");
  const [persona, setPersona] = useState("flexible");
  const [style, setStyle] = useState<Style>("balanced");
  const [autonomy, setAutonomy] = useState<Autonomy>("approve_close");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ asking?: string; budget?: string }>({});

  const askingN = Number(asking);
  const budgetN = Number(budget);
  const askingValid = asking.trim() !== "" && Number.isFinite(askingN) && askingN > 0;
  const budgetValid = budget.trim() !== "" && Number.isFinite(budgetN) && budgetN > 0;
  const valid = askingValid && budgetValid;
  const budgetAtOrAboveAsking = valid && budgetN >= askingN;

  const recents = readRecents();

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      setFieldError({});
      let invalid = false;
      if (!askingValid) {
        setFieldError((prev) => ({ ...prev, asking: "Enter a valid asking price." }));
        invalid = true;
      }
      if (!budgetValid) {
        setFieldError((prev) => ({ ...prev, budget: "Enter a valid budget." }));
        invalid = true;
      }
      if (invalid) return;
      setBusy(true);
      try {
        const { id } = await startRun({
          asking: askingN,
          budget: budgetN,
          persona,
          style,
          autonomy,
        });
        const recents = readRecents();
        writeRecents([{ id, asking: askingN, createdAt: new Date().toISOString() }, ...recents]);
        onStart(id);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : String(problem));
        setBusy(false);
      }
    },
    [askingN, budgetN, askingValid, budgetValid, persona, style, autonomy, onStart],
  );

  const choiceProps = (name: string, selected: boolean, onChange: () => void) => ({
    type: "radio" as const,
    name,
    checked: selected,
    onChange,
  });

  return (
    <div className={styles.home}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.heading}>New negotiation</h1>
        <p className={styles.intro}>
          Practice mode: the seller is simulated. Your budget stays private &mdash; the agent never
          sees it in a prompt, and a rule check blocks any message that could reveal it.
        </p>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The listing</h2>
          <label className={styles.label}>
            Seller&rsquo;s asking price (RM)
            <input
              className={[styles.input, fieldError.asking && styles.inputError].filter(Boolean).join(" ")}
              type="text"
              inputMode="numeric"
              value={asking}
              onChange={(e) => setAsking(e.target.value)}
            />
            {fieldError.asking && <span className={styles.fieldError}>{fieldError.asking}</span>}
          </label>
          <label className={styles.label}>
            Your maximum budget (RM)
            <input
              className={[styles.input, fieldError.budget && styles.inputError].filter(Boolean).join(" ")}
              type="text"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
            {fieldError.budget && <span className={styles.fieldError}>{fieldError.budget}</span>}
          </label>
          {budgetAtOrAboveAsking && (
            <p className={styles.note}>
              Your budget is at or above the asking price, so there is little to haggle.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The seller</h2>
          <p className={styles.who}>Who are you haggling with?</p>
          <div className={styles.personas}>
            {PERSONAS.map((p) => {
              const selected = persona === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={[styles.personaCard, selected && styles.personaSelected].filter(Boolean).join(" ")}
                  onClick={() => setPersona(p.id)}
                  aria-pressed={selected}
                >
                  <span className={styles.personaLabel}>{p.label}</span>
                  <span className={styles.personaHint}>{p.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The agent&rsquo;s style</h2>
          <div className={styles.styleChoices}>
            {STYLES.map((s) => {
              const selected = style === s.value;
              return (
                <label key={s.value} className={styles.radioCard}>
                  <input {...choiceProps("agent-style", selected, () => setStyle(s.value))} />
                  <span>
                    <strong>{s.label}</strong>
                    <span className={styles.hint}>{s.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>How much control</h2>
          <div className={styles.controlChoices}>
            {AUTONOMY.map((a) => {
              const selected = autonomy === a.value;
              return (
                <label key={a.value} className={styles.radioCard}>
                  <input {...choiceProps("control-level", selected, () => setAutonomy(a.value))} />
                  <span>
                    <strong>{a.label}</strong>
                    <span className={styles.hint}>{a.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {error && <p className={styles.error} role="alert">{error}</p>}
        <Button
          variant="primary"
          type="submit"
          disabled={!valid || busy}
          className={styles.startButton}
        >
          {busy ? "Starting&hellip;" : "Start negotiating"}
        </Button>
      </form>

      <aside className={styles.aside}>
        <Card padding="lg">
          <h2 className={styles.asideTitle}>What happens next</h2>
          <ol className={styles.timeline}>
            <li>Plan &mdash; the agent decides the next move</li>
            <li>Write &mdash; it drafts a message</li>
            <li>Check against the rules &mdash; code validates every message</li>
            <li>Send &mdash; only validated messages reach the seller</li>
            <li>Read the reply &mdash; the seller&rsquo;s answer is read back</li>
            <li>You approve &mdash; nothing closes without your OK</li>
            <li>Pickup booked &mdash; the collection is scheduled</li>
          </ol>
        </Card>

        <Card padding="lg" className={styles.guardrails}>
          <h2 className={styles.asideTitle}>Guardrails</h2>
          <ul className={styles.guardrailsList}>
            <li>Your limit never reaches the AI.</li>
            <li>Every message is checked by code before it is sent.</li>
            <li>Nothing closes without your OK in Level 2.</li>
          </ul>
        </Card>
      </aside>

      <section className={styles.recents}>
        <h2 className={styles.recentsTitle}>Recent negotiations</h2>
        {recents.length === 0 ? (
          <p className={styles.recentsEmpty}>No negotiations yet. Start one to see it here.</p>
        ) : (
          <ul className={styles.recentsList}>
            {recents.map((r) => (
              <li key={r.id} className={styles.recentsItem}>
                <span className={styles.recentsId}>{r.id.slice(0, 12)}&hellip;</span>
                <span className={styles.recentsAsking}>{formatRm(r.asking)} asking</span>
                <span className={styles.recentsTime}>{new Date(r.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
