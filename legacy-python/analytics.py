"""
Instagram statistikasini (followers, reach, profile_views va h.k.) yig'ib
analytics_log.csv fayliga saqlaydigan skript.

Ishlatish:
    python analytics.py            # bir martalik hisobot (konsolga + CSV)
    python analytics.py --loop     # har kuni soat 09:00 da avtomatik yig'adi
"""

import sys
import csv
import logging
from datetime import datetime
from pathlib import Path

from utils.api_client import InstagramClient, InstagramAPIError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("analytics")

CSV_FILE = Path(__file__).parent / "analytics_log.csv"
CSV_HEADERS = [
    "timestamp", "username", "followers_count", "follows_count", "media_count",
    "reach", "profile_views", "website_clicks",
]


def flatten_insights(insights_data: dict) -> dict:
    result = {}
    for item in insights_data.get("data", []):
        name = item.get("name")
        values = item.get("values", [])
        if values:
            result[name] = values[-1].get("value", 0)
    return result


def collect_and_save() -> dict:
    client = InstagramClient()

    summary = client.get_account_summary()
    insights = flatten_insights(
        client.get_account_insights(metrics="reach,profile_views,website_clicks")
    )

    row = {
        "timestamp": datetime.now().isoformat(),
        "username": summary.get("username", ""),
        "followers_count": summary.get("followers_count", 0),
        "follows_count": summary.get("follows_count", 0),
        "media_count": summary.get("media_count", 0),
        "reach": insights.get("reach", 0),
        "profile_views": insights.get("profile_views", 0),
        "website_clicks": insights.get("website_clicks", 0),
    }

    file_exists = CSV_FILE.exists()
    with open(CSV_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)

    logger.info("Statistika saqlandi: %s", row)
    return row


def print_report(row: dict) -> None:
    print("\n===== Instagram statistikasi =====")
    print(f"Akkaunt:         @{row['username']}")
    print(f"Followerlar:     {row['followers_count']}")
    print(f"Obunalar:        {row['follows_count']}")
    print(f"Postlar soni:    {row['media_count']}")
    print(f"Reach (kunlik):  {row['reach']}")
    print(f"Profil ko'rish:  {row['profile_views']}")
    print(f"Sayt bosishlar:  {row['website_clicks']}")
    print("===================================\n")


def run_loop() -> None:
    from apscheduler.schedulers.blocking import BlockingScheduler

    scheduler = BlockingScheduler()

    def job():
        try:
            row = collect_and_save()
            print_report(row)
        except InstagramAPIError as e:
            logger.error("Statistika yig'ishda xato: %s", e)

    scheduler.add_job(job, "cron", hour=9, minute=0)
    logger.info("Analytics avtomatik rejimda ishga tushdi (har kuni 09:00).")
    job()  # birinchi marta darhol ishga tushirish
    scheduler.start()


if __name__ == "__main__":
    if "--loop" in sys.argv:
        run_loop()
    else:
        try:
            row = collect_and_save()
            print_report(row)
        except InstagramAPIError as e:
            logger.error("Statistika yig'ishda xato: %s", e)
            sys.exit(1)
