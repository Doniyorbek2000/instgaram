# Meta App Review — tayyorlov qo'llanmasi

Bu hujjat `ADM AI` (App ID: `993539666776696`) ilovasini App Review'dan o'tkazish uchun.
Maqsad: `instagram_business_*` ruxsatlariga **Advanced Access** olish — shundan keyin
istalgan tadbirkor o'z Instagram'ini platformaga ulay oladi (hozir faqat tester roli
berilgan akkauntlar ulana oladi).

## Qayerdan boshlanadi

Meta panel → **Use cases** → **Manage messaging & content on Instagram** → **Customize**
→ **Permissions and features** → har bir ruxsat yonidagi **"Request advanced access"**.

So'raladigan uchta ruxsat:

| Ruxsat | Nima uchun kerak |
|---|---|
| `instagram_business_basic` | Ulangan akkauntning ID va username'ini olish |
| `instagram_business_manage_messages` | Direct xabarlarni olish va javob yuborish |
| `instagram_business_manage_comments` | Kommentlarga javob berish va shaxsiy javob yuborish |

Meta har biri uchun 3 narsa so'raydi: **tushuntirish matni**, **screencast** (ekran yozuvi)
va **test ko'rsatmalari**. Quyida hammasi tayyor.

---

## 1. Tushuntirish matnlari (ingliz tilida, nusxa oling)

### instagram_business_basic

```
Our platform ("AI Biznes Yordamchi") lets small businesses in Uzbekistan connect their
own Instagram professional account and have an AI assistant reply to customer messages
on their behalf.

We use instagram_business_basic to identify the Instagram professional account that the
business owner connects through Instagram Business Login. Specifically, we call
GET /me?fields=id,user_id,username,account_type once, immediately after the OAuth flow.

We need this because:
1. The "user_id" value is what Instagram sends as "entry.id" in webhook events. We store
   it so that when a message arrives, we can route it to the correct business account on
   our multi-tenant platform.
2. We display the connected "username" in the business owner's dashboard so they can
   confirm the correct account is connected.

We do not read media, insights, followers or any other profile data.
```

### instagram_business_manage_messages

```
This is the core of our product. Business owners receive customer questions in Instagram
Direct (prices, delivery, working hours, product availability). Our AI assistant replies
automatically in the customer's language (Uzbek, Russian or English), using only the
business information that the owner has entered in our dashboard.

How we use the permission:
1. We subscribe the connected account to the "messages" webhook field.
2. When a customer sends a Direct message, we receive the webhook, look up which business
   the account belongs to, and generate a reply based on that business's own information.
3. We send the reply via POST /me/messages using the business's access token.
4. If the customer asks for a human ("operator"), the bot goes silent for 2 hours and the
   request is shown to the business owner in the dashboard.

We only reply to users who message the business first, and only within Meta's 24-hour
messaging window. We never send unsolicited or promotional messages.
```

### instagram_business_manage_comments

```
Business owners also receive questions as comments under their posts. With this
permission we:
1. Subscribe to the "comments" webhook field.
2. Post a short public reply to the comment (e.g. "We answered you in Direct").
3. Send a private reply to the commenter with the actual answer, using the business's
   own information.

This mirrors what the business owner would do manually, and only in response to comments
left on their own posts. We never comment on other accounts' content.
```

---

## 2. Screencast — nimani yozib olish kerak

Meta ekran yozuvini talab qiladi. Yozuv **ovozsiz** bo'lsa ham bo'ladi, lekin har bir
qadam **aniq ko'rinishi** kerak. Telefon va kompyuter ekranini birga yozing (yoki ikkita
alohida yozuv).

Ketma-ketlik (2-4 daqiqa):

1. `https://bot.abdujabborov-doniyorbek.uz` ochiladi — bosh sahifa ko'rinsin
2. **Ro'yxatdan o'tish** — yangi email bilan (jonli ko'rsating)
3. Dashboardda **biznes ma'lumotini** to'ldirish (mahsulot, narx, ish vaqti) va saqlash
4. **"📷 Instagram bilan ulash"** tugmasini bosish
5. Instagram ruxsat oynasi — **so'ralayotgan ruxsatlar ro'yxati ko'rinsin**
6. Ruxsat berilgach dashboardga qaytish — **"@username ulangan ✅"** ko'rinsin
7. **Telefonda**: boshqa Instagram akkauntdan shu biznesga Direct yozish — "Ko'ylak narxi qancha?"
8. **Botning javobi** kelishi — narx bilan
9. Xuddi shu tarzda **kommentga** javob berilishini ko'rsatish (post ostiga komment
   yozing → bot javob bersin)
10. Dashboardda **statistika** va **operator chaqirish** bo'limini ko'rsatish

Muhim: 5-qadam (ruxsat oynasi) va 8-qadam (bot javobi) — Meta eng ko'p e'tibor beradigan
joylar. Ular kesilib qolmasin.

---

## 3. Test ko'rsatmalari (Meta tekshiruvchisi uchun)

Bu matnni "Provide testing instructions" maydoniga qo'ying:

```
Test account for our platform (no Facebook login required):
  URL: https://bot.abdujabborov-doniyorbek.uz
  Email: reviewer@admai.uz
  Password: MetaReview2026

Steps:
1. Open the URL above and log in with the credentials.
2. The dashboard shows a "Biznes ma'lumoti" (business information) field — it is already
   filled with sample product and price data.
3. Click "📷 Instagram bilan ulash" (Connect Instagram). You will be redirected to
   Instagram Business Login. Please connect any Instagram professional account you
   control.
4. After returning, the dashboard shows the connected @username.
5. From any other Instagram account, send a Direct message to the connected account,
   for example: "How much is a dress?" or "What are your working hours?"
6. The AI assistant replies within a few seconds, using only the business information
   shown in the dashboard.
7. To test comments: leave a comment under any post of the connected account. The bot
   replies publicly and sends a private reply with the answer.

Note: the assistant replies in the language of the incoming message (Uzbek, Russian or
English). Our interface is in Uzbek because our customers are businesses in Uzbekistan.
```

**Bu hisob allaqachon yaratilgan va tekshirilgan** (2026-07-16): login ishlaydi, biznes
ma'lumoti (mahsulot, narx, manzil, ish vaqti) to'ldirilgan, "Instagram bilan ulash"
tugmasi ko'rinadi. Arizadan oldin o'zingiz ham bir marta kirib ko'ring — parol
o'zgartirilgan bo'lsa, hujjatdagi matnni ham yangilang.

---

## 3.5. "Submit for App Review" sahifasidagi 5 ta bo'lim

### App settings ✅
Allaqachon bajarilgan (privacy policy, terms, data deletion, ikonka, kategoriya).

### Reviewer instructions
Yuqoridagi 3-bo'limdagi matnni qo'ying.

### Allowed usage
Bu — tasdiqlash (certification). Har bir ruxsat uchun "biz uni faqat ruxsat etilgan
maqsadda ishlatamiz" degan mazmunda belgi qo'yiladi. Bizda hammasi rost:

| Ruxsat | Ruxsat etilgan maqsad | Bizda shundaymi |
|---|---|---|
| `instagram_business_basic` | Ulangan akkauntni aniqlash | ✅ faqat `/me` bir marta |
| `instagram_business_manage_messages` | Mijoz yozgan xabarga javob berish | ✅ faqat javob, spam yo'q |
| `instagram_business_manage_comments` | O'z postidagi kommentga javob | ✅ faqat o'z posti |

Agar "Do you use this permission for advertising / resale of data?" kabi savol chiqsa —
javob **Yo'q**. Biz ma'lumotni sotmaymiz, reklama uchun ishlatmaymiz.

### Data handling — tayyor javoblar

Savollar taxminan quyidagicha bo'ladi:

**"What Platform Data do you access?"**
```
Instagram Direct message content (text, and optionally voice/image/video attachments
sent by the customer), the Instagram-scoped sender ID, the message ID and timestamp,
and the connected business account's ID and username.
```

**"How do you use it?"**
```
Solely to generate and send an automated reply on behalf of the business that owns the
account, using business information that the business owner entered in our dashboard.
We also keep a short conversation context (last ~10 messages) so replies stay coherent,
and aggregate counters (number of messages, unique customers) shown to the business owner.
```

**"Do you transfer Platform Data to any third party?"**
```
Yes — to Google (Gemini API) as our AI service provider, solely to generate the reply
text. Message content is sent to the model at request time; Google acts as a processor
on our behalf. No other third parties receive Platform Data. We do not sell, rent or
share Platform Data for advertising.
```

**"Where is data stored?"**
```
On our own dedicated server located in Germany (EU).
```

**"How is data protected?"**
```
All traffic is over HTTPS/TLS. Webhook requests from Meta are verified with the
X-Hub-Signature-256 cryptographic signature. Passwords are hashed with scrypt.
Access tokens are stored server-side only and are never exposed to the browser.
Server access is restricted to SSH key authentication.
```

**"Data retention / deletion"**
```
Conversation context is limited to the most recent messages per chat; older messages are
discarded automatically. Business owners can disconnect their Instagram account at any
time from their dashboard, or delete their account entirely. Deletion requests sent to
our data deletion endpoint are completed within 30 days, including backups. See
https://bot.abdujabborov-doniyorbek.uz/data-deletion
```

### Verification — faqat siz qila olasiz

Meta kim ilova yaratayotganini bilishni talab qiladi. Ikki xil bo'lishi mumkin:
- **Individual verification** — shaxsni tasdiqlash (pasport/ID)
- **Business verification** — kompaniya hujjatlari: ro'yxatdan o'tish guvohnomasi,
  yuridik manzil tasdiqi, kompaniya nomiga telefon/veb-sayt

Sizning holatingiz — mijozlarga xizmat ko'rsatish, ya'ni **business verification** talab
qilinishi ehtimoli katta. Hujjatlar ADM AI biznes portfoliosi orqali topshiriladi.
Bu qism eng uzun cho'ziladi (bir necha kun — bir necha hafta).

## 4. Meta ko'p rad etadigan sabablar (oldini olamiz)

| Sabab | Bizda qanday |
|---|---|
| Privacy Policy yo'q yoki ishlamaydi | ✅ `/privacy-policy` — ishlaydi, real ma'lumot |
| Data deletion yo'li yo'q | ✅ `/data-deletion` — uchta usul yozilgan |
| Screencast'da ruxsat ishlatilishi ko'rinmaydi | Yuqoridagi 5 va 8-qadamlarga e'tibor bering |
| Test hisobi ishlamaydi | Arizadan oldin o'zingiz kirib tekshiring |
| Ilova Live emas | ✅ Published |
| Tushuntirish umumiy ("to manage messages") | ✅ Yuqoridagi matnlar aniq va batafsil |

## 5. Kutish

Meta odatda **3-7 kun** ichida javob beradi. Rad etsa — sababini yozadi, tuzatib qayta
yuborish mumkin, urinishlar soni cheklanmagan.

App Review tugagunicha platforma ishlayveradi — faqat App'da **tester roli** berilgan
Instagram akkauntlar ulana oladi. Ya'ni bir nechta mijoz bilan qo'lda boshlash mumkin:
Meta panel → App roles → Roles → Add People → Instagram Tester → mijozning username'i.
