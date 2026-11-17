import os
import sys

import psycopg
from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    ids = sys.argv[1:]
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for profile_id in ids:
            conn.execute("DELETE FROM past_deals WHERE profile_id = %s", (profile_id,))
            conn.execute("DELETE FROM profiles WHERE id = %s", (profile_id,))
    print(f"cleaned up {len(ids)} profile(s)")


if __name__ == "__main__":
    main()
