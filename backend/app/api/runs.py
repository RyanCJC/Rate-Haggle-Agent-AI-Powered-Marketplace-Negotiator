import psycopg
from psycopg.types.json import Jsonb


class MemoryRuns:
    """Run settings in a dict, for tests."""

    def __init__(self):
        self.rows: dict[str, dict] = {}

    def create(self, run_id: str, config: dict) -> None:
        self.rows[run_id] = config

    def get(self, run_id: str) -> dict | None:
        return self.rows.get(run_id)


class PgRuns:
    """Run settings in the `runs` table: they survive a server restart."""

    def __init__(self, url: str):
        self.url = url

    def create(self, run_id: str, config: dict) -> None:
        with psycopg.connect(self.url) as conn:
            conn.execute("INSERT INTO runs (id, config) VALUES (%s, %s)", (run_id, Jsonb(config)))

    def get(self, run_id: str) -> dict | None:
        with psycopg.connect(self.url) as conn:
            row = conn.execute("SELECT config FROM runs WHERE id = %s", (run_id,)).fetchone()
        return row[0] if row else None