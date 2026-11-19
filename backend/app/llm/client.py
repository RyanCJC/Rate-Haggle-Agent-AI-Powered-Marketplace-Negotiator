import json
import logging
import re
import time
from collections import deque

from openai import OpenAI
from pydantic import BaseModel

logger = logging.getLogger("haggle.llm")

from backend.app.settings import Settings


class LLMError(RuntimeError):
    pass


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
        max_retries: int = 2,
        use_json_mode: bool = True,
        client=None,
    ):
        env = Settings.from_env()
        self.model = model or env.llm_model
        if not self.model:
            raise ValueError("set LLM_MODEL (or pass model=)")
        self.temperature = temperature
        self.max_retries = max_retries
        self.use_json_mode = use_json_mode
        self.calls: list[CallRecord] = []
        self._call_times: deque = deque()
        self._max_calls_per_minute = 13
        self._period_seconds = 60.0
        self._client = client or OpenAI(
            base_url=base_url or env.llm_base_url,
            api_key=api_key or env.llm_api_key or "not-needed",
        )

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
        last_error = ""

        # Rate limit: max 10 LLM calls per minute.
        now = time.monotonic()
        while self._call_times and now - self._call_times[0] > self._period_seconds:
            self._call_times.popleft()
        if len(self._call_times) >= self._max_calls_per_minute:
            sleep_for = self._period_seconds - (now - self._call_times[0])
            if sleep_for > 0:
                logger.info(
                    "rate limit of %d calls/minute reached: waiting %.1fs",
                    self._max_calls_per_minute,
                    sleep_for,
                )
                time.sleep(sleep_for)
                now = time.monotonic()
                while self._call_times and now - self._call_times[0] > self._period_seconds:
                    self._call_times.popleft()
        self._call_times.append(time.monotonic())

        attempts = self.max_retries + 1
        for attempt in range(1, attempts + 1):
            started = time.perf_counter()
            response = self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                **extra,
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
                "invalid reply task=%s attempt=%d/%d: asking again", task or "-", attempt, attempts
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