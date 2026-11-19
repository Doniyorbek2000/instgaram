# Meta App Review — tayyorlov qo'llanmasi

Bu hujjat `Obunext` (App ID: `993539666776696`) ilovasini App Review'dan o'tkazish uchun.
Maqsad: `instagram_business_*` ruxsatlariga **Advanced Access** olish — shundan keyin
istalgan tadbirkor o'z Instagram'ini platformaga ulay oladi (hozir faqat tester roli
berilgan akkauntlar ulana oladi).

## Qayerdan boshlanadi

Meta panel → **Use cases** → **Manage messaging & content on Instagram** → **Customize**
→ **Permissions and features** → har bir ruxsat yonidagi **"Request advanced access"**.

Meta'dagi qoralama arizada (Review → App Review) oltita band bor:

| Ruxsat | Nima uchun kerak |
|---|---|
| `instagram_business_basic` | Ulangan akkauntning ID va username'ini olish |
| `instagram_business_manage_messages` | Direct xabarlarni olish va javob yuborish |
| `instagram_business_manage_comments` | Kommentlarga javob berish va shaxsiy javob yuborish |
| `instagram_business_content_publish` | Post, Reels, Karusel va Story joylash (/scheduler va Telegram bot) |
| `instagram_business_manage_insights` | /growth → "Statistika": reach va profile_views |
| Human Agent (feature) | Operator 24 soatdan keyin ham 7 kungacha javob bera olishi |

Ariza **Business verification** tugamaguncha yuborilmaydi (2026-11-19 holati: "ADM AI" —
*In review*).

Meta har biri uchun 3 narsa so'raydi: **tushuntirish matni**, **screencast** (ekran yozuvi)
va **test ko'rsatmalari**. Quyida hammasi tayyor.

---

## 1. Tushuntirish matnlari (ingliz tilida, nusxa oling)

> Matnlar kodga solishtirib yozilgan (2026-09-25). Yangi funksiya qo'shilsa, shu yerni ham
> yangilang — Meta'ga noto'g'ri tavsif rad etish yoki ilovani bloklashga olib keladi.

### instagram_business_basic

```
Obunext (https://obunext.uz) is a platform for small businesses in Uzbekistan. A business
owner connects their own Instagram professional account, and our AI assistant answers
their customers' Direct messages and comments on their behalf.

We use instagram_business_basic to:
1. Identify the connected professional account right after Instagram Business Login
   (GET /me?fields=user_id,username). The user_id is what Instagram sends as "entry.id" in
   webhook events; we store it to route each incoming event to the correct business on our
   multi-tenant platform, and we show the username in the owner's dashboard.
2. List the business's own posts and Reels (GET /{ig-user-id}/media) so the owner can pick
   which post a comment automation applies to, and — only when the owner clicks
   "Learn from Instagram" — read the captions of their own posts to pre-fill the AI's
   product/price knowledge base, which the owner reviews and edits before saving.

We only access the account the business owner connected themselves. We do not access
other accounts' content, followers lists or any data for advertising.
```

### instagram_business_manage_messages

```
This is the core of our product. Customers ask businesses in Instagram Direct about
prices, delivery, working hours and product availability. Our AI assistant replies in the
customer's language (Uzbek, Russian or English) using only the information the business
owner entered in our dashboard.

How we use the permission:
1. We subscribe the connected account to the "messages" and "messaging_postbacks" webhooks.
2. When a customer writes, we generate a reply from the business's own information and
   send it via POST /me/messages with the business's token. Replies can include quick-reply
   buttons, and the owner can build simple automated conversations (e.g. a lead form that
   asks for the customer's name and phone number).
3. We read the sender's name, username and profile picture (GET /{igsid}) to show them in
   the business's inbox, and "is_user_follow_business" when the owner enables a
   "follow to receive the gift" rule.
4. The business owner and their staff can read the conversation and reply manually from
   our inbox. If a customer asks for a human, the bot stops replying in that chat and the
   owner is notified.
5. We set the account's Ice Breakers and persistent menu (messenger_profile) when the owner
   configures them.
6. The owner can send a message to customers who have written to the business within the
   last 24 hours (e.g. "your order is ready"). Our system enforces Meta's 24-hour messaging
   window for all Instagram messages — messages to customers outside the window are never
   sent. Such messages include a "reply STOP to unsubscribe" note by default, and a
   customer who replies STOP is automatically excluded from all future bulk messages.
```

### instagram_business_manage_comments

```
Customers also ask questions in comments under the business's posts. With this permission:
1. We subscribe to the "comments" and "live_comments" webhook fields for the connected
   account.
2. We read comments on the business's own posts (GET /{media-id}/comments) so the owner can
   see them and choose a keyword for automation.
3. When a comment matches the owner's keyword rule, we post a short public reply
   (e.g. "We sent you the details in Direct") and send one private reply to the commenter
   with the answer, using the business's own information.

This mirrors what the owner would do manually, only on comments left on the business's own
posts. We never comment on other accounts' content.
```

### instagram_business_content_publish

```
Business owners plan their Instagram content in our "Post Scheduler" (https://obunext.uz/scheduler).
The owner uploads a JPEG photo or an MP4 video (or pastes a link to one), chooses the format —
feed photo, Reels, carousel (2-10 photos) or Story — writes the caption and picks a date and time.

At that time we publish it to the owner's own connected account:
1. POST /{ig-user-id}/media creates the media container (media_type REELS, STORIES or
   CAROUSEL with child containers, or image_url for a photo).
2. GET /{container-id}?fields=status_code until the video is processed (FINISHED).
3. POST /{ig-user-id}/media_publish publishes it. The result (published or Instagram's error
   message) is shown next to the post in the scheduler.

The owner can also send a photo or video to our Telegram bot for business owners and tap
"Post", "Reels" or "Story"; it goes through the same steps. Content is published only after
the owner chooses it — we never create or publish content on our own, and only to the
account the owner connected.
```

### instagram_business_manage_insights

```
The "Statistika" (Statistics) tab of our Growth page (https://obunext.uz/growth) shows the
business owner how their own connected account is doing, next to the number of messages our
assistant handled. We call GET /{ig-user-id}/insights with metric=reach,profile_views,
period=day for the last 7 days and display the totals and a daily chart.

We read insights only for the account the owner connected, show them only to that owner and
their staff, and do not share or sell them.
```

### Human Agent

```
Our AI assistant answers routine questions. When a customer asks for a person, or the owner
takes over a conversation, the bot stops replying in that chat and the owner is notified.
The owner or their staff then answer the customer themselves from our inbox.

Customers often write in the evening and staff reply the next working day, sometimes after
the 24-hour window. For these replies — and only for messages typed by a human in our inbox —
we send with messaging_type=MESSAGE_TAG and tag=HUMAN_AGENT, within 7 days of the customer's
last message. Automated, AI-generated and bulk messages never use this tag.
```

---

## 2. Screencast — nimani yozib olish kerak

Meta ekran yozuvini talab qiladi. Yozuv **ovozsiz** bo'lsa ham bo'ladi, lekin har bir
qadam **aniq ko'rinishi** kerak. Telefon va kompyuter ekranini birga yozing (yoki ikkita
alohida yozuv).

Ketma-ketlik (2-4 daqiqa):

1. `https://obunext.uz` ochiladi — bosh sahifa ko'rinsin
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
11. **Human Agent**: Inbox'da shu suhbatni oching, "operator" rejimiga o'tib qo'lda javob
    yozing — mijoz telefonida javob kelganini ko'rsating
12. **content_publish**: `/scheduler` → JPG yuklash → "Story" yoki "Rasm" → vaqtni hozirga
    qo'yib saqlash → 1-2 daqiqada "✅ Joylandi" chiqishi → Instagram profilida post/story
    ko'rinsin. Reels uchun MP4 bilan ham bir marta qiling
13. **manage_insights**: `/growth` → "📊 Statistika" tabi — reach va profile_views raqamlari
    ko'rinsin

Muhim: 5-qadam (ruxsat oynasi) va 8-qadam (bot javobi) — Meta eng ko'p e'tibor beradigan
joylar. Ular kesilib qolmasin.

---

## 3. Test ko'rsatmalari (Meta tekshiruvchisi uchun)

Bu matnni "Provide testing instructions" maydoniga qo'ying:

```
Test account for our platform (no Facebook login required):
  URL: https://obunext.uz/login
  Email: <reviewer hisobi emaili>
  Password: <parol>

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
8. Publishing: open https://obunext.uz/scheduler, upload a JPEG photo, choose "Story" (or
   "Rasm" for a feed photo), set the time to now and click "Rejalashtirish". Within about a
   minute the post shows "✅ Joylandi" and appears on the connected Instagram account.
9. Insights: open https://obunext.uz/growth and the "📊 Statistika" tab to see reach and
   profile views of the connected account.
10. Human Agent: in https://obunext.uz/inbox open the conversation from step 5 and reply
   manually; this reply is sent by a person, not the AI.

Note: the assistant replies in the language of the incoming message (Uzbek, Russian or
English). Our interface is in Uzbek because our customers are businesses in Uzbekistan.
```

**Test hisobining login va parolini bu faylga YOZMANG** — fayl git'da va serverda turadi.
Ularni faqat Meta formasidagi "testing instructions" maydoniga kiriting. Hisobda biznes
ma'lumoti (mahsulot, narx, manzil, ish vaqti) to'ldirilgan bo'lsin va "Instagram bilan ulash"
tugmasi ko'rinsin. Arizadan oldin o'zingiz bir marta kirib tekshiring.

**Muhim: reviewer hisobi Start, Pro yoki Business tarifida bo'lsin.** Mini, Lite va Bepul
tariflarda AI javoblar yo'q — tekshiruvchi Direct'ga yozganda bot javob bermaydi va ariza
rad etiladi. Admin panel → "Tarif sovg'a qilish" orqali hisobga Business tarifini
(masalan 90 kun) sovg'a qiling. URL doim `https://obunext.uz/login` bo'lsin — eski
domenlar (chat.voxo.uz va h.k.) ishlatilmasin.

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
| `instagram_business_basic` | Ulangan akkauntni aniqlash, o'z postlari ro'yxati | ✅ faqat ulangan akkaunt |
| `instagram_business_manage_messages` | Mijoz xabarlariga javob, inbox | ✅ 24 soatlik oyna majburiy, STOP ishlaydi |
| `instagram_business_manage_comments` | O'z postidagi kommentga javob | ✅ faqat o'z posti |

Agar "Do you use this permission for advertising / resale of data?" kabi savol chiqsa —
javob **Yo'q**. Biz ma'lumotni sotmaymiz, reklama uchun ishlatmaymiz.

### Data handling — tayyor javoblar

Savollar taxminan quyidagicha bo'ladi:

**"What Platform Data do you access?"**
```
For each Instagram professional account a business owner connects: the account's ID and
username; the business's own posts/Reels list and captions; comments on the business's own
posts; Instagram Direct messages sent to the business (text and, if the customer sends them,
voice/image/video attachments); the Instagram-scoped ID, name, username and profile picture
of customers who message or comment; and whether the customer follows the business (only
when the owner enables a follow-based rule).
```

**"How do you use it?"**
```
Solely to provide the service to the business that connected the account: generating and
sending replies to its customers' messages and comments, showing conversations in the
business's inbox so the owner and their staff can read and answer them, running the
automations the owner configured (keyword replies, lead forms, reminders within the 24-hour
window), and showing the owner aggregate statistics (message counts, number of customers).
We do not use Platform Data for advertising, profiling across businesses, or model training.
```

**"Do you transfer Platform Data to any third party?"**
```
1. AI processing: message text and attachments are sent at request time to Google (Gemini
   API) — and, only if Gemini is unavailable, to Anthropic (Claude API) — solely to generate
   the reply. They act as processors on our behalf.
2. At the business owner's direction only: if the owner connects their own CRM (amoCRM,
   Bitrix24), Google Sheets or webhook, the lead details their customers submitted (e.g. name
   and phone number) are sent to that system, which the business owner controls.
3. Encrypted off-site backups (encrypted with our own key before upload; the storage
   provider cannot read them).
We do not sell, rent or share Platform Data with anyone else.
```

**"Where is data stored?"**
```
On our server in the European Union (France), hosted by Contabo GmbH.
```

**"How is data protected?"**
```
All traffic uses HTTPS/TLS. Webhook requests from Meta are verified with the
X-Hub-Signature-256 signature. Instagram access tokens and other credentials are encrypted
at rest (AES-256-GCM) and never sent to the browser. User passwords are hashed with scrypt,
session tokens are stored only as hashes, and the admin panel is on a separate domain with
brute-force protection and an audit log. Each business can only access its own data.
```

**"Data retention / deletion"**
```
Conversation history is kept so the business can see past conversations in its inbox,
until the business deletes the conversation, disconnects Instagram, or deletes its account.
When a user removes our app on Instagram, our deauthorize callback disconnects the account
and deletes its access token; our data deletion callback additionally deletes the Instagram
conversation history and returns a confirmation code with a status page. Account deletion
requests by email are completed within 30 days, including backups.
Instructions: https://obunext.uz/data-deletion
```

> **Diqqat:** "encrypted at rest" gapi serverdagi `.env` ga `DATA_ENCRYPTION_KEY` qo'shilib
> deploy qilingandan keyin haqiqatga aylanadi — arizani undan keyin yuboring.

### Verification — faqat siz qila olasiz

Meta kim ilova yaratayotganini bilishni talab qiladi. Ikki xil bo'lishi mumkin:
- **Individual verification** — shaxsni tasdiqlash (pasport/ID)
- **Business verification** — kompaniya hujjatlari: ro'yxatdan o'tish guvohnomasi,
  yuridik manzil tasdiqi, kompaniya nomiga telefon/veb-sayt

Sizning holatingiz — mijozlarga xizmat ko'rsatish, ya'ni **business verification** talab
qilinishi ehtimoli katta. Hujjatlar Obunext biznes portfoliosi orqali topshiriladi.
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
