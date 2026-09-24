# Ishga tushirish qo'llanmasi (dasturchi uchun)

Loyiha to'liq tayyor. Faqat quyidagi kalitlarni ulasangiz, tizim to'liq ishlaydi.

## 1. O'rnatish

```bash
npm install
cp .env.example .env
```

## 2. `.env` ni to'ldirish

| O'zgaruvchi | Nima | Qayerdan |
|---|---|---|
| `VERIFY_TOKEN` | O'zingiz o'ylab topgan maxfiy so'z | ixtiyoriy matn |
| `APP_SECRET` | Webhook imzosini tekshirish | Meta App → Settings → Basic → App Secret |
| `ADMIN_EMAILS` | Admin bo'ladigan email(lar) | o'z emailingiz |
| `GEMINI_API_KEY` | Platforma AI kaliti (barcha bizneslar uchun) | https://aistudio.google.com/apikey (bepul) |
| `FB_APP_ID` | "Facebook bilan ulash" uchun (ixtiyoriy) | Meta App → Settings → Basic → App ID |
| `BASE_URL` | Serverning tashqi manzili (OAuth uchun) | masalan `https://bot.example.uz` |
| `GOOGLE_TTS_API_KEY` | Ovozli javob (ixtiyoriy) | Google Cloud Console → TTS API |

## 3. Ishga tushirish

```bash
npm start
```

Server startda yetishmayotgan sozlamalarni ogohlantiradi. `http://localhost:3000` — admin panel.

`ADMIN_EMAILS` dagi email bilan ro'yxatdan o'ting — avtomatik admin bo'lasiz.

## 4. Meta App va webhook (bir marta)

1. https://developers.facebook.com da App yarating.
2. Serverni internetga chiqaring (production: domen + HTTPS; test: `ngrok http 3000`).
3. Meta App → Webhooks:
   - **Callback URL**: `https://sizning-domen/webhook`
   - **Verify Token**: `.env` dagi `VERIFY_TOKEN`
4. Obunalar:
   - **Instagram**: `messages`, `comments`
   - **Page**: `messages`, `feed`
   - **WhatsApp**: `messages`
5. Instagram Business akkauntni Facebook sahifaga ulang.

## 5. Instagram'ni ulash — 2 usul

### Usul A — "Facebook bilan ulash" (tavsiya etiladi, self-service)

`FB_APP_ID` va `BASE_URL` sozlangan bo'lsa, tadbirkor **o'zi** ulaydi:
1. Meta App → **Facebook Login** mahsulotini qo'shing.
2. **Valid OAuth Redirect URIs** ga qo'shing: `<BASE_URL>/connect/facebook/callback`
3. Tadbirkor dashboardda **"🔵 Facebook bilan ulash"** tugmasini bosadi → Facebook'da ruxsat beradi → tizim sahifa va Instagram tokenlarini **avtomatik oladi** va sahifani webhooklarga ulaydi.

Sizga qo'lda hech narsa kiritish kerak emas. Tadbirkorda bir nechta sahifa bo'lsa, qaysi birini ulashni o'zi tanlaydi.

### Usul B — Admin qo'lda kiritadi (OAuth sozlanmagan bo'lsa)

`/admin` panelda har bir biznes uchun:
1. **Page Access Token**, **Page ID**, **Instagram Business ID** (IG + FB uchun).
2. **WhatsApp Token** va **Phone Number ID** (WhatsApp uchun — hozircha faqat shu usul).

### Obuna

To'lov kelgach `/admin` da obunani `+30 kun` yoki `+365 kun` faollashtirasiz.
Bo'ldi — o'sha biznesning boti ishlay boshlaydi.

## Tekshirish

- `GET /health` → `{"status":"ok"}` — server tirik.
- Meta panelda webhook "Verify and Save" bosilganda ✅ chiqishi kerak.
- Test xabar yuboring — server logida `[IG Direct] ...` ko'rinadi.

## Muhim eslatmalar

- Meta qoidasi: DM'da bot mijoz yozganidan keyin **24 soat** ichida erkin javob beradi.
- Kommentga shaxsiy javob **7 kun** ichida mumkin.
- Production uchun Meta App Review kerak: `instagram_manage_messages`,
  `instagram_manage_comments`, `pages_messaging`.
- Ma'lumotlar `data/db.json` da (git'ga kirmaydi) — muntazam zaxira nusxa oling.
