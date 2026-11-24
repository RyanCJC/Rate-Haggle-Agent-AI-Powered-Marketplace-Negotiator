import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getCapabilities, getPreferences, getSimilar, startRun } from "../../api";
import { Button } from "../../ui/button/button";
import { Card } from "../../ui/card/card";
import { Badge } from "../../ui/badge/badge";
import { formatRm } from "../../lib/format";
import { marketCheck, parseComparables } from "../../lib/listing";
import { dealSummary, formatMatch, shouldShowSimilarDeals } from "../../lib/memory";
import { parseMoney } from "../../lib/money";
import { CATEGORIES } from "../../lib/categories";
import { MarketCheckCard } from "../listing/MarketCheckCard";
import type { Autonomy, Channel, Deal, ListingCategory, Mode, Style } from "../../types";
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

const MODES: { value: Mode; label: string }[] = [
  { value: "simulate", label: "Practice (simulated seller)" },
  { value: "copilot", label: "Copilot (real seller)" },
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

function choiceProps(name: string, selected: boolean, onChange: () => void) {
  return {
    type: "radio" as const,
    name,
    checked: selected,
    onChange,
  };
}

type RecentItem = {
  id: string;
  asking: number;
  createdAt: string;
  mode?: Mode;
  itemTitle?: string | null;
};

function readRecents(): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentItem =>
        item &&
        typeof item.id === "string" &&
        typeof item.asking === "number" &&
        typeof item.createdAt === "string" &&
        (!("mode" in item) || item.mode === "simulate" || item.mode === "copilot"),
    );
  } catch {
    return [];
  }
}

function writeRecents(recents: RecentItem[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, 20)));
  } catch {
    // localStorage unavailable: recents won't persist
  }
}

export function Home({
  onStart,
  mode: initialMode = "simulate",
  channel: initialChannel = "manual",
  capabilities: initialCapabilities = null,
}: {
  onStart: (id: string) => void;
  mode?: Mode;
  channel?: Channel;
  capabilities?: { marketplace_channel: boolean } | null;
}) {
  const [asking, setAsking] = useState("1200");
  const [budget, setBudget] = useState("1000");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [persona, setPersona] = useState("flexible");
  const [style, setStyle] = useState<Style>("balanced");
  const [similarDeals, setSimilarDeals] = useState<Deal[]>([]);
  const [similarFor, setSimilarFor] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("approve_close");
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [capabilities, setCapabilities] = useState<{ marketplace_channel: boolean } | null>(initialCapabilities);
  const [itemTitle, setItemTitle] = useState("");
  const [sellerOpening, setSellerOpening] = useState("");
  const [category, setCategory] = useState<ListingCategory>("other");
  const [listingText, setListingText] = useState("");
  const [comparablesText, setComparablesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styleTouched = useRef(false);

  const askingN = parseMoney(asking);
  const budgetN = parseMoney(budget);
  const askingValid = askingN !== null;
  const budgetValid = budgetN !== null;
  const askingInvalid = asking.trim() !== "" && askingN === null;
  const budgetInvalid = budget.trim() !== "" && budgetN === null;
  const valid = askingValid && budgetValid;
  const budgetAtOrAboveAsking = valid && budgetN >= askingN;
  const isCopilot = mode === "copilot";
  const marketplaceEnabled = isCopilot && capabilities?.marketplace_channel === true;
  const similarKey = `${category}\u0000${itemTitle.trim()}`;
  const showSimilarDeals =
    similarFor === similarKey && shouldShowSimilarDeals(mode, itemTitle, similarDeals);
  const comparables = parseComparables(comparablesText);
  const market = !comparables.error && valid
    ? marketCheck(comparables.prices, askingN, budgetN)
    : null;

  const recents = readRecents();

  useEffect(() => {
    let active = true;
    void getPreferences()
      .then((preferences) => {
        if (active && !styleTouched.current && preferences.style) setStyle(preferences.style);
      })
      .catch(() => {
        // The form remains available when profile memory is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getCapabilities()
      .then((caps) => {
        if (active) setCapabilities(caps);
      })
      .catch(() => {
        // Any failure means "off": no visible change, no error shown.
        if (active) setCapabilities({ marketplace_channel: false });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSimilarDeals([]);
    setSimilarFor("");
    if (!isCopilot || itemTitle.trim().length < 3) return;

    const controller = new AbortController();
    const title = itemTitle.trim();
    const key = `${category}\u0000${title}`;
    const timeout = window.setTimeout(() => {
      void getSimilar(title, category, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setSimilarDeals(result.deals.slice(0, 3));
          setSimilarFor(key);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSimilarDeals([]);
            setSimilarFor(key);
          }
        });
    }, 400);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [category, isCopilot, itemTitle]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(null);
      const parsedComparables = parseComparables(comparablesText);
      if (isCopilot && parsedComparables.error) return;
      if (!askingValid || !budgetValid) return;
      setBusy(true);
      try {
        const effectiveAutonomy = isCopilot ? "approve_close" : autonomy;
        const body: Record<string, unknown> = {
          asking: askingN,
          budget: budgetN,
          persona,
          style,
          autonomy: effectiveAutonomy,
          mode,
          item_title: itemTitle.trim() || null,
          ...(isCopilot
            ? {
                category,
                listing_text: listingText.trim() || null,
                comparables: parsedComparables.prices.length
                  ? parsedComparables.prices
                  : null,
              }
            : {}),
        };
        if (channel === "marketplace") {
          body.channel = "marketplace";
          body.seed = 0;
        } else if (isCopilot) {
          body.seller_opening = sellerOpening.trim() || null;
        }
        const { id } = await startRun(body as never);
        const recents = readRecents();
        writeRecents([
          { id, asking: askingN, createdAt: new Date().toISOString(), mode, itemTitle: itemTitle.trim() || null },
          ...recents,
        ]);
        onStart(id);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : String(problem));
        setBusy(false);
      }
    },
    [
      askingN,
      askingValid,
      autonomy,
      budgetN,
      budgetValid,
      channel,
      category,
      comparablesText,
      isCopilot,
      itemTitle,
      listingText,
      mode,
      onStart,
      persona,
      sellerOpening,
      style,
    ],
  );

  return (
    <div className={styles.home}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.heading}>New negotiation</h1>
        <div className={styles.modeChoices} role="group" aria-label="Negotiation mode">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMode(item.value)}
              aria-pressed={mode === item.value}
              className={[styles.modeButton, mode === item.value && styles.modeSelected].filter(Boolean).join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className={styles.intro}>
          {isCopilot
            ? "You send every message yourself. Haggle never contacts anyone. Your limit is never shown to the AI."
            : "Practice mode: the seller is simulated. Your budget stays private: the agent never sees it in a prompt, and a rule check blocks any message that could reveal it."}
        </p>
        {marketplaceEnabled && (
          <ChannelChoice channel={channel} onChannelChange={setChannel} />
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The listing</h2>
          {isCopilot && (
            <label className={styles.label}>
              Item title (optional)
              <input
                className={styles.input}
                type="text"
                value={itemTitle}
                onChange={(event) => setItemTitle(event.target.value)}
                maxLength={120}
              />
            </label>
          )}
          {isCopilot && (
            <label className={styles.label}>
              Category
              <select
                className={styles.input}
                value={category}
                onChange={(event) => setCategory(event.target.value as ListingCategory)}
                data-testid="copilot-category"
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          )}
          <CategoryOtherHint isCopilot={isCopilot} category={category} />
          <label className={styles.label}>
            Seller&rsquo;s asking price (RM)
            <input
              className={[styles.input, askingInvalid && styles.inputError].filter(Boolean).join(" ")}
              type="text"
              inputMode="numeric"
              value={asking}
              onChange={(e) => setAsking(e.target.value)}
              aria-describedby={askingInvalid ? "asking-hint" : undefined}
              aria-invalid={askingInvalid || undefined}
            />
            {askingInvalid && (
              <span id="asking-hint" className={styles.fieldError} data-testid="asking-hint">
                Enter an amount like 1200 or 1,200.
              </span>
            )}
          </label>
          <label className={styles.label}>
            Your maximum budget (RM)
            <input
              className={[styles.input, budgetInvalid && styles.inputError].filter(Boolean).join(" ")}
              type="text"
              inputMode="numeric"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              aria-describedby={budgetInvalid ? "budget-hint" : undefined}
              aria-invalid={budgetInvalid || undefined}
            />
            {budgetInvalid && (
              <span id="budget-hint" className={styles.fieldError} data-testid="budget-hint">
                Enter an amount like 1200 or 1,200.
              </span>
            )}
          </label>
          {isCopilot && (
            <>
              <label className={styles.label}>
                Listing text (optional)
                <textarea
                  className={styles.input}
                  rows={5}
                  value={listingText}
                  onChange={(event) => setListingText(event.target.value)}
                  maxLength={4000}
                  aria-describedby="copilot-listing-help copilot-listing-count"
                  data-testid="copilot-listing-text"
                />
              </label>
              <div className={styles.fieldMeta}>
                <span id="copilot-listing-help" className={styles.hint}>
                  Paste the listing description. The agent will only state item details found here.
                </span>
                <span id="copilot-listing-count" className={styles.counter} data-testid="copilot-listing-counter">
                  {listingText.length}/4000
                </span>
              </div>
              <label className={styles.label}>
                Comparable prices (optional)
                <input
                  className={[styles.input, comparables.error && styles.inputError].filter(Boolean).join(" ")}
                  type="text"
                  value={comparablesText}
                  onChange={(event) => setComparablesText(event.target.value)}
                  aria-describedby={
                    comparables.error
                      ? "copilot-comparables-help copilot-comparables-error"
                      : "copilot-comparables-help"
                  }
                  data-testid="copilot-comparables"
                />
              </label>
              <span id="copilot-comparables-help" className={styles.hint}>
                Prices of similar items you found, separated by spaces or new lines. Haggle does not look up prices.
              </span>
              {comparables.error && (
                <p
                  id="copilot-comparables-error"
                  className={styles.fieldError}
                  role="alert"
                  data-testid="copilot-comparables-error"
                >
                  {comparables.error}
                </p>
              )}
            </>
          )}
          {budgetAtOrAboveAsking && (
            <p className={styles.note}>
              Your budget is at or above the asking price, so there is little to haggle.
            </p>
          )}
          {isCopilot && channel !== "marketplace" && (
            <label className={styles.label}>
              Seller&rsquo;s first message
              <textarea
                className={styles.input}
                rows={4}
                value={sellerOpening}
                onChange={(event) => setSellerOpening(event.target.value)}
                maxLength={4000}
                placeholder="Paste what the seller said first, if anything"
              />
            </label>
          )}
        </section>

        {!isCopilot && (
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
        )}
        {marketplaceEnabled && (
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
            <p className={styles.note}>
              The seller is simulated. You approve every message before it is sent.
            </p>
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The agent&rsquo;s style</h2>
          <div className={styles.styleChoices}>
            {STYLES.map((s) => {
              const selected = style === s.value;
              return (
                <label key={s.value} className={styles.radioCard}>
                  <input
                    {...choiceProps("agent-style", selected, () => {
                      styleTouched.current = true;
                      setStyle(s.value);
                    })}
                  />
                  <span>
                    <strong>{s.label}</strong>
                    <span className={styles.hint}>{s.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {!isCopilot && (
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
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}
        <Button
          variant="primary"
          type="submit"
          disabled={!valid || busy || (isCopilot && Boolean(comparables.error))}
          className={styles.startButton}
          data-testid="start-negotiation"
        >
          {busy ? "Starting\u2026" : "Start negotiating"}
        </Button>
      </form>

      <aside className={styles.aside}>
        {market && (
          <MarketCheckCard
            prices={comparables.prices}
            asking={askingN!}
            limit={budgetN!}
          />
        )}
        {showSimilarDeals && (
          <Card
            padding="lg"
            className={styles.similarDeals}
            aria-label="Similar past deals"
            data-testid="similar-past-deals"
          >
            <h2 className={styles.asideTitle}>Similar past deals</h2>
            <p className={styles.similarNote}>
              Matched by wording from your earlier Copilot negotiations.
            </p>
            <ul className={styles.similarList}>
              {similarDeals.map((deal) => (
                <li key={deal.run_id} data-testid="similar-past-deal">
                  <strong>{deal.item_title || "Untitled item"}</strong>
                  <span>{dealSummary(deal)}</span>
                  <span className={styles.similarMatch}>{formatMatch(deal.similarity)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card padding="lg">
          <h2 className={styles.asideTitle}>What happens next</h2>
          <ol className={styles.timeline}>
            {isCopilot ? (
              <>
                <li>Draft: the agent writes the next message</li>
                <li>You send it yourself</li>
                <li>Paste the seller&apos;s reply</li>
                <li>Check: code validates every draft</li>
                <li>You approve: nothing closes without your OK</li>
                <li>Send the final message and agree pickup yourself</li>
              </>
            ) : (
              <>
                <li>Plan &mdash; the agent decides the next move</li>
                <li>Write &mdash; it drafts a message</li>
                <li>Check against the rules &mdash; code validates every message</li>
                <li>Send &mdash; only validated messages reach the seller</li>
                <li>Read the reply &mdash; the seller&rsquo;s answer is read back</li>
                <li>You approve &mdash; nothing closes without your OK</li>
                <li>Pickup booked &mdash; the collection is scheduled</li>
              </>
            )}
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
          <p className={styles.recentsEmpty}>No recent negotiations yet.</p>
        ) : (
          <ul className={styles.recentsList}>
            {recents.map((recent) => (
              <li key={recent.id} className={styles.recentsItem}>
                <span className={styles.recentsId}>{recent.id.slice(0, 8)}</span>
                <span className={styles.recentsAsking}>{formatRm(recent.asking)}</span>
                <span>{recent.itemTitle || (recent.mode === "copilot" ? "Copilot negotiation" : "Negotiation")}</span>
                <Badge variant={recent.mode === "copilot" ? "default" : "neutral"}>
                  {recent.mode === "copilot" ? "Copilot" : "Practice"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CategoryOtherHint({ isCopilot, category }: { isCopilot: boolean; category: ListingCategory }) {
  if (!isCopilot || category !== "other") return null;
  return (
    <p className={styles.note}>
      General guidance only. No category-specific notes.
    </p>
  );
}

export function ChannelChoice({
  channel,
  onChannelChange,
}: {
  channel: Channel;
  onChannelChange: (value: Channel) => void;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>How messages reach the seller</h2>
      <div className={styles.channelChoices}>
        <label key="manual" className={styles.radioCard}>
          <input
            {...choiceProps("channel", channel === "manual", () => onChannelChange("manual"))}
          />
          <span>
            <strong>I send them myself (real seller)</strong>
            <span className={styles.hint}>
              You review each draft, then paste the seller\u2019s reply back.
            </span>
          </span>
        </label>
        <label key="marketplace" className={styles.radioCard}>
          <input
            {...choiceProps("channel", channel === "marketplace", () => onChannelChange("marketplace"))}
          />
          <span>
            <strong>Haggle sends them after I approve (simulated marketplace)</strong>
            <span className={styles.hint}>
              The seller is simulated. You approve every message before it is sent.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}