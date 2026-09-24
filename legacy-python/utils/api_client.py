"""
Instagram Graph API klienti.

Rasmiy Meta (Facebook) Graph API orqali:
- post/reels/carousel joylash
- media va account statistikasini (insights) olish
- DM yuborish

Hujjat: https://developers.facebook.com/docs/instagram-api
"""

import os
import time
import logging
from typing import Optional, List

import requests
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("instagram_api")


class InstagramAPIError(Exception):
    """Graph API xato qaytarganda ko'tariladigan xato."""


class InstagramClient:
    def __init__(
        self,
        access_token: Optional[str] = None,
        ig_user_id: Optional[str] = None,
        api_version: Optional[str] = None,
    ):
        self.access_token = access_token or os.getenv("PAGE_ACCESS_TOKEN")
        self.ig_user_id = ig_user_id or os.getenv("IG_BUSINESS_ACCOUNT_ID")
        self.api_version = api_version or os.getenv("GRAPH_API_VERSION", "v20.0")
        self.base_url = f"https://graph.facebook.com/{self.api_version}"

        if not self.access_token or not self.ig_user_id:
            raise ValueError(
                "PAGE_ACCESS_TOKEN va IG_BUSINESS_ACCOUNT_ID .env faylida "
                "to'ldirilishi shart. README.md dagi 2-3 bosqichlarga qarang."
            )

    # ---------- ichki yordamchi ----------

    def _request(self, method: str, path: str, **kwargs) -> dict:
        url = f"{self.base_url}/{path}"
        params = kwargs.pop("params", {})
        params.setdefault("access_token", self.access_token)

        resp = requests.request(method, url, params=params, timeout=30, **kwargs)
        data = resp.json()

        if resp.status_code >= 400 or "error" in data:
            err = data.get("error", {})
            raise InstagramAPIError(
                f"Graph API xato ({resp.status_code}): "
                f"{err.get('message', data)} (code={err.get('code')})"
            )
        return data

    # ---------- Media joylash (post / reels / carousel) ----------

    def create_media_container(
        self,
        media_url: str,
        caption: str = "",
        is_video: bool = False,
        is_reel: bool = False,
        is_carousel_item: bool = False,
    ) -> str:
        """Media konteyner yaratadi, creation_id qaytaradi."""
        params = {"caption": caption}

        if is_video:
            params["video_url"] = media_url
            params["media_type"] = "REELS" if is_reel else "VIDEO"
        else:
            params["image_url"] = media_url

        if is_carousel_item:
            params["is_carousel_item"] = "true"
            params.pop("caption", None)

        data = self._request("POST", f"{self.ig_user_id}/media", params=params)
        creation_id = data["id"]
        logger.info("Media konteyner yaratildi: %s", creation_id)
        return creation_id

    def create_carousel_container(self, children_ids: List[str], caption: str = "") -> str:
        """Bir nechta rasm/video'dan carousel post yaratadi."""
        params = {
            "media_type": "CAROUSEL",
            "children": ",".join(children_ids),
            "caption": caption,
        }
        data = self._request("POST", f"{self.ig_user_id}/media", params=params)
        return data["id"]

    def wait_until_ready(self, creation_id: str, timeout: int = 120, interval: int = 5) -> bool:
        """Video/reels konteyner qayta ishlanishini kutadi (FINISHED bo'lguncha)."""
        elapsed = 0
        while elapsed < timeout:
            data = self._request(
                "GET", creation_id, params={"fields": "status_code"}
            )
            status = data.get("status_code")
            if status == "FINISHED":
                return True
            if status == "ERROR":
                raise InstagramAPIError(f"Media qayta ishlashda xato: {data}")
            logger.info("Media hali tayyor emas (status=%s), kutilmoqda...", status)
            time.sleep(interval)
            elapsed += interval
        raise InstagramAPIError("Media tayyor bo'lishini kutish vaqti tugadi (timeout).")

    def publish_media(self, creation_id: str) -> str:
        """Tayyor konteynerni Instagram'ga joylaydi. Yangi media ID qaytaradi."""
        data = self._request(
            "POST", f"{self.ig_user_id}/media_publish", params={"creation_id": creation_id}
        )
        media_id = data["id"]
        logger.info("Post muvaffaqiyatli joylandi: media_id=%s", media_id)
        return media_id

    def publish_image(self, image_url: str, caption: str = "") -> str:
        creation_id = self.create_media_container(image_url, caption, is_video=False)
        return self.publish_media(creation_id)

    def publish_video_or_reel(self, video_url: str, caption: str = "", is_reel: bool = True) -> str:
        creation_id = self.create_media_container(
            video_url, caption, is_video=True, is_reel=is_reel
        )
        self.wait_until_ready(creation_id)
        return self.publish_media(creation_id)

    def publish_carousel(self, media_urls: List[str], caption: str = "", video_flags: Optional[List[bool]] = None) -> str:
        video_flags = video_flags or [False] * len(media_urls)
        children_ids = []
        for url, is_video in zip(media_urls, video_flags):
            cid = self.create_media_container(url, is_video=is_video, is_carousel_item=True)
            if is_video:
                self.wait_until_ready(cid)
            children_ids.append(cid)
        creation_id = self.create_carousel_container(children_ids, caption)
        return self.publish_media(creation_id)

    # ---------- Statistika (Insights) ----------

    def get_account_insights(
        self,
        metrics: str = "reach,profile_views,website_clicks",
        period: str = "day",
    ) -> dict:
        return self._request(
            "GET",
            f"{self.ig_user_id}/insights",
            params={"metric": metrics, "period": period},
        )

    def get_account_summary(self) -> dict:
        return self._request(
            "GET",
            self.ig_user_id,
            params={"fields": "followers_count,follows_count,media_count,username"},
        )

    def get_recent_media(self, limit: int = 10) -> list:
        data = self._request(
            "GET",
            f"{self.ig_user_id}/media",
            params={"fields": "id,caption,timestamp,media_type,permalink", "limit": limit},
        )
        return data.get("data", [])

    def get_media_insights(self, media_id: str, metrics: str = "impressions,reach,engagement,saved") -> dict:
        return self._request("GET", f"{media_id}/insights", params={"metric": metrics})

    # ---------- Messaging (DM) ----------

    def send_dm(self, recipient_id: str, text: str) -> dict:
        """Foydalanuvchiga Instagram Direct orqali xabar yuboradi."""
        payload = {
            "recipient": {"id": recipient_id},
            "message": {"text": text},
        }
        data = self._request("POST", "me/messages", params={}, json=payload)
        logger.info("DM yuborildi: recipient=%s", recipient_id)
        return data

    def reply_to_comment(self, comment_id: str, message: str) -> dict:
        return self._request(
            "POST", f"{comment_id}/replies", params={"message": message}
        )
