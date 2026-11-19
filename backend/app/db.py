from __future__ import annotations

import psycopg
from dotenv import load_dotenv

from backend.app.settings import Settings

load_dotenv()


def get_conn():
    return psycopg.connect(Settings.from_env().require_database_url())  
