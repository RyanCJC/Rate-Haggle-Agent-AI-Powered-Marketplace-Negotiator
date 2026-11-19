"""Logging: one plain-text line per event, tagged with the run it belongs to.

Rule: log what happened (task, timing, counts, error type, where), never the content:
no prompts, replies, messages, budgets, URLs or keys.
"""

import contextvars
import logging

run_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("haggle_run_id", default="-")

FORMAT = "%(asctime)s %(levelname)-7s %(name)s run=%(run_id)s %(message)s"


class RunIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.run_id = run_id_var.get()[:8]
        return True


def make_handler(stream=None) -> logging.Handler:
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter(FORMAT))
    handler.addFilter(RunIdFilter())
    return handler


def configure_logging(level: str = "INFO") -> None:
    """Idempotent: safe to call on every startup."""
    logger = logging.getLogger("haggle")
    logger.setLevel(level)
    if not any(h.get_name() == "haggle" for h in logger.handlers):
        handler = make_handler()
        handler.set_name("haggle")
        logger.addHandler(handler)
