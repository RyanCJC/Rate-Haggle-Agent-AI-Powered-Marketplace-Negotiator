from __future__ import annotations

import os

import psycopg
from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    conn = psycopg.connect(os.environ["DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute("select 1")
            print(cur.fetchone()[0])
    finally:
        conn.close()


if __name__ == "__main__":
    main()
