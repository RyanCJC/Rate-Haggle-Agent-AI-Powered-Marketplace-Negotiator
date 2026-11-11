from __future__ import annotations

import os
import random

import psycopg
from dotenv import load_dotenv

load_dotenv()

random.seed(42)

MONITOR_COUNT = 20
PHONE_COUNT = 15
LAPTOP_COUNT = 5

MONITOR_PRICE_LOW, MONITOR_PRICE_HIGH = 250, 1200
PHONE_PRICE_LOW, PHONE_PRICE_HIGH = 300, 3500
LAPTOP_PRICE_LOW, LAPTOP_PRICE_HIGH = 900, 4500

MONITOR_NOTES = [
    "Biasa je, tak ada piksel mati.",
    "Like new, original box included.",
    "Great for office spreadsheets.",
    "Diposok kat rumah, masih layak guna.",
    "HDMI and VGA ports included.",
    "Slight scuff on the stand, screen is perfect.",
    "Bargain for a dual-screen setup.",
    "Terpaksa jual, pindah negeri.",
    "Comes with warranty card.",
    "Tested and working 100 percent.",
    "No box, monitor only.",
    "Suitable for gaming and design work.",
    "Harga boleh negotiate sangat-sangat.",
    "Ultrawide, immersive viewing.",
    "Minor light bleed at the corners.",
    "Beli baru RM800, jual separuh harga.",
    "Serious buyers only please.",
    "Comes with DisplayPort cable.",
    "Pickup in Petaling Jaya.",
    "Terbaik untuk editing video.",
]

PHONE_NOTES = [
    "Battery health still above ninety percent.",
    "Like new, screen protector applied since day one.",
    "Terpaksa letak, beli model baru.",
    "Original box and charger included.",
    "Minor scratches on the back casing.",
    "Unlocked, works with all telcos.",
    "Jual sebab dapat upgrade dari syarikat.",
    "FaceID and TouchID working fine.",
    "No sim tray issue.",
    "Harga tak pasti, boleh bincang.",
    "Comes with clear case.",
    "Screen replaced last year.",
    "Still under manufacturer warranty.",
    "Fast charging included.",
    "Meet at PJ only.",
]

LAPTOP_NOTES = [
    "Biasa guna untuk kuliah dan office.",
    "Like new, barely used.",
    "RAM upgraded to sixteen gigabytes.",
    "Terpaksa jual, pindah keluar negara.",
    "Comes with original charger and bag.",
    "Battery holds about four hours.",
    "Screen has a tiny dead pixel at the corner.",
    "Windows 11 installed and activated.",
    "Harga boleh negotiation, come and check.",
    "Suitable for coding and light gaming.",
]


def _price(low: int, high: int) -> float:
    return round(random.uniform(low, high), 2)


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    conn = psycopg.connect(database_url)
    try:
        with conn.cursor() as cur:
            cur.execute("delete from deals")
            cur.execute("delete from offers")
            cur.execute("delete from messages")
            cur.execute("delete from negotiations")
            cur.execute("delete from calendar_slots")
            cur.execute("delete from listing_facts")
            cur.execute("delete from listings")
            cur.execute("delete from user_prefs")
            cur.execute("delete from users")

            cur.execute(
                "insert into users (name) values (%s) returning id", ("demo",)
            )
            user_id = cur.fetchone()[0]

            cur.execute(
                "insert into user_prefs (user_id, key, value) values (%s, %s, %s)",
                (user_id, "pickup_area", "Petaling Jaya"),
            )
            cur.execute(
                "insert into user_prefs (user_id, key, value) values (%s, %s, %s)",
                (user_id, "style", "balanced"),
            )

            listings_rows: list[tuple] = []
            index = 1

            for _ in range(MONITOR_COUNT):
                index += 1
                title = f"Monitor Listing {index}"
                listings_rows.append(
                    (
                        title,
                        "monitors",
                        _price(MONITOR_PRICE_LOW, MONITOR_PRICE_HIGH),
                        "MYR",
                        random.choice(MONITOR_NOTES),
                        "active",
                    )
                )

            for _ in range(PHONE_COUNT):
                index += 1
                title = f"Phone Listing {index}"
                listings_rows.append(
                    (
                        title,
                        "phones",
                        _price(PHONE_PRICE_LOW, PHONE_PRICE_HIGH),
                        "MYR",
                        random.choice(PHONE_NOTES),
                        "active",
                    )
                )

            for _ in range(LAPTOP_COUNT):
                index += 1
                title = f"Laptop Listing {index}"
                listings_rows.append(
                    (
                        title,
                        "laptops",
                        _price(LAPTOP_PRICE_LOW, LAPTOP_PRICE_HIGH),
                        "MYR",
                        random.choice(LAPTOP_NOTES),
                        "active",
                    )
                )

            cur.executemany(
                "insert into listings (title, category, asking_price, currency, seller_note, status) "
                "values (%s, %s, %s, %s, %s, %s)",
                listings_rows,
            )
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
