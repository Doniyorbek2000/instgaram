# Ishga tushirish qo'llanmasi (dasturchi uchun)

## 1. Lokal ishga tushirish

Talab: Node.js 20.16+.

```bash
npm install
cp .env.example .env     # kerakli qiymatlarni to'ldiring
npm run dev              # http://localhost:3015
npm run check            # lint + testlar
```

`PG_*` bo'sh bo'lsa ma'lumotlar `data/db.json` fayliga yoziladi (lokal ishlab chiqish uchun qulay).
Testlar `.env` ni o'qimaydi va `data/` ga tegmaydi — har fayl vaqtinchalik papkada ishlaydi.

## 2. `.env` — asosiylari

| O'zgaruvchi | Nima | Qayerdan |
|---|---|---|
| `APP_SECRET` | Webhook imzosi (majburiy) | Meta App → Settings → Basic → App Secret |
| `VERIFY_TOKEN` | Webhook tasdiqlash so'zi | o'zingiz o'ylab topasiz |
| `IG_APP_ID`, `IG_APP_SECRET` | "Instagram bilan ulash" | Meta App → Instagram → API setup with Instagram login |
| `BASE_URL` | Tashqi manzil | `https://obunext.uz` |
| `ADMIN_HOST` | Admin panel domeni | `adm.obunext.uz` |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | Admin panelga birinchi kirish | o'zingiz |
| `DATA_ENCRYPTION_KEY` | Tokenlarni shifrlash | `openssl rand -hex 32` |
| `GEMINI_API_KEY` | Asosiy AI | https://aistudio.google.com/apikey |
| `ANTHROPIC_API_KEY` | Zaxira AI (ixtiyoriy) | https://platform.claude.com |

To'liq ro'yxat va izohlar — `.env.example`.

## 3. Meta Developer panel (developers.facebook.com → App 993539666776696)

### App settings → Basic
- **App domains:** `obunext.uz`
- **Privacy Policy URL:** `https://obunext.uz/privacy-policy`
- **Terms of Service URL:** `https://obunext.uz/terms`
- **User data deletion → Data deletion instructions URL:** `https://obunext.uz/data-deletion`
- **App icon** (1024×1024 — repodagi `app-icon-1024.png`), **Category**, **Contact email**
- **App Secret** → serverdagi `.env` → `APP_SECRET` bilan bir xil bo'lsin

### Use cases → Instagram → API setup with Instagram login
- **Webhooks → Callback URL:** `https://obunext.uz/webhook`, **Verify token:** `.env` → `VERIFY_TOKEN` → *Verify and save*
- **Webhook fields** (Subscribe): `messages`, `comments`, `live_comments`, `messaging_postbacks`
  (story javoblari va mention'lar `messages` orqali keladi)
- **Business login settings → OAuth redirect URIs:** `https://obunext.uz/connect/instagram/callback`
- **Deauthorize callback URL:** `https://obunext.uz/meta/deauthorize`
- **Data deletion request URL:** `https://obunext.uz/meta/data-deletion`
  (imzolangan so'rov qabul qilinadi, ulanish uziladi, IG suhbatlari o'chiriladi, Meta'ga tasdiq kodi qaytadi)

### Messenger (Facebook sahifa) — ishlatilsa
- Webhook: `https://obunext.uz/webhook`, fields: `messages`, `messaging_postbacks`, `feed`

### WhatsApp — ishlatilsa
- Configuration → Webhook: `https://obunext.uz/webhook`, field: `messages`

### App Review → Permissions and features
| Ruxsat | Kerak | Holat |
|---|---|---|
| `instagram_business_basic` | ulash | Advanced access so'raladi |
| `instagram_business_manage_messages` | Direct javoblar | Advanced access so'raladi |
| `instagram_business_manage_comments` | kommentlarga javob | Advanced access so'raladi |
| `instagram_business_content_publish` | post rejalashtirish | tasdiqlangach `.env` → `IG_EXTRA_SCOPES` |
| `instagram_business_manage_insights` | statistika bo'limi | tasdiqlangach `.env` → `IG_EXTRA_SCOPES` |

Tushuntirish matnlari, screencast rejasi va test ko'rsatmalari — [APP_REVIEW.md](APP_REVIEW.md).

### Business verification
Business Settings → Security Center → Start verification (kompaniya hujjatlari). App Review uchun talab qilinadi.

### App roles
App Review tugaguncha faqat **Instagram Tester** roli berilgan akkauntlar ulana oladi:
App roles → Roles → Add People → Instagram Tester.

## 4. Google (ixtiyoriy — "Google bilan kirish")

Google Cloud Console → Credentials → OAuth Client ID (Web):
**Authorized redirect URI:** `https://obunext.uz/auth/google/callback`

## 5. Tekshirish

- `GET /health` → `{"status":"ok"}`
- Meta panelda *Verify and save* → ✅
- Test xabar yuboring — `npm run server logs` da `[Webhook] instagram | id: ...` ko'rinadi.
  `Hodisa uchun biznes topilmadi` chiqsa — biznesning Instagram ID'si panelda to'g'ri ulanmagan.

## Meta qoidalari

- DM'da bot mijoz yozganidan keyin **24 soat** ichida erkin javob beradi.
- Kommentga shaxsiy javob **7 kun** ichida mumkin.
