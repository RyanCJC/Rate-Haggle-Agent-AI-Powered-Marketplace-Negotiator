import logging
import threading
import time

import psycopg

from .retrieval import knowledge_lookup

logger = logging.getLogger("haggle.knowledge")

RETRY_AFTER = 60.0  # seconds to wait before trying to create a failed embedder again


class KnowledgeSearch:
    """Backend of the search_knowledge tool: (query, category) -> ['source: text', ...].

    The embedding model is created on the first search, not at startup, and each search opens
    its own short connection. Any failure becomes 'nothing found' and is counted: a missing
    model or a database hiccup must never fail a negotiation."""

    def __init__(self, url: str, make_embedder, k: int = 3):
        self.url = url
        self.k = k
        self.failures = 0
        self._make = make_embedder
        self._embedder = None
        self._failed_at = float("-inf")
        self._lock = threading.Lock()

    def _embedder_ready(self):
        with self._lock:
            if self._embedder is None:
                if time.monotonic() - self._failed_at < RETRY_AFTER:
                    raise RuntimeError("the embedder failed recently; not retrying yet")
                try:
                    self._embedder = self._make()
                except Exception as error:
                    self._failed_at = time.monotonic()
                    logger.warning(
                        "embedder could not be created (%s): knowledge search is off for %.0fs",
                        type(error).__name__,
                        RETRY_AFTER,
                    )
                    raise
            return self._embedder

    def __call__(self, query: str, category: str | None) -> list[str]:
        try:
            embedder = self._embedder_ready()
            with psycopg.connect(self.url) as conn:
                return knowledge_lookup(conn, embedder, self.k)(query, category)
        except Exception as error:  # noqa: BLE001 - a failed lookup means "nothing found"
            self.failures += 1
            logger.warning(
                "knowledge search failed (%s): nothing found (failure %d)",
                type(error).__name__,
                self.failures,
            )
            return []
