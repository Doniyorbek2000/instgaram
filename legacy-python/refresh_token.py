"""
Qisqa muddatli User Access Token'ni 60 kunlik long-lived tokenga almashtiradi.

Ishlatish:
    python refresh_token.py SHORT_LIVED_TOKEN

Natijada chiqqan long-lived tokenni Graph API Explorer orqali Page Access
Token va Instagram Business Account ID olish uchun ishlating (README.md, 3-bosqich).
"""

import sys
import os
import requests
from dotenv import load_dotenv

load_dotenv()


def exchange_token(short_lived_token: str) -> str:
    app_id = os.getenv("FB_APP_ID")
    app_secret = os.getenv("FB_APP_SECRET")
    version = os.getenv("GRAPH_API_VERSION", "v20.0")

    if not app_id or not app_secret:
        raise SystemExit("FB_APP_ID va FB_APP_SECRET .env faylida to'ldirilishi kerak.")

    resp = requests.get(
        f"https://graph.facebook.com/{version}/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": short_lived_token,
        },
        timeout=30,
    )
    data = resp.json()
    if "access_token" not in data:
        raise SystemExit(f"Xato: {data}")
    return data["access_token"]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Ishlatish: python refresh_token.py SHORT_LIVED_TOKEN")
        sys.exit(1)

    long_token = exchange_token(sys.argv[1])
    print("\nLong-lived token (60 kun amal qiladi):\n")
    print(long_token)
    print("\nBu tokenni Graph API Explorer'da ishlatib, Page Access Token va")
    print("IG_BUSINESS_ACCOUNT_ID ni oling (README.md 3-bosqich).")
