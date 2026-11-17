import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { bookPickup, cancelPickup, getPickupOptions } from "../../api";
import type { BookedPickup, PickupOptions, Snapshot } from "../../types";
import { Button } from "../../ui/button/button";
import { Card } from "../../ui/card/card";
import { Icon } from "../../ui/icon/icon";
import { describeSlot, mapPickupError, minimumPickupDate } from "../../lib/pickup";
import styles from "./pickupCoordinator.module.css";

interface PickupCoordinatorProps {
  runId: string;
  snapshot: Snapshot;
  refreshSnapshot: () => Promise<Snapshot | null>;
}

const SNAPSHOT_REFRESH_ERROR =
  "The pickup action succeeded, but the latest run snapshot could not be loaded. Refresh the page to verify.";

function ActionLabel({ children, loading }: { children: string; loading: boolean }) {
  return (
    <>
      <span>{children}</span>
      {loading && (
        <Icon
          name="LoaderCircle"
          size={14}
          aria-hidden="true"
          data-testid="pickup-spinner"
          className={styles.spinner}
        />
      )}
    </>
  );
}

function bookedPickup(pickup: Snapshot["pickup"]): BookedPickup | null {
  return pickup?.status === "booked" && pickup.start_at
    ? { status: "booked", start_at: pickup.start_at }
    : null;
}

function hourLabel(hour: number): string {
  if (hour < 12) return `${hour} am`;
  if (hour === 12) return "12 pm";
  return `${hour - 12} pm`;
}

export function PickupCoordinator({ runId, snapshot, refreshSnapshot }: PickupCoordinatorProps) {
  const [pickup, setPickup] = useState<BookedPickup | null>(() => bookedPickup(snapshot.pickup));
  const [options, setOptions] = useState<PickupOptions | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [copied, setCopied] = useState(false);
  const busyRef = useRef(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const errorId = "pickup-error";
  const describedBy = errorMessages.length > 0 ? errorId : undefined;
  const minDate = useRef(minimumPickupDate()).current;

  useLayoutEffect(() => {
    const textarea = messageRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 4}px`;
  }, [options?.message]);

  function reportSnapshotRefresh(success: Snapshot | null, fallback: BookedPickup | null): void {
    if (success) {
      setPickup(bookedPickup(success.pickup) ?? fallback);
      setErrorMessages((previous) => previous.filter((message) => message !== SNAPSHOT_REFRESH_ERROR));
    } else {
      setPickup(fallback);
      setErrorMessages((previous) =>
        previous.includes(SNAPSHOT_REFRESH_ERROR) ? previous : [...previous, SNAPSHOT_REFRESH_ERROR],
      );
    }
  }

  useEffect(() => {
    setPickup(bookedPickup(snapshot.pickup));
  }, [snapshot.pickup]);

  async function loadOptions(): Promise<PickupOptions> {
    const result = await getPickupOptions(runId);
    setOptions(result);
    setOptionsVisible(true);
    setPickup(result.pickup);
    const latest = await refreshSnapshot();
    reportSnapshotRefresh(latest, result.pickup);
    return result;
  }

  async function handleFailure(problem: unknown): Promise<void> {
    const mapped = mapPickupError(problem);
    setErrorMessages(mapped.messages);
    if (mapped.recovery === "refresh_options") {
      try {
        await loadOptions();
      } catch (refreshProblem) {
        setErrorMessages([...mapped.messages, ...mapPickupError(refreshProblem).messages]);
      }
    } else if (mapped.recovery === "refresh_snapshot") {
      const latest = await refreshSnapshot();
      reportSnapshotRefresh(latest, pickup);
    }
  }

  async function perform(actionId: string, action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPendingAction(actionId);
    setErrorMessages([]);
    setNotice("");
    try {
      await action();
    } catch (problem) {
      await handleFailure(problem);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function proposeTimes(): Promise<void> {
    await perform("propose", async () => {
      await loadOptions();
    });
  }

  async function refreshTimes(): Promise<void> {
    await perform("refresh", async () => {
      await loadOptions();
    });
  }

  async function bookTime(startAt: string, actionId: string): Promise<void> {
    await perform(actionId, async () => {
      const result = await bookPickup(runId, startAt);
      setPickup(result);
      setOptions(null);
      setOptionsVisible(false);
      setConfirmCancel(false);
      const latest = await refreshSnapshot();
      reportSnapshotRefresh(latest, result);
    });
  }

  async function bookCustomTime(): Promise<void> {
    if (!date || !hour) {
      setErrorMessages(["Please check the time"]);
      return;
    }
    await bookTime(`${date}T${hour}:00:00+08:00`, "custom");
  }

  async function confirmCancellation(): Promise<void> {
    await perform("cancel", async () => {
      await cancelPickup(runId);
      setPickup(null);
      setConfirmCancel(false);
      const latest = await refreshSnapshot();
      reportSnapshotRefresh(latest, null);
      await loadOptions();
    });
  }

  async function copyMessage(): Promise<void> {
    if (!options?.message) return;
    try {
      await navigator.clipboard.writeText(options.message);
      setCopied(true);
      setNotice("Copied");
      window.setTimeout(() => {
        setCopied(false);
        setNotice("");
      }, 2000);
    } catch {
      messageRef.current?.focus();
      messageRef.current?.select();
      setNotice("Press Ctrl+C to copy");
    }
  }

  const hourOptions = Array.from({ length: 10 }, (_, index) => index + 10);

  return (
    <section
      className={styles.coordinator}
      id="copilot-pickup"
      aria-labelledby="pickup-title"
      data-testid="pickup-coordinator"
    >
      <h2 id="pickup-title">Arrange pickup</h2>
      {pickup ? (
        <Card padding="md" className={styles.bookedCard} data-testid="pickup-booked-card">
          <h3>Pickup booked</h3>
          <p className={styles.bookedTime}>{describeSlot(pickup.start_at)} (Malaysia time)</p>
          <p>
            Saved in Haggle&apos;s own calendar. Haggle does not notify the seller: make sure you have
            agreed this time with them.
          </p>
          {!confirmCancel ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmCancel(true)}
              aria-describedby={describedBy}
              data-testid="pickup-cancel"
            >
              Cancel pickup
            </Button>
          ) : (
            <div className={styles.cancelConfirm} data-testid="pickup-cancel-confirm">
              <p>Cancel this pickup booking?</p>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                loading={busy}
                onClick={() => void confirmCancellation()}
                aria-describedby={describedBy}
                data-testid="pickup-cancel-confirm-button"
              >
                Confirm cancel
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmCancel(false)}
              >
                Keep pickup
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <p className={styles.explanation}>
            Haggle proposes free times from its own calendar. You send the message, the seller picks,
            you tell Haggle which time they agreed to.
          </p>
          {!optionsVisible ? (
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => void proposeTimes()}
              aria-describedby={describedBy}
              data-testid="pickup-propose"
            >
              <ActionLabel loading={pendingAction === "propose"}>Propose pickup times</ActionLabel>
            </Button>
          ) : (
            <div className={styles.options} data-testid="pickup-options">
              {options?.message && (
                <div className={styles.messageBlock}>
                  <label htmlFor="pickup-message">Message to send to the seller</label>
                  <textarea
                    ref={messageRef}
                    id="pickup-message"
                    readOnly
                    rows={1}
                    value={options.message}
                    aria-describedby={describedBy}
                    data-testid="pickup-message"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void copyMessage()}
                    aria-describedby={describedBy}
                    data-testid="pickup-copy"
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  {notice && <span className={styles.copyNotice} role="status" aria-live="polite">{notice}</span>}
                </div>
              )}
              {options && options.slots.length > 0 ? (
                <ul className={styles.slotList} aria-label="Available pickup times">
                  {options.slots.map((slot, index) => (
                    <li
                      key={slot}
                      className={styles.slotRow}
                      data-testid={`pickup-slot-${index}`}
                    >
                      <span data-testid={`pickup-slot-label-${index}`}>
                        {options.labels[index] || describeSlot(slot)}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void bookTime(slot, `slot-${index}`)}
                        aria-describedby={describedBy}
                        data-testid={`pickup-slot-button-${index}`}
                      >
                        <ActionLabel loading={pendingAction === `slot-${index}`}>
                          Seller agreed to this time
                        </ActionLabel>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No free pickup times are currently available.</p>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void refreshTimes()}
                aria-describedby={describedBy}
                data-testid="pickup-refresh"
              >
                <ActionLabel loading={pendingAction === "refresh"}>Refresh times</ActionLabel>
              </Button>
              <details className={styles.customTime}>
                <summary>The seller suggested another time</summary>
                <div className={styles.customControls}>
                  <label htmlFor="pickup-date">Date</label>
                  <input
                    id="pickup-date"
                    type="date"
                    min={minDate}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    disabled={busy}
                    aria-describedby={describedBy}
                    data-testid="pickup-date"
                  />
                  <label htmlFor="pickup-hour">Hour</label>
                  <select
                    id="pickup-hour"
                    value={hour}
                    onChange={(event) => setHour(event.target.value)}
                    disabled={busy}
                    aria-describedby={describedBy}
                    data-testid="pickup-hour"
                  >
                    <option value="">Choose an hour</option>
                    {hourOptions.map((value) => (
                      <option key={value} value={String(value).padStart(2, "0")}>
                        {hourLabel(value)}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={busy || !date || !hour}
                    onClick={() => void bookCustomTime()}
                    aria-describedby={describedBy}
                    data-testid="pickup-book-custom"
                  >
                    <ActionLabel loading={pendingAction === "custom"}>Book this time</ActionLabel>
                  </Button>
                </div>
              </details>
              <p className={styles.helper}>
                Haggle can&apos;t see the seller&apos;s reply. Tap the time the seller agreed to.
              </p>
            </div>
          )}
        </>
      )}
      {errorMessages.length > 0 && (
        <div id={errorId} className={styles.error} role="alert" data-testid="pickup-error">
          {errorMessages.length === 1 ? (
            <p>{errorMessages[0]}</p>
          ) : (
            <ul>{errorMessages.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
