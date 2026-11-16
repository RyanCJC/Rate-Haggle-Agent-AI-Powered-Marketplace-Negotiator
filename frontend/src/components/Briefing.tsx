import { type FormEvent, useState } from "react";
import { startRun } from "../api";
import type { Autonomy, Style } from "../types";

const SELLERS = [
  { id: "flexible", label: "Flexible seller", hint: "Has room to move on price" },
  { id: "firm", label: "Firm seller", hint: "Rarely drops below asking" },
  { id: "evasive", label: "Evasive seller", hint: "Sometimes dodges the price" },
  { id: "pressure", label: "Pushy seller", hint: "\"Another buyer is coming\"" },
  { id: "budget_prober", label: "Nosy seller", hint: "Keeps asking your budget" },
  { id: "term_changer", label: "Moving-target seller", hint: "Changes the price mid-way" },
  { id: "mixed_my_en", label: "Malay-English seller", hint: "Mixes Malay and English" },
  { id: "dishonest", label: "Bluffing seller", hint: "Tries tricks on the buyer" },
];

export function Briefing({ onStart }: { onStart: (id: string) => void }) {
  const [asking, setAsking] = useState("1200");
  const [budget, setBudget] = useState("1000");
  const [persona, setPersona] = useState("flexible");
  const [style, setStyle] = useState<Style>("balanced");
  const [autonomy, setAutonomy] = useState<Autonomy>("approve_close");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askingN = Number(asking);
  const budgetN = Number(budget);
  const valid = askingN > 0 && budgetN > 0;
  const seller = SELLERS.find((s) => s.id === persona);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await startRun({ asking: askingN, budget: budgetN, persona, style, autonomy });
      onStart(id);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>New negotiation</h1>
      <p className="muted">
        Practice mode: the seller is simulated. Your budget stays private: the agent never sees it
        in a prompt, and a rule check blocks any message that could reveal it.
      </p>

      <div className="grid">
        <label>
          Seller's asking price (RM)
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={asking}
            onChange={(e) => setAsking(e.target.value)}
          />
        </label>
        <label>
          Your maximum budget (RM)
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>
      </div>
      {valid && budgetN >= askingN && (
        <p className="note">Your budget is at or above the asking price, so there is little to haggle.</p>
      )}

      <label>
        Who are you haggling with?
        <select value={persona} onChange={(e) => setPersona(e.target.value)}>
          {SELLERS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="hint">{seller?.hint}</span>
      </label>

      <label>
        Negotiating style
        <select value={style} onChange={(e) => setStyle(e.target.value as Style)}>
          <option value="aggressive">Aggressive: pushes harder for a low price</option>
          <option value="balanced">Balanced</option>
          <option value="safe">Safe: prioritises closing a deal</option>
        </select>
      </label>

      <fieldset>
        <legend>How much control do you want?</legend>
        <label className="choice">
          <input
            type="radio"
            name="autonomy"
            checked={autonomy === "approve_close"}
            onChange={() => setAutonomy("approve_close")}
          />
          <span>
            <strong>Ask me before closing</strong> (recommended)
            <span className="hint">The agent negotiates alone and stops for your OK on the final deal.</span>
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="autonomy"
            checked={autonomy === "auto"}
            onChange={() => setAutonomy("auto")}
          />
          <span>
            <strong>Fully automatic</strong>
            <span className="hint">The agent closes and books the pickup without asking.</span>
          </span>
        </label>
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" type="submit" disabled={!valid || busy}>
        {busy ? "Starting…" : "Start negotiating"}
      </button>
    </form>
  );
}