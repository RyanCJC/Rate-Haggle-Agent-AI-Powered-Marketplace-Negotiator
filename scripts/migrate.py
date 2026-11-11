from __future__ import annotations

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv()

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "db" / "migrations"


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg.connect(database_url, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "create table if not exists schema_migrations (name text primary key)"
            )
            cur.execute("select name from schema_migrations")
            applied = {row[0] for row in cur.fetchall()}

        applied_any = False
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if sql_file.name in applied:
                continue
            sql = sql_file.read_text()
            with conn.cursor() as cur:
                cur.execute(sql)
            with conn.cursor() as cur:
                cur.execute(
                    "insert into schema_migrations (name) values (%s)",
                    (sql_file.name,),
                )
            print(f"applied {sql_file.name}")
            applied_any = True

        if not applied_any:
            print("up to date")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
