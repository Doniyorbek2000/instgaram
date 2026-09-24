"""
Instagram Direct (DM) uchun avtomatik javob beruvchi webhook server.

Meta rasmiy Messaging Webhooks orqali ishlaydi:
https://developers.facebook.com/docs/messenger-platform/instagram

Ishga tushirish:
    python dm_autoresponder.py

Internetga chiqarish uchun (lokal test):
    ngrok http 5000
so'ng chiqqan https URL'ni Meta App -> Webhooks -> Instagram bo'limida
Callback URL sifatida, .env dagi WEBHOOK_VERIFY_TOKEN'ni esa Verify Token
sifatida kiriting va "messages" fieldiga obuna bo'ling.
"""

import os
import json
import logging
from pathlib import Path

from flask import Flask, request, jsonify
from dotenv import load_dotenv

from utils.api_client import InstagramClient, InstagramAPIError

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("dm_autoresponder")

app = Flask(__name__)

VERIFY_TOKEN = os.getenv("WEBHOOK_VERIFY_TOKEN", "")
PORT = int(os.getenv("WEBHOOK_PORT", "5000"))
IG_ACCOUNT_ID = os.getenv("IG_BUSINESS_ACCOUNT_ID", "")
RULES_FILE = Path(__file__).parent / "auto_reply_rules.json"

# Bir kommentga ikki marta javob bermaslik uchun (webhook takroran kelishi mumkin)
_replied_comment_ids: set = set()


def load_rules() -> dict:
    with open(RULES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def find_reply(text: str, rules: dict, default_key: str = "default_reply") -> str:
    text_lower = text.lower()
    for rule in rules.get("keywords", []):
        for kw in rule.get("match", []):
            if kw.lower() in text_lower:
                return rule["reply"]
    return rules.get(default_key, "Rahmat, xabaringiz qabul qilindi!")


@app.route("/webhook", methods=["GET"])
def verify_webhook():
    """Meta webhook ro'yxatdan o'tkazishda GET so'rov yuboradi."""
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == VERIFY_TOKEN:
        logger.info("Webhook muvaffaqiyatli tasdiqlandi.")
        return challenge, 200

    logger.warning("Webhook tasdiqlash muvaffaqiyatsiz (token mos kelmadi).")
    return "Verification failed", 403


@app.route("/webhook", methods=["POST"])
def receive_webhook():
    """Instagramdan kelgan xabar/hodisalarni qabul qiladi."""
    data = request.get_json(force=True, silent=True) or {}
    logger.info("Webhook hodisasi keldi: %s", json.dumps(data)[:500])

    if data.get("object") != "instagram":
        return jsonify({"status": "ignored"}), 200

    # Klient yaratib bo'lmasa ham webhookka 200 qaytaramiz — aks holda Instagram
    # obunani o'chirib qo'yishi mumkin. Sabab logga yoziladi.
    try:
        client = InstagramClient()
    except ValueError as e:
        logger.error("InstagramClient yaratilmadi (kalitlar to'ldirilmagan?): %s", e)
        return jsonify({"status": "no_credentials"}), 200

    rules = load_rules()

    for entry in data.get("entry", []):
        # 1) Direct (DM) xabarlariga javob
        for event in entry.get("messaging", []):
            handle_message_event(client, rules, event)

        # 2) Post/Reels ostidagi yangi kommentlarga javob
        for change in entry.get("changes", []):
            if change.get("field") == "comments":
                handle_comment_event(client, rules, change.get("value", {}))

    return jsonify({"status": "ok"}), 200


def handle_message_event(client: InstagramClient, rules: dict, event: dict) -> None:
    sender_id = event.get("sender", {}).get("id")
    message = event.get("message", {})

    # Botning o'zi yuborgan xabarlarni e'tiborsiz qoldirish
    if message.get("is_echo"):
        return

    text = message.get("text")
    if not sender_id or not text:
        return

    reply_text = find_reply(text, rules)
    try:
        client.send_dm(sender_id, reply_text)
    except InstagramAPIError as e:
        logger.error("DM yuborishda xato: %s", e)


def handle_comment_event(client: InstagramClient, rules: dict, value: dict) -> None:
    """Post/Reels ostidagi yangi kommentga avtomatik javob yozadi."""
    # Faqat yangi qo'shilgan kommentlar (tahrir/o'chirish emas)
    if value.get("verb") not in (None, "add"):
        return

    comment_id = value.get("id")
    text = value.get("text")
    from_id = value.get("from", {}).get("id")

    if not comment_id or not text:
        return

    # O'zimiz yozgan (yoki javob sifatida yozilgan) kommentlarga javob bermaslik -> tsikl oldi olinadi
    if from_id and IG_ACCOUNT_ID and from_id == IG_ACCOUNT_ID:
        return
    if comment_id in _replied_comment_ids:
        return

    reply_text = find_reply(text, rules, default_key="comment_default_reply")
    try:
        client.reply_to_comment(comment_id, reply_text)
        _replied_comment_ids.add(comment_id)
        logger.info("Kommentga javob berildi: comment_id=%s", comment_id)
    except InstagramAPIError as e:
        logger.error("Kommentga javob berishda xato: %s", e)


if __name__ == "__main__":
    if not VERIFY_TOKEN:
        logger.warning(
            "WEBHOOK_VERIFY_TOKEN .env faylida bo'sh! Webhook tasdiqlanmaydi."
        )
    logger.info("DM avtojavob server ishga tushdi: http://0.0.0.0:%s/webhook", PORT)
    app.run(host="0.0.0.0", port=PORT)
