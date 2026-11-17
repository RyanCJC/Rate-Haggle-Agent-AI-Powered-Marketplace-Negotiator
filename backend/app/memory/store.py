import threading
from datetime import UTC, datetime

import psycopg
from pydantic import ValidationError

from .embed import NAME, embed
from .models import DealRecord, PastDeal, Preferences, check_profile_id

DEAL_COLUMNS = (
    "run_id, item_title, category, asking, final_price, outcome, mode, rounds, created_at"
)
MIN_SIMILARITY = 0.40
MAX_LIMIT = 20


def _text(title: str | None, category: str | None) -> str:
    return " ".join(part for part in (title, category) if part).strip() or "item"


def _literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vector) + "]"


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))  # both are unit vectors


def _clamp(limit: int) -> int:
    return max(1, min(int(limit), MAX_LIMIT))


def _deal(row, similarity: float | None = None) -> PastDeal:
    return PastDeal(
        run_id=row[0],
        item_title=row[1],
        category=row[2],
        asking=row[3],
        final_price=row[4],
        outcome=row[5],
        mode=row[6],
        rounds=row[7],
        created_at=row[8],
        similarity=similarity,
    )


class InMemoryMemory:
    """For tests and demos: the same contract as PgMemory."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._prefs: dict[str, Preferences] = {}
        self._deals: dict[str, dict[str, tuple[PastDeal, list[float]]]] = {}

    def get_preferences(self, profile_id: str) -> Preferences:
        return self._prefs.get(check_profile_id(profile_id), Preferences())

    def set_preferences(self, profile_id: str, prefs: Preferences) -> Preferences:
        with self._lock:
            self._prefs[check_profile_id(profile_id)] = prefs
        return prefs

    def record_deal(self, profile_id: str, deal: DealRecord) -> bool:
        pid = check_profile_id(profile_id)
        vector = embed(_text(deal.item_title, deal.category))
        with self._lock:
            bucket = self._deals.setdefault(pid, {})
            if deal.run_id in bucket:
                return False
            past = PastDeal(**deal.model_dump(), created_at=datetime.now(UTC))
            bucket[deal.run_id] = (past, vector)
            return True

    def similar_deals(
        self, profile_id, title, category=None, limit=3, min_similarity=MIN_SIMILARITY
    ) -> list[PastDeal]:
        pid = check_profile_id(profile_id)
        query = embed(_text(title, category))
        with self._lock:
            items = list(self._deals.get(pid, {}).values())
        scored = [
            (past, _cosine(query, vector))
            for past, vector in items
            if past.outcome == "deal" and past.final_price is not None
        ]
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return [
            past.model_copy(update={"similarity": sim})
            for past, sim in scored[: _clamp(limit)]
            if sim >= min_similarity
        ]

    def list_deals(self, profile_id: str, limit: int = 50) -> list[PastDeal]:
        pid = check_profile_id(profile_id)
        with self._lock:
            items = [past for past, _ in self._deals.get(pid, {}).values()]
        items.sort(key=lambda d: d.created_at, reverse=True)
        return items[: max(1, min(int(limit), 200))]

    def forget_deal(self, profile_id: str, run_id: str) -> bool:
        pid = check_profile_id(profile_id)
        with self._lock:
            return self._deals.get(pid, {}).pop(run_id, None) is not None

    def clear(self, profile_id: str) -> int:
        pid = check_profile_id(profile_id)
        with self._lock:
            removed = len(self._deals.pop(pid, {}))
            self._prefs.pop(pid, None)
        return removed


class PgMemory:
    """Postgres + pgvector. One short connection per call, so a stale connection cannot linger."""

    def __init__(self, url: str) -> None:
        self.url = url

    def _conn(self):
        return psycopg.connect(self.url)

    def get_preferences(self, profile_id: str) -> Preferences:
        pid = check_profile_id(profile_id)
        with self._conn() as conn:
            row = conn.execute("select preferences from profiles where id = %s", (pid,)).fetchone()
        if not row:
            return Preferences()
        try:
            return Preferences.model_validate(row[0])
        except ValidationError:
            return Preferences()  # an old or damaged record never breaks a run

    def set_preferences(self, profile_id: str, prefs: Preferences) -> Preferences:
        pid = check_profile_id(profile_id)
        with self._conn() as conn:
            conn.execute(
                "insert into profiles (id, preferences) values (%s, %s::jsonb) "
                "on conflict (id) do update set preferences = excluded.preferences, "
                "updated_at = now()",
                (pid, prefs.model_dump_json()),
            )
        return prefs

    def record_deal(self, profile_id: str, deal: DealRecord) -> bool:
        pid = check_profile_id(profile_id)
        vector = _literal(embed(_text(deal.item_title, deal.category)))
        with self._conn() as conn:
            conn.execute("insert into profiles (id) values (%s) on conflict do nothing", (pid,))
            cur = conn.execute(
                "insert into past_deals (profile_id, run_id, item_title, category, asking, "
                "final_price, outcome, mode, rounds, embedding, embedder) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s) "
                "on conflict (profile_id, run_id) do nothing",
                (
                    pid,
                    deal.run_id,
                    deal.item_title,
                    deal.category,
                    deal.asking,
                    deal.final_price,
                    deal.outcome,
                    deal.mode,
                    deal.rounds,
                    vector,
                    NAME,
                ),
            )
            return cur.rowcount == 1

    def similar_deals(
        self, profile_id, title, category=None, limit=3, min_similarity=MIN_SIMILARITY
    ) -> list[PastDeal]:
        pid = check_profile_id(profile_id)
        vector = _literal(embed(_text(title, category)))
        with self._conn() as conn:
            rows = conn.execute(
                f"select {DEAL_COLUMNS}, 1 - (embedding <=> %s::vector) from past_deals "
                "where profile_id = %s and embedder = %s and outcome = 'deal' "
                "and final_price is not null "
                "order by embedding <=> %s::vector limit %s",
                (vector, pid, NAME, vector, _clamp(limit)),
            ).fetchall()
        return [_deal(row[:9], float(row[9])) for row in rows if row[9] >= min_similarity]

    def list_deals(self, profile_id: str, limit: int = 50) -> list[PastDeal]:
        pid = check_profile_id(profile_id)
        with self._conn() as conn:
            rows = conn.execute(
                f"select {DEAL_COLUMNS} from past_deals where profile_id = %s "
                "order by created_at desc limit %s",
                (pid, max(1, min(int(limit), 200))),
            ).fetchall()
        return [_deal(row) for row in rows]

    def forget_deal(self, profile_id: str, run_id: str) -> bool:
        pid = check_profile_id(profile_id)
        with self._conn() as conn:
            cur = conn.execute(
                "delete from past_deals where profile_id = %s and run_id = %s", (pid, run_id)
            )
            return cur.rowcount == 1

    def clear(self, profile_id: str) -> int:
        """Forget everything about this profile: deals, preferences, the profile itself."""
        pid = check_profile_id(profile_id)
        with self._conn() as conn:
            removed = conn.execute("delete from past_deals where profile_id = %s", (pid,)).rowcount
            conn.execute("delete from profiles where id = %s", (pid,))
        return removed