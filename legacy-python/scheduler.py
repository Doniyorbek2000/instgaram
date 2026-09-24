"""
Post/Reels/Carousel avtomatik rejalashtiruvchi.

scheduled_posts.json faylidagi navbatni har daqiqada tekshiradi va
publish_at vaqti kelgan postlarni Instagram'ga avtomatik joylaydi.

Ishlatish:
    python scheduler.py            # doim fon rejimida ishlaydi
    python scheduler.py --once     # navbatni bir marta tekshirib chiqadi
"""

import json
import sys
import logging
from datetime import datetime
from pathlib import Path

from apscheduler.schedulers.blocking import BlockingScheduler

from utils.api_client import InstagramClient, InstagramAPIError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("scheduler")

QUEUE_FILE = Path(__file__).parent / "scheduled_posts.json"
LOG_FILE = Path(__file__).parent / "scheduled_log.txt"


def load_queue() -> list:
    if not QUEUE_FILE.exists():
        return []
    with open(QUEUE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_queue(queue: list) -> None:
    with open(QUEUE_FILE, "w", encoding="utf-8") as f:
        json.dump(queue, f, ensure_ascii=False, indent=2)


def log_result(message: str) -> None:
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat()} - {message}\n")
    logger.info(message)


def publish_post(client: InstagramClient, post: dict) -> str:
    post_type = post.get("type", "image")

    if post_type == "image":
        return client.publish_image(post["media_url"], post.get("caption", ""))

    if post_type in ("video", "reel"):
        return client.publish_video_or_reel(
            post["media_url"], post.get("caption", ""), is_reel=(post_type == "reel")
        )

    if post_type == "carousel":
        return client.publish_carousel(post["media_urls"], post.get("caption", ""))

    raise ValueError(f"Noma'lum post turi: {post_type}")


def check_and_publish() -> None:
    client = InstagramClient()
    queue = load_queue()
    now = datetime.now()
    changed = False

    for post in queue:
        if post.get("status") != "pending":
            continue

        publish_at = datetime.fromisoformat(post["publish_at"])
        if publish_at > now:
            continue

        try:
            media_id = publish_post(client, post)
            post["status"] = "published"
            post["media_id"] = media_id
            log_result(f"OK: {post['id']} joylandi (media_id={media_id})")
        except InstagramAPIError as e:
            post["status"] = "failed"
            post["error"] = str(e)
            log_result(f"XATO: {post['id']} joylanmadi -> {e}")

        changed = True

    if changed:
        save_queue(queue)


if __name__ == "__main__":
    if "--once" in sys.argv:
        check_and_publish()
        sys.exit(0)

    scheduler = BlockingScheduler()
    scheduler.add_job(check_and_publish, "interval", minutes=1, next_run_time=datetime.now())
    logger.info("Scheduler ishga tushdi. Har daqiqada navbat tekshiriladi (Ctrl+C to'xtatish).")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler to'xtatildi.")
