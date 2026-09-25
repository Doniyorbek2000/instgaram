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
| 💳 **Oylik obuna** | 3 kun bepul sinov, so'ng oylik to'lov (Payme); obuna tugasa bot avtomatik to'xtaydi |
| 🎤 **Ovozli javob** | WhatsApp'da matn bilan birga ovozli javob (Google TTS, ixtiyoriy) |
| 📊 **Statistika** | Xabarlar, noyob mijozlar, buyurtma so'rovlari, kanal va kun kesimida |
| 🧑‍🤝‍🧑 **Mini-CRM** | Oxirgi mijozlar ro'yxati — kim, qaysi kanaldan, nima yozgani |
| 👤 **Operator chaqirish** | Mijoz "operator" desa bot jim bo'ladi, panelda murojaat ko'rinadi |
| 🔔 **Telegram bildirishnoma** | Operator chaqirilganda biznes egasiga Telegram'ga xabar keladi |
| ⚙️ **Admin panel** | Dasturchi barcha bizneslarni ko'radi, tokenlar kiritadi, to'lovni tasdiqlaydi |
| 🛡️ **Zaxira rejim** | AI ishlamasa kalit so'z qoidalari (`rules.json`) ishlaydi — mijoz javobsiz qolmaydi |
| 🧩 **Flow Builder** | Vizual muharrir: xabar → savol → shart → amal → kutish → AI → boshqa flow. Bloklarni sudrab ulash, AI bilan flow yaratish, tayyor shablonlar (`/flows`) |
| 🎯 **Triggerlar** | Direct kalit so'z, post/Reels kommenti, jonli efir kommenti, story javobi va mention, yangi kontakt, referal havola. Moslik: kalit so'zlar, aniq, regex yoki **AI (ma'no bo'yicha)** |
| 🔀 **Shartlar** | Teg, hafta kuni, ish vaqti, sana oralig'i, ballar, o'zgaruvchi, obuna holati, kanal |
| ⚡ **Amallar** | Teg qo'shish/olish, o'zgaruvchi, ball, konversiya, operatorga o'tkazish, Telegram bildirishnoma, webhook/CRM |
| 🔤 **O'zgaruvchilar** | `{name\|do'stim}`, `{first_name}`, `{username}`, `{phone}`, `{points}` va yig'ilgan har qanday maydon — barcha xabarlarda |
| ⏰ **Eslatma va follow-up** | Obuna bo'lmaganlarga N daqiqadan so'ng eslatma, sovg'adan keyin kechiktirilgan xabar (server qayta ishga tushsa ham saqlanadi) |
| 📢 **Ommaviy xabarlar** | Teg bo'yicha segment, istisno teglar, 24 soatlik oyna filtri, o'zgaruvchilar, tugmalar, flow ishga tushirish, rejalashtirish, jonli progress |
| 📊 **Analitika** | 7/30/90 kun: kunlik xabarlar, flow boshlanishi va konversiyalar grafigi, flow va qoidalar jadvali (`/analytics`) |
| 🏆 **Geymifikatsiya** | Ballar, sovg'alar do'koni (promokodlar), viktorina, referal, ochiq reyting sahifasi `/top/<slug>` (`/game`) |
| 📝 **Lid formalari** | DM so'rovnoma konstruktori, arizalar, CSV eksport (`/forms`) |
| 🔌 **Integratsiyalar** | Webhook (Make, Zapier, n8n, amoCRM, Bitrix24) va Google Sheets, sinov va jurnal (`/integrations`) |
| 👋 **Ice Breakers** | Instagram salomlashuv tugmalari API orqali, har biri flow'ga ulanadi |
| 👥 **Jamoa** | Xodimni havola orqali taklif qilish, rollar: administrator / operator / kuzatuvchi (`/team`) |
| 🎬 **AI Kontent studiya** | Reels ssenariy, karusel (PNG), post matni, kontent reja, g'oyalar; Reels'dan bir bosishda komment flow (`/content`) |
| 📎 **Media xabarlar** | Rasm, video, audio, PDF/Office va Instagram postini flow va ommaviy xabarlarda yuborish; media kutubxona (`/media`) |
| 🪪 **Mijoz kartochkasi** | 24 soatlik oyna holati, teglar, o'zgaruvchilar, eslatma, ballar, arizalar, flow'ni qo'lda ishga tushirish (`/clients/c/...`); CRM va Inbox'da teg/oyna filtrlari |
| 💼 **Telegram Business** | AI egasining shaxsiy Telegram akkauntidan javob beradi; egasi yozsa bot jim bo'ladi |
| 🧠 **Instagram'dan o'rganish** | AI profil va postlardan mahsulot, narx, FAQ va yozish uslubini ajratib bilim bazasiga qo'shadi (`/ai-learn`) |
| 🤖 **Claude (MCP)** | Claude'ni ulab, flow'larni suhbat orqali yaratish/tahrirlash, statistika va ommaviy xabar (`/mcp/<token>`) |
| 🆓 **Bepul tarif va AI kreditlari** | Oylik AI limiti, Payme orqali kredit paketlari, bepul tarifda flow/qoidalar ishlashda davom etadi |

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

- **Platforma egasi (admin)** — `adm.obunext.uz` dagi alohida admin panel (telefon + parol, audit jurnali): bizneslar, to'lovlar, tariflar, AI xarajati, tizim holati va zaxira nusxalar.
- **Tadbirkor (mijoz)** — ro'yxatdan o'tadi, biznesini AI'ga o'rgatadi, Instagram'ini bir tugma bilan ulaydi. Token yoki kalit kiritmaydi.
- **Jamoa a'zosi** — egasi taklif qilgan xodim (administrator / operator / kuzatuvchi).

## Tezkor start (dasturchi)

Talablar: Node.js 20.16+, Docker (production).

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3015
npm run check        # lint + 220+ test (~5 soniya)
```

- Batafsil sozlash va **Meta Developer panel** ro'yxati: [SETUP.md](SETUP.md)
- Serverga joylash, zaxira, monitoring: [DEPLOY.md](DEPLOY.md) — `npm run deploy`
- Meta App Review tayyorgarligi: [APP_REVIEW.md](APP_REVIEW.md)

## Obuna va to'lov

- Yangi biznes **3 kun bepul** sinaydi (`src/trial.js` — sayt matnlari shu qiymat bilan test orqali solishtiriladi).
- To'lov **Payme** orqali avtomatik (fiskal chek bilan); obuna tugasa bot to'xtaydi, flow/qoidalar bepul tarifda ishlashda davom etadi.
- Tariflar va narxlar — admin panel → Tariflar (`src/subscription.js` da standart qiymatlar).

## Xavfsizlik

| | |
|---|---|
| Webhooklar | `X-Hub-Signature-256` imzosi (secret yo'q bo'lsa — rad etiladi); faqat aniq ID bo'yicha biznesga yo'naltiriladi |
| Maxfiy ma'lumotlar | Meta/Telegram tokenlari, to'lov kalitlari, SMS/SMTP parollari bazada AES-256-GCM bilan shifrlangan (`DATA_ENCRYPTION_KEY`) |
| Sessiyalar | Bazada faqat sha256 xeshi; parol — scrypt (asinxron), kamida 8 belgi |
| Admin panel | Alohida domen (`ADMIN_HOST`), kodda standart parol yo'q, IP bo'yicha brute-force bloki, audit jurnali |
| CSRF | SameSite cookie + Origin tekshiruvi |
| SSRF | Foydalanuvchi URL'lari (webhook, Sheets, CRM, flow HTTP bloki) DNS orqali tekshiriladi, redirectlar qadam-baqadam |
| Meta callback'lari | `/meta/deauthorize`, `/meta/data-deletion` — imzolangan so'rov |
| Zaxira | Kunlik; serverdan tashqariga (Telegram) faqat shifrlangan nusxa |

## Ishonchlilik

- Kiruvchi webhook 200 qaytarishdan oldin bazaga yoziladi — deploy yoki yiqilishda yo'qolmaydi, qayta ishga tushganda davom ettiriladi.
- PostgreSQL ulanmasa server to'xtaydi (JSON'ga jimgina o'tib ma'lumotni ikkiga bo'lmaydi); Docker qayta urinadi.
- Fon vazifalari (ommaviy xabar, follow-up, zaxira) Postgres qulfi bilan faqat bitta jarayonda ishlaydi.
- Deploy: build ishlab turgan sayt yonida, sog'liq tekshiruvi, xato bo'lsa avtomatik rollback.

## Loyiha tuzilishi

```
src/
  index.js            — Express server: marshrutlar, webhook navbati, fon vazifalari
  env.js, paths.js    — .env yuklash (testlarda emas), DATA_DIR
  config.js           — sozlamalar
  db.js / pgdb.js     — ma'lumotlar qatlami (PostgreSQL; lokal ishlab chiqishda JSON fayl)
  secretBox.js        — maxfiy maydonlarni shifrlash
  auth.js             — ro'yxat/kirish, sessiyalar, parolni tiklash
  csrf.js, netguard.js, securityHeaders.js — xavfsizlik qatlamlari
  metaCallbacks.js    — Meta deauthorize / data deletion
  monitor.js          — xatolar, Telegram ogohlantirish, strukturalangan log, X-Request-Id
  ai.js               — Gemini (asosiy) + Claude (zaxira)
  handlers/, services/ — Instagram, Facebook, WhatsApp hodisalari va javob yuborish
  flows.js, rules.js, broadcasts.js, sequences.js, … — avtomatlashtirish
  admin/              — platforma admin paneli
  web/                — biznes kabineti va ommaviy sayt (server tomonda HTML)
scripts/
  deploy.js           — deploy (rollback bilan)
  ssh.js              — server buyruqlari (status, logs, users, …)
  restore.mjs         — zaxiradan tiklash (shifrlangan nusxani ham ochadi)
  pg_backup.sh        — server cron'i uchun pg_dump
test/                 — node:test; har fayl vaqtinchalik papkada, .env o'qilmaydi
```

## Ma'lum cheklovlar va keyingi qadamlar

- **Ma'lumotlar modeli:** har bir biznesning barcha ma'lumoti (kontaktlar, flow sessiyalari, statistika) `users` jadvalidagi JSONB ustunlarda va xotiradagi keshda. Yuzlab faol biznesgacha yetarli; undan keyin kontaktlar/sessiyalarni alohida jadvallarga ajratish va gorizontal kengaytirish kerak bo'ladi.
- **Katta fayllar:** `web/routes.js`, `web/assets/flow-builder.js`, `web/site.js` (1000+ qator) — bo'limlarga ajratish rejalashtirilgan.
- **Tiplar:** TypeScript/JSDoc tiplari yo'q; ESLint CI'da ishlaydi.
