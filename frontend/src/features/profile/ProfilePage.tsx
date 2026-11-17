import { useCallback, useEffect, useRef, useState } from "react";
import { clearProfile, forgetDeal, getDeals, getPreferences, putPreferences } from "../../api";
import type { Deal, PickupHours, Preferences, Style } from "../../types";
import { dealSummary, outcomeLabel } from "../../lib/memory";
import { Badge } from "../../ui/badge/badge";
import { Button } from "../../ui/button/button";
import { Card } from "../../ui/card/card";
import type { ApiError } from "../../api";
import styles from "./profilePage.module.css";

const EMPTY_PREFERENCES: Preferences = {
  style: null,
  pickup_hours: "any",
  pickup_area: null,
};
const PROFILE_UPDATED_KEY = "haggle.profileUpdated";

const STYLE_OPTIONS: { value: Style | null; label: string }[] = [
  { value: null, label: "No preference" },
  { value: "aggressive", label: "Aggressive" },
  { value: "balanced", label: "Balanced" },
  { value: "safe", label: "Safe" },
];

const PICKUP_OPTIONS: { value: PickupHours; label: string; hours?: string }[] = [
  { value: "any", label: "Any time" },
  { value: "morning", label: "Morning", hours: "10 am to 12 pm" },
  { value: "afternoon", label: "Afternoon", hours: "12 to 5 pm" },
  { value: "evening", label: "Evening", hours: "5 to 8 pm" },
];

function localDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function notifyProfileUpdated(): void {
  try {
    window.localStorage.setItem(PROFILE_UPDATED_KEY, `${Date.now()}-${Math.random()}`);
  } catch {
    // The current page still refetches; other tabs will refresh on focus.
  }
}

function getErrorMessages(problem: unknown): string[] {
  const error = problem as Partial<ApiError>;
  if (error.status === 422) {
    return error.messages?.length ? error.messages : ["Please check your preferences"];
  }
  return [problem instanceof Error ? problem.message : "Please check your preferences"];
}

export function ProfilePage() {
  const [preferences, setPreferences] = useState<Preferences>(EMPTY_PREFERENCES);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [forgetId, setForgetId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadError, setLoadError] = useState("");
  const dirtyFields = useRef(new Set<keyof Preferences>());

  const loadProfile = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [nextPreferences, nextDeals] = await Promise.all([getPreferences(), getDeals()]);
      setPreferences((current) => ({
        style: dirtyFields.current.has("style") ? current.style : nextPreferences.style,
        pickup_hours: dirtyFields.current.has("pickup_hours")
          ? current.pickup_hours
          : nextPreferences.pickup_hours,
        pickup_area: dirtyFields.current.has("pickup_area")
          ? current.pickup_area
          : nextPreferences.pickup_area,
      }));
      setDeals(nextDeals.deals);
      setUnavailable(false);
      setLoadError("");
    } catch (problem) {
      setUnavailable(true);
      setLoadError(problem instanceof Error ? problem.message : "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([getPreferences(), getDeals()])
      .then(([nextPreferences, nextDeals]) => {
        if (!active) return;
        setPreferences((current) => ({
          style: dirtyFields.current.has("style") ? current.style : nextPreferences.style,
          pickup_hours: dirtyFields.current.has("pickup_hours")
            ? current.pickup_hours
            : nextPreferences.pickup_hours,
          pickup_area: dirtyFields.current.has("pickup_area")
            ? current.pickup_area
            : nextPreferences.pickup_area,
        }));
        setDeals(nextDeals.deals);
        setUnavailable(false);
      })
      .catch((problem: unknown) => {
        if (!active) return;
        setUnavailable(true);
        setLoadError(problem instanceof Error ? problem.message : "");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const refresh = () => void loadProfile();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_UPDATED_KEY) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadProfile]);

  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    dirtyFields.current.add(key);
    setPreferences((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setSaveErrors([]);
  }

  async function savePreferences(): Promise<void> {
    setSaving(true);
    setSaved(false);
    setSaveErrors([]);
    try {
      const result = await putPreferences(preferences);
      setPreferences(result);
      dirtyFields.current.clear();
      setSaved(true);
      notifyProfileUpdated();
    } catch (problem) {
      const error = problem as Partial<ApiError>;
      if (error.status === 503 || error.status === undefined) {
        setUnavailable(true);
        setLoadError(problem instanceof Error ? problem.message : "");
      } else {
        setSaveErrors(getErrorMessages(problem));
      }
    } finally {
      setSaving(false);
    }
  }

  async function forget(runId: string): Promise<void> {
    try {
      await forgetDeal(runId);
      setForgetId(null);
      notifyProfileUpdated();
      await loadProfile();
    } catch (problem) {
      setUnavailable(true);
      setLoadError(problem instanceof Error ? problem.message : "");
    }
  }

  async function clearMemory(): Promise<void> {
    try {
      await clearProfile();
      dirtyFields.current.clear();
      setPreferences(EMPTY_PREFERENCES);
      setConfirmClear(false);
      setForgetId(null);
      notifyProfileUpdated();
      await loadProfile();
    } catch (problem) {
      setUnavailable(true);
      setLoadError(problem instanceof Error ? problem.message : "");
    }
  }

  if (loading) {
    return <p className={styles.loading} role="status">Loading…</p>;
  }

  return (
    <div className={styles.profile} data-testid="profile-page">
      <header className={styles.header}>
        <h1>Your profile</h1>
        <p>
          Haggle remembers finished Copilot negotiations: the item, the asking price and the final
          price. It never stores your limit. Practice runs are not remembered. This profile lives in
          this browser: there are no accounts.
        </p>
      </header>

      {unavailable ? (
        <Card padding="lg" className={styles.unavailable} role="alert" data-testid="profile-unavailable">
          <p>Profile memory is unavailable right now.</p>
          {loadError && <span className={styles.visuallyHidden}>{loadError}</span>}
          <Button type="button" variant="secondary" onClick={() => void loadProfile(true)}>
            Retry
          </Button>
        </Card>
      ) : (
        <>
          <section aria-labelledby="preferences-heading">
            <Card padding="lg" className={styles.section}>
              <h2 id="preferences-heading">Preferences</h2>
              <fieldset className={styles.choiceGroup}>
                <legend>Default style</legend>
                <div className={styles.choiceList}>
                  {STYLE_OPTIONS.map((option) => (
                    <label className={styles.choice} key={option.label}>
                      <input
                        type="radio"
                        name="profile-style"
                        value={option.value ?? ""}
                        checked={preferences.style === option.value}
                        onChange={() => updatePreference("style", option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className={styles.choiceGroup}>
                <legend>Pickup time</legend>
                <div className={styles.choiceList}>
                  {PICKUP_OPTIONS.map((option) => (
                    <label className={styles.choice} key={option.value}>
                      <input
                        type="radio"
                        name="profile-pickup-hours"
                        value={option.value}
                        checked={preferences.pickup_hours === option.value}
                        onChange={() => updatePreference("pickup_hours", option.value)}
                      />
                      <span>
                        {option.label}
                        {option.hours && <small>{option.hours}</small>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className={styles.areaLabel} htmlFor="profile-pickup-area">
                Usual pickup area
                <input
                  id="profile-pickup-area"
                  type="text"
                  maxLength={80}
                  value={preferences.pickup_area ?? ""}
                  onChange={(event) => updatePreference("pickup_area", event.target.value || null)}
                  data-testid="profile-pickup-area"
                />
              </label>
              <p className={styles.helper}>Shown to you as a reminder when you arrange pickup. Not sent to the AI.</p>
              <div className={styles.saveActions}>
                <Button
                  type="button"
                  variant="primary"
                  disabled={saving}
                  onClick={() => void savePreferences()}
                  data-testid="profile-save-preferences"
                >
                  Save preferences
                </Button>
                {saved && <p className={styles.saved} role="status">Saved</p>}
                {saveErrors.length > 0 && (
                  <div className={styles.error} role="alert" data-testid="profile-save-error">
                    {saveErrors.map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}
                  </div>
                )}
              </div>
            </Card>
          </section>

          <section aria-labelledby="deals-heading">
            <Card padding="lg" className={styles.section}>
              <h2 id="deals-heading">Past negotiations</h2>
              {deals.length === 0 ? (
                <p className={styles.empty}>Nothing yet. Finish a Copilot negotiation and it will appear here.</p>
              ) : (
                <ul className={styles.dealList} data-testid="profile-deals">
                  {deals.map((deal) => (
                    <li key={deal.run_id} className={styles.dealRow} data-testid={`profile-deal-${deal.run_id}`}>
                      <div className={styles.dealDetails}>
                        <div className={styles.dealTitle}>
                          <strong className={deal.item_title ? "" : styles.untitled}>
                            {deal.item_title || "Untitled item"}
                          </strong>
                          <Badge
                            variant={deal.outcome === "deal" ? "success" : "neutral"}
                            className={deal.outcome === "deal" ? styles.dealBadge : undefined}
                          >
                            {outcomeLabel(deal.outcome)}
                          </Badge>
                        </div>
                        <p className={styles.summary}>{dealSummary(deal)}</p>
                        <p className={styles.meta}>{deal.rounds} rounds · {localDate(deal.created_at)}</p>
                        {forgetId === deal.run_id && (
                          <div className={styles.inlineConfirm} data-testid="profile-forget-confirm">
                            <span className={styles.meta}>Forget this deal?</span>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              onClick={() => void forget(deal.run_id)}
                            >
                              Forget
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setForgetId(null)}>
                              Keep
                            </Button>
                          </div>
                        )}
                      </div>
                      {forgetId !== deal.run_id && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setForgetId(deal.run_id)}
                          data-testid={`profile-forget-${deal.run_id}`}
                        >
                          Forget
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section aria-labelledby="clear-heading">
            <Card padding="lg" className={styles.section}>
              <h2 id="clear-heading">Clear my memory</h2>
              {!confirmClear ? (
                <Button type="button" variant="secondary" onClick={() => setConfirmClear(true)}>
                  Clear my memory
                </Button>
              ) : (
                <div className={styles.clearConfirm} data-testid="profile-clear-confirm">
                  <p>This deletes {deals.length} past deals and your preferences.</p>
                  <Button type="button" variant="danger" onClick={() => void clearMemory()}>
                    Delete everything
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
