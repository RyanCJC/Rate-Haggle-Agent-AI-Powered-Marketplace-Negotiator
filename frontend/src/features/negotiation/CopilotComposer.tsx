import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { replyToSeller, stopRun } from "../../api";
import { Button } from "../../ui/button/button";
import { replyArguments } from "./replyPayload";
import type { Question } from "../../types";
import styles from "./copilotComposer.module.css";

interface CopilotComposerProps {
  runId: string;
  question: Extract<Question, { gate: "seller_reply" }> | null;
}

interface RequestError extends Error {
  messages?: string[];
}

export function CopilotComposer({ runId, question }: CopilotComposerProps) {
  const [reply, setReply] = useState("");
  const [editedDraft, setEditedDraft] = useState(question?.draft ?? "");
  const [editOpen, setEditOpen] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const previousDraft = useRef(question?.draft ?? "");

  useEffect(() => {
    if (!question) return;
    if (previousDraft.current === question.draft) return;
    previousDraft.current = question.draft;
    setReply("");
    setEditedDraft(question.draft);
    setEditOpen(false);
    setError(null);
    setNotice("New draft ready");
    replyRef.current?.focus();
  }, [question]);

  async function copyDraft(): Promise<void> {
    if (!question) return;
    try {
      await navigator.clipboard.writeText(question.draft);
      setNotice("Copied");
    } catch {
      draftRef.current?.focus();
      draftRef.current?.select();
      setNotice("Press Ctrl+C to copy");
    }
  }

  async function submitReply(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (!question || inFlight || !reply.trim()) return;
    setInFlight(true);
    setError(null);
    setNotice("");
    try {
      const args = replyArguments(question.kind, reply, question.draft, editedDraft);
      await replyToSeller(runId, args.reply, args.sentText);
        } catch (problem) {
      const requestError = problem as RequestError;
      if (requestError.messages?.length) {
        setError(requestError.messages.join(" "));
        setEditOpen(true);
      } else {
        setError(problem instanceof Error ? problem.message : String(problem));
      }
    } finally {
      setInFlight(false);
    }
  }

  function onReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      void submitReply();
    }
  }

  async function endNegotiation(): Promise<void> {
    setInFlight(true);
    setError(null);
    try {
      await stopRun(runId);
      setConfirmStop(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setInFlight(false);
    }
  }

  if (!question) return null;

  const isQuestion = question.kind === "question";

  return (
    <section className={styles.composer} aria-labelledby="copilot-composer-title" data-testid="copilot-composer">
      <h2 id="copilot-composer-title" className={styles.title}>
        {isQuestion ? "The agent wants to ask the seller" : "Next message"}
      </h2>
      <div className={styles.draftBlock}>
        <label className={styles.label} htmlFor="copilot-draft">Draft to send</label>
        <textarea
          ref={draftRef}
          id="copilot-draft"
          className={styles.textarea}
          value={question.draft}
          readOnly
          rows={3}
          data-testid="copilot-draft"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copyDraft()}
          className={styles.copyButton}
          data-testid="copilot-copy"
        >
          Copy
        </Button>
      </div>

      <details
        className={styles.editDisclosure}
        open={editOpen}
        onToggle={(event) => setEditOpen(event.currentTarget.open)}
      >
        <summary>Edit before sending</summary>
        <label className={styles.label} htmlFor="copilot-edit">Your version of the draft</label>
        <textarea
          id="copilot-edit"
          className={styles.textarea}
          value={editedDraft}
          onChange={(event) => setEditedDraft(event.target.value)}
          rows={3}
          maxLength={4000}
          aria-describedby={error ? "copilot-reply-error" : undefined}
          data-testid="copilot-edit"
        />
        <p className={styles.editHelper}>
          Your edit is checked for your limit and price rules, not for item facts.
        </p>
      </details>

      <form className={styles.replyForm} onSubmit={(event) => void submitReply(event)}>
        <label className={styles.label} htmlFor="copilot-reply">Paste the seller's reply</label>
        <textarea
          ref={replyRef}
          id="copilot-reply"
          className={styles.textarea}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={onReplyKeyDown}
          rows={4}
          maxLength={4000}
          data-testid="copilot-reply"
        />
        <div className={styles.counter} aria-live="polite">{reply.length}/4000</div>
        {error && <p id="copilot-reply-error" className={styles.error} role="alert" data-testid="copilot-error">{error}</p>}
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            disabled={!reply.trim() || inFlight}
            loading={inFlight}
            data-testid="copilot-send"
          >
            Send reply to agent
          </Button>
          {!confirmStop ? (
            <Button
              type="button"
              variant="secondary"
              disabled={inFlight}
              onClick={() => setConfirmStop(true)}
              data-testid="copilot-end"
            >
              End negotiation
              </Button>
            ) : (
            <div className={styles.confirm} data-testid="copilot-stop-confirm">
              <span>End this negotiation?</span>
              <Button type="button" variant="danger" disabled={inFlight} onClick={() => void endNegotiation()}>
                Yes, end it
              </Button>
              <Button type="button" variant="secondary" disabled={inFlight} onClick={() => setConfirmStop(false)}>
                Keep negotiating
              </Button>
            </div>
          )}
        </div>
        <p className={styles.helper}>You can close this tab. The negotiation waits for your reply.</p>
        <div className={styles.live} aria-live="polite" data-testid="copilot-announcement">{notice}</div>
      </form>
    </section>
  );
}