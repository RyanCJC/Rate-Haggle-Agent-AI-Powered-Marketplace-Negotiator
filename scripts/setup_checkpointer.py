import os

import psycopg
from dotenv import load_dotenv
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import sql

load_dotenv()
url = os.environ["DATABASE_URL"]

with PostgresSaver.from_conn_string(url) as saver:
    saver.setup()
print("checkpoint tables ready")

with psycopg.connect(url, autocommit=True) as conn:
    names = [
        row[0]
        for row in conn.execute("select tablename from pg_tables where schemaname = 'public'")
    ]
    for name in names:
        conn.execute(
            sql.SQL("alter table public.{} enable row level security").format(sql.Identifier(name))
        )
print("row level security enabled on:", ", ".join(sorted(names)))