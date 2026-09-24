# AI Biznes Yordamchi 🤖

Instagram, Facebook va WhatsApp uchun **veb-platforma ko'rinishidagi AI avtomatlashtirish tizimi**. Rasmiy Meta Graph API asosida ishlaydi — akkauntlar blok bo'lish xavfi yo'q.

**Har qanday tadbirkor foydalana oladi**: saytda ro'yxatdan o'tadi, veb-panelda o'z biznesini AI'ga o'rgatadi (mahsulotlar, narxlar, manzil...), Instagram/WhatsApp/Facebook'ini ulaydi — bot mijozlarga xuddi tirik operator kabi javob bera boshlaydi.

## Imkoniyatlar

| | |
|---|---|
| 🌐 **Veb-panel** | Ro'yxatdan o'tish, kirish, barcha sozlamalar brauzerda — kod kerak emas |
| 🧠 **AI o'qitish** | Har bir biznes o'z ma'lumotlarini yozadi, AI shu asosda javob beradi |
| 💬 **Matn** | Instagram Direct, kommentlar, Messenger, WhatsApp — mijoz tilida (uz/ru/en) javob |
| 🎤 **Ovozli xabarlar** | AI ovozni eshitib, mazmuniga javob beradi (Gemini) |
| 📸 **Rasm va video** | AI ko'rib tahlil qiladi — mahsulot rasmi bo'lsa narxini aytadi |
| 🗣️ **Suhbat tarixi** | Har mijoz bilan kontekst saqlanadi — tabiiy muloqot |
| 🔵 **Facebook bilan ulash** | Tadbirkor Instagram'ini bir tugma bilan o'zi ulaydi (OAuth, tokenlar avtomatik) |
| 👥 **Multi-tenant** | Bitta serverda istalgancha biznes — har birining o'z kanallari va AI bilimi |
| 💳 **Oylik obuna** | 14 kun bepul sinov, so'ng oylik to'lov; obuna tugasa bot avtomatik to'xtaydi |
| 🎤 **Ovozli javob** | WhatsApp'da matn bilan birga ovozli javob (Google TTS, ixtiyoriy) |
| 📊 **Statistika** | Xabarlar, noyob mijozlar, buyurtma so'rovlari, kanal va kun kesimida |
| 🧑‍🤝‍🧑 **Mini-CRM** | Oxirgi mijozlar ro'yxati — kim, qaysi kanaldan, nima yozgani |
| 👤 **Operator chaqirish** | Mijoz "operator" desa bot jim bo'ladi, panelda murojaat ko'rinadi |
| 🔔 **Telegram bildirishnoma** | Operator chaqirilganda biznes egasiga Telegram'ga xabar keladi |
| ⚙️ **Admin panel** | Dasturchi barcha bizneslarni ko'radi, tokenlar kiritadi, to'lovni tasdiqlaydi |
| 🛡️ **Zaxira rejim** | AI ishlamasa kalit so'z qoidalari (`rules.json`) ishlaydi — mijoz javobsiz qolmaydi |

## Qanday ishlaydi

```
Mijoz (Instagram/WhatsApp/Facebook)
        │  xabar / ovoz / rasm / video
        ▼
Meta webhook ──► Server: qaysi biznesga tegishli? (ID bo'yicha)
        ▼
AI (Gemini) ◄── shu biznesning ma'lumotlari + suhbat tarixi
        ▼
Tabiiy javob mijozga qaytariladi
```

## Rollar

- **Dasturchi / admin (siz)** — platformani o'rnatadi, AI kalitini bir marta `.env` ga qo'yadi va har bir biznesning Meta tokenlarini admin-panelda kiritadi. Tadbirkorlar texnik narsalarga tegmaydi.
- **Tadbirkor (mijoz)** — faqat ro'yxatdan o'tadi va o'z biznesini AI'ga o'rgatadi. Token yoki kalit kiritmaydi.

## O'rnatish (dasturchi)

Talablar: Node.js 18+ (media tahlili uchun 18.17+ tavsiya).

> 📋 Qadam-baqadam ishga tushirish: **[SETUP.md](SETUP.md)** — faqat kalitlarni ulaysiz.

```bash
npm install
cp .env.example .env
npm start
```

Server startda yetishmayotgan sozlamalarni ogohlantiradi. `GET /health` orqali tirikligini tekshirish mumkin.

**Production'ga joylash** (Docker, PM2, HTTPS, backup): **[DEPLOY.md](DEPLOY.md)**. Eng oson yo'l:

```bash
cp .env.example .env   # to'ldiring
docker compose up -d --build
```

`.env` da to'ldiring:
- `VERIFY_TOKEN`, `APP_SECRET` — Meta webhook uchun
- `GEMINI_API_KEY` — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) dan olingan **platforma kaliti** (barcha bizneslar uchun bitta; bepul tarif bor)
- `ADMIN_EMAILS` — admin bo'ladigan email(lar), vergul bilan

So'ng shu `ADMIN_EMAILS` dagi email bilan ro'yxatdan o'ting — avtomatik admin bo'lasiz.

Brauzerda `http://localhost:3000`. Production'da domen ulang (webhook uchun HTTPS shart; test uchun `ngrok http 3000`).

### Bizneslarni ulash (admin panel)

`/admin` sahifasida barcha ro'yxatdan o'tgan bizneslar ko'rinadi. Har biriga:
1. Biznesning Facebook sahifasi/Instagram Business akkaunt/WhatsApp ma'lumotini olasiz.
2. "Sozlash" tugmasi orqali uning tokenlarini kiritasiz:
   - Page Access Token, Page ID, Instagram Business ID
   - WhatsApp Token, Phone Number ID
3. Saqlash bilan o'sha biznes boti ishga tushadi.

Kerak bo'lsa, alohida biznesga o'z Gemini kalitini ham berish mumkin (bo'sh qoldirsangiz platforma kaliti ishlaydi).

## Foydalanish (tadbirkor)

1. **Ro'yxatdan o'ting** — saytda email va parol bilan. Darhol **14 kunlik bepul sinov** boshlanadi.
2. **AI'ni o'rgating** — panelda biznesingiz haqida yozing: mahsulotlar, narxlar, manzil, ish vaqti, yetkazib berish, to'lovlar, savol-javoblar. Oddiy matn, kod kerak emas.
3. **Instagram'ni ulang** — dashboarddagi **"🔵 Facebook bilan ulash"** tugmasini bosasiz, Facebook'da ruxsat berasiz, tizim tokenlarni o'zi oladi. (WhatsApp uchun texnik jamoaga murojaat.)
4. Bo'ldi — mijozlaringizga AI javob bera boshlaydi.
5. **Obunani to'lang** — sinov tugagach, `/billing` sahifasidan tarifni tanlab to'lang, aks holda bot to'xtaydi.

> "Facebook bilan ulash" tugmasi platformada `FB_APP_ID` sozlangan bo'lsa ko'rinadi. Aks holda tokenlarni admin qo'lda kiritadi.

## Obuna (oylik to'lov)

- Yangi biznes **14 kun bepul** sinaydi.
- Sinov yoki obuna tugasa bot avtomatik javob berishni to'xtatadi.
- To'lovni tadbirkor amalga oshiradi (hozircha karta orqali, chekni yuboradi), admin `/admin` panelida tasdiqlab, obunani `+30 kun` yoki `+365 kun` faollashtiradi.
- Tariflar: **Start** (matn javoblari) va **Pro** (ovoz/rasm/video + TTS + operator rejimi). Narxlar `src/subscription.js` da.
- Payme/Click avtomatik to'lovi — kelajakda qo'shiladigan joy tayyor.

## Statistika, operator va ovozli javob

- **Statistika**: dashboardda jami xabarlar, noyob mijozlar, buyurtma so'rovlari, oxirgi 7 kun grafigi va kanal kesimi.
- **Operator chaqirish**: mijoz "operator", "odam bilan gaplashaman" desa, bot 2 soatga jim bo'ladi va murojaat panelda ko'rinadi. Siz Instagram/WhatsApp ilovasidan javob berasiz, so'ng "Hal qilindi" bosasiz.
- **Ovozli javob (TTS)**: `.env` da `GOOGLE_TTS_API_KEY` sozlansa, tadbirkor dashboardda yoqishi mumkin — WhatsApp'da matn bilan birga ovozli javob ketadi.

## Meta App sozlash (bir marta, server egasi)

1. [developers.facebook.com](https://developers.facebook.com) da App yarating.
2. Webhooks bo'limida Callback URL: `https://domeningiz/webhook`, Verify Token: `.env` dagi `VERIFY_TOKEN`.
3. Obunalar: **Instagram** — `messages`, `comments`; **Page** — `messages`, `feed`; **WhatsApp** — `messages`.
4. Production uchun App Review: `instagram_manage_messages`, `instagram_manage_comments`, `pages_messaging` ruxsatlari.

## Muhim Meta qoidalari

- DM'da bot mijoz yozganidan keyin **24 soat ichida** erkin javob bera oladi.
- Kommentga shaxsiy javob (Private Reply) komment yozilganidan keyin **7 kun ichida** mumkin.

## Test

```bash
npm test
```

## Loyiha tuzilishi

```
src/
  index.js              — Express server: veb-panel + multi-tenant webhook
  config.js             — .env sozlamalari
  db.js                 — foydalanuvchilar bazasi (JSON fayl), platforma ID routing
  auth.js               — ro'yxat/kirish, scrypt parol hash, cookie sessiyalar
  web/
    layout.js           — HTML shablon
    routes.js           — sahifalar: tadbirkor dashboardi + admin panel
  ai.js                 — multimodal AI (Gemini: matn+ovoz+rasm+video; Claude: matn+rasm)
  respond.js            — javob orkestratori: obuna → operator → statistika → AI
  subscription.js       — obuna: trial, tariflar, faollashtirish, gating
  engagement.js         — statistika + operator chaqirish (handoff)
  tts.js                — Google TTS bilan ovozli javob (ixtiyoriy)
  media.js              — IG/WhatsApp mediani yuklab olish (base64)
  oauth.js              — "Facebook bilan ulash" (OAuth, tokenlarni avtomatik olish)
  notify.js             — Telegram bildirishnomalari
  dedup.js              — takroriy webhook xabarlarini filtrlash
  autoReply.js          — kalit so'z qoidalari (zaxira rejim)
  graph.js              — Meta Graph API so'rovlari (retry bilan)
  handlers/             — Instagram, Facebook, WhatsApp hodisalari
  services/             — javob yuborish (matn + ovoz, har biznes tokeni bilan)
rules.json              — zaxira javob qoidalari
business.md             — biznes ma'lumotlari namunasi (panelga ko'chirish uchun)
data/db.json            — baza (avtomatik yaratiladi, git'ga kirmaydi)
legacy-python/          — eskirgan Python skriptlar (main.py, scheduler.py, dm_autoresponder.py,
                           analytics.py, refresh_token.py, utils/). Hozirgi Node.js platformasi
                           (src/) bilan bog'liq emas va ishga tushirilmaydi — faqat tarixiy
                           referens sifatida saqlanmoqda.
```

## Kengaytirish g'oyalari

- Payme/Click/Uzum orqali avtomatik to'lov (hozir admin qo'lda tasdiqlaydi)
- IG/Messenger uchun ovozli javob (hozir TTS faqat WhatsApp'da)
- Buyurtmalarni alohida ro'yxat sifatida boshqarish (CRM)
- PostgreSQL'ga o'tish (hozir JSON fayl — kichik/o'rta yuk uchun yetarli)
