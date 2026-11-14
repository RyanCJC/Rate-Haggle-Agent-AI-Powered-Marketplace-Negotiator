import json
import os
import re
import time

from openai import OpenAI
from pydantic import BaseModel


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
        self.model = model or os.environ.get("LLM_MODEL", "")
        if not self.model:
            raise ValueError("set LLM_MODEL (or pass model=)")
        self.temperature = temperature
        self.max_retries = max_retries
        self.use_json_mode = use_json_mode
        self.calls: list[CallRecord] = []
        self._client = client or OpenAI(
            base_url=base_url or os.environ.get("LLM_BASE_URL"),
            api_key=api_key or os.environ.get("LLM_API_KEY") or "not-needed",
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

        for _ in range(self.max_retries + 1):
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
            self.calls.append(
                CallRecord(
                    task=task,
                    latency_s=time.perf_counter() - started,
                    prompt_tokens=getattr(usage, "prompt_tokens", None),
                    completion_tokens=getattr(usage, "completion_tokens", None),
                    ok=ok,
                )
            )
            if ok:
                return result
            messages = [
                *messages[:2],
                {"role": "assistant", "content": text},
                {
                    "role": "user",
                    "content": f"That reply was invalid ({last_error}). "
                    "Reply again with ONLY the JSON object.",
                },
            ]

        raise LLMError(f"{task or 'call'} failed after {self.max_retries + 1} attempts: {last_error}")