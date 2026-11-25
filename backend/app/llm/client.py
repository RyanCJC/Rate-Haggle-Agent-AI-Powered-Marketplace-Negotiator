import json
import logging
import random
import re
import time
from collections import deque

from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI
from pydantic import BaseModel

from backend.app.settings import Settings

logger = logging.getLogger("haggle.llm")

# HTTP status codes that are safe to retry: never 400/401/403/404 (a request or config bug).
TRANSIENT_STATUSES = {429, 500, 502, 503, 504}

# Exponential backoff with jitter: about 2s, 6s, 15s for the first three retries, then capped.
BACKOFF_BASE = 2.0
BACKOFF_FACTOR = 3.0
BACKOFF_CAP = 15.0
BACKOFF_JITTER = 2.0


class LLMError(RuntimeError):
    """The LLM could not produce a valid reply (validation/schema failure).

    Nodes catch this and degrade gracefully; it is never a transient transport failure.
    """


class LLMUnavailableError(RuntimeError):
    """All retries on a transient failure (429/5xx/timeout/connection) were exhausted.

    Nodes must NOT catch this: it propagates so the run ends as failed with a structured
    reason and can later be resumed with POST /negotiations/{id}/retry.
    """


class LLMRejectedError(RuntimeError):
    """The request itself was rejected (400/401/403/404): never retried."""


class CallRecord(BaseModel):
    task: str
    latency_s: float
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    ok: bool = True


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a reply, tolerating code fences and chatter."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object found")
    return json.loads(cleaned[start : end + 1])


class LLMClient:
    """Thin wrapper over any OpenAI-compatible endpoint, returning validated Pydantic objects."""

    def __init__(
        self,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        temperature: float = 0.2,
        max_retries: int | None = None,
        timeout: float | None = None,
        use_json_mode: bool = True,
        client=None,
        sleep=None,
        clock=None,
    ):
        env = Settings.from_env()
        self.model = model or env.llm_model
        if not self.model:
            raise ValueError("set LLM_MODEL (or pass model=)")
        self.temperature = temperature
        self.max_retries = env.llm_max_retries if max_retries is None else max_retries
        self.timeout = env.llm_timeout_s if timeout is None else timeout
        self.use_json_mode = use_json_mode
        self.calls: list[CallRecord] = []
        self._call_times: deque = deque()
        self._max_calls_per_minute = 13
        self._period_seconds = 60.0
        self._sleep = sleep or time.sleep
        self._now = clock or time.monotonic
        self._client = client or OpenAI(
            base_url=base_url or env.llm_base_url,
            api_key=api_key or env.llm_api_key or "not-needed",
            max_retries=0,  # retries are handled here; never let the SDK multiply them
            timeout=self.timeout,
        )

    def _rate_limited(self) -> bool:
        now = self._now()
        while self._call_times and now - self._call_times[0] > self._period_seconds:
            self._call_times.popleft()
        return len(self._call_times) >= self._max_calls_per_minute

    def _wait_for_rate_limit_slot(self) -> None:
        """One slot per attempt: retries count against the 13/minute limit."""
        while self._rate_limited():
            now = self._now()
            sleep_for = self._period_seconds - (now - self._call_times[0])
            if sleep_for > 0:
                logger.info(
                    "rate limit of %d calls/minute reached: waiting %.1fs",
                    self._max_calls_per_minute,
                    sleep_for,
                )
                self._sleep(sleep_for)
                now = self._now()
            while self._call_times and now - self._call_times[0] > self._period_seconds:
                self._call_times.popleft()

    def _retry_delay(self, error: Exception, attempt: int) -> float:
        """Seconds to sleep before retry number `attempt` (1-based). Honours Retry-After."""
        response = getattr(error, "response", None)
        headers = getattr(response, "headers", None) if response is not None else None
        if headers is not None:
            retry_after = headers.get("retry-after") or headers.get("Retry-After")
            if retry_after is not None:
                try:
                    return float(retry_after)
                except ValueError:
                    pass  # an HTTP-date we do not parse: fall back to backoff
        raw = BACKOFF_BASE * (BACKOFF_FACTOR ** (attempt - 1))
        return min(BACKOFF_CAP, raw) + random.uniform(0, BACKOFF_JITTER)

    def complete_json(self, system: str, user: str, schema: type[BaseModel], task: str = ""):
        schema_text = json.dumps(schema.model_json_schema())
        full_system = (
            f"{system}\n\nReply with ONLY a JSON object matching this JSON schema:\n{schema_text}"
        )
        messages = [
            {"role": "system", "content": full_system},
            {"role": "user", "content": user},
        ]
        extra = {"response_format": {"type": "json_object"}} if self.use_json_mode else {}
        attempts = self.max_retries + 1
        last_error = ""

        for attempt in range(1, attempts + 1):
            # Rate limit: every attempt, including retries, takes one of the 13 slots per minute.
            self._wait_for_rate_limit_slot()
            self._call_times.append(self._now())

            started = time.perf_counter()
            try:
                response = self._client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                    timeout=self.timeout,
                    **extra,
                )
            except (APIConnectionError, APITimeoutError) as error:
                last_error = type(error).__name__
                if attempt < attempts:
                    self._retry(error, attempt, attempts, last_error)
                    continue
                raise LLMUnavailableError(
                    f"{task or 'call'} failed after {attempts} attempts: {last_error}"
                )
            except APIStatusError as error:
                last_error = f"{error.status_code} {type(error).__name__}"
                if error.status_code in TRANSIENT_STATUSES:
                    if attempt < attempts:
                        self._retry(error, attempt, attempts, last_error)
                        continue
                    raise LLMUnavailableError(
                        f"{task or 'call'} failed after {attempts} attempts: {last_error}"
                    )
                raise LLMRejectedError(
                    f"{task or 'call'} was rejected: {last_error}"
                )
            text = response.choices[0].message.content or ""
            usage = getattr(response, "usage", None)
            try:
                result = schema.model_validate(extract_json(text))
                ok = True
            except ValueError as error:  # JSON errors and pydantic errors both land here
                result, ok, last_error = None, False, str(error)[:300]
            latency = time.perf_counter() - started
            prompt_tokens = getattr(usage, "prompt_tokens", None)
            completion_tokens = getattr(usage, "completion_tokens", None)
            self.calls.append(
                CallRecord(
                    task=task,
                    latency_s=latency,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    ok=ok,
                )
            )
            logger.info(
                "llm call task=%s ok=%s latency=%.2fs prompt_tokens=%s completion_tokens=%s",
                task or "-",
                ok,
                latency,
                prompt_tokens,
                completion_tokens,
            )
            if ok:
                return result
            logger.warning(
                "invalid reply task=%s attempt=%d/%d: asking again",
                task or "-",
                attempt,
                attempts,
            )
            messages = [
                *messages[:2],
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": f"That reply was invalid ({last_error}). "
                    "Reply again with ONLY the JSON object.",
                },
            ]

        logger.error("llm call failed task=%s after %d attempts", task or "-", attempts)
        raise LLMError(f"{task or 'call'} failed after {attempts} attempts: {last_error}")

    def _retry(self, error: Exception, attempt: int, attempts: int, last_error: str) -> None:
        """Log at WARNING and sleep before the next attempt; the sleep is injected in tests."""
        delay = self._retry_delay(error, attempt)
        logger.warning(
            "llm call attempt=%d/%d: %s; retrying", attempt, attempts, last_error
        )
        self._sleep(delay)

    def _retry_delay(self, error: Exception, attempt: int) -> float:
        """Seconds to sleep before retry number `attempt` (1-based). Honours Retry-After."""
        response = getattr(error, "response", None)
        headers = getattr(response, "headers", None) if response is not None else None
        if headers is not None:
            retry_after = headers.get("retry-after") or headers.get("Retry-After")
            if retry_after is not None:
                try:
                    return float(retry_after)
                except ValueError:
                    pass  # an HTTP-date we do not parse: fall back to backoff
        raw = BACKOFF_BASE * (BACKOFF_FACTOR ** (attempt - 1))
        return min(BACKOFF_CAP, raw) + random.uniform(0, BACKOFF_JITTER)
