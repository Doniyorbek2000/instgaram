/**
 * Bosh sahifaning yangi bo'limlari uchun matnlar (uz / ru / en):
 * hero kartochkalari, integratsiyalar, mahsulot ko'rgazmasi, imkoniyatlar,
 * kanallar, soha bo'yicha misollar va demo suhbatlar.
 */

export const HOME = {
  // ==================== O'ZBEKCHA ====================
  uz: {
    heroSecondary: "Qanday ishlaydi",
    heroChannels: "Instagram · Telegram · WhatsApp · Messenger",
    float: {
      comment: "Komment → Direct",
      commentSub: "\"narx\" deb yozdi — 1 soniyada javob",
      speed: "0.8 s",
      speedSub: "o'rtacha javob vaqti",
      lead: "Yangi lid",
      leadSub: "Aziza · +998 90 ••• 45 67",
    },
    sim: {
      ig: { handle: "guli_do'koni", sub: "Instagram · Direct", c1: "Salom! Ko'ylak narxi qancha? 😊", b1: "Assalomu alaykum! Ko'ylaklarimiz 150 000 – 300 000 so'm. Qaysi rang qiziqtiradi?", q: ["Qizil", "Qora", "Katalog"], c2: "Qizil, yetkazib berasizmi?", b2: "Ha ✅ Toshkent bo'ylab 1 kunda, 20 000 so'm. Buyurtma beraylikmi?" },
      tg: { handle: "obunext_bot", sub: "Telegram · Bot", c1: "/start", b1: "Assalomu alaykum! 🤖 Kursimizga xush kelibsiz. Bepul darsni olish uchun kanalga obuna bo'ling:", q: ["Obuna bo'ldim ✅", "Narxlar"], c2: "Obuna bo'ldim", b2: "Rahmat! 🎁 Bepul dars: obunext.uz/dars. Ismingizni yozing — sertifikat tayyorlaymiz." },
      wa: { handle: "+998 90 123 45 67", sub: "WhatsApp · Cloud API", c1: "Assalomu alaykum, buyurtma bermoqchi edim.", b1: "Vaalaykum assalom! 💚 Qaysi mahsulot ma'qul bo'ldi?", q: ["Katalog", "Operator"], c2: "2 ta qora futbolka, L o'lcham.", b2: "Qabul qilindi! Jami 240 000 so'm. Payme yoki Click orqali to'lashingiz mumkin." },
      fb: { handle: "Fashion Store", sub: "Facebook · Messenger", c1: "Manzilingiz qayerda?", b1: "Toshkent, Amir Temur ko'chasi 45. Mo'ljal: Yunusobod metrosi 📍", q: ["Xarita", "Ish vaqti"], c2: "Dostavka narxi qancha?", b2: "Toshkent bo'ylab 20 000 so'm, viloyatlarga BTS orqali 30 000 so'm." },
    },
    platforms: {
      title: "Rasmiy integratsiyalar va ulanishlar",
      extra: ["Google Sheets", "Make · Zapier · n8n", "Payme · Click", "Claude (MCP)"],
    },
    showcase: {
      badge: "Mahsulot",
      title: "Bitta platforma — butun savdo voronkasi",
      sub: "Mijoz birinchi komment yozganidan to'lovgacha — hammasi avtomatik va bitta panelda.",
      more: "Batafsil",
      rows: [
        {
          eyebrow: "Flow Builder",
          title: "Voronkalarni sudrab-tashlab yarating",
          text: "Xabar, tugma, savol, shart, kutish va AI bloklarini ulang. Tayyor shablondan boshlang yoki AI'ga nima kerakligini yozing — u flow'ni o'zi quradi.",
          points: ["12+ tayyor shablon va AI bilan yaratish", "Obunani tekshirish, teg, ball, CRM'ga yozish", "Simulyator, xatolarni tekshirish, versiyalar tarixi"],
        },
        {
          eyebrow: "Live Inbox va CRM",
          title: "Barcha suhbatlar va mijozlar bir joyda",
          text: "Instagram, Telegram, WhatsApp va Messenger xabarlari bitta oynada. Har bir mijozning teglari, telefoni, formalari va 24 soatlik oynasi ko'rinadi.",
          points: ["Operator rejimi: kerak bo'lsa AI'ni chat bo'yicha o'chiring", "Teg, kanal va faollik bo'yicha filtrlar", "Jamoa: rollar va har bir operator uchun kirish"],
        },
        {
          eyebrow: "Analitika va ommaviy xabarlar",
          title: "Natijani raqamlarda ko'ring",
          text: "Qaysi flow ko'proq lid va sotuv olib kelayotganini kuzating. Teg bo'yicha tanlangan mijozlarga shaxsiy ommaviy xabar yuboring.",
          points: ["Kunlik xabarlar, lidlar va konversiya", "Teg bo'yicha segmentlash va {name} bilan shaxsiylashtirish", "Google Sheets, Make, amoCRM, Bitrix24'ga uzatish"],
        },
      ],
    },
    mock: {
      flow: {
        trigger: "Trigger", triggerText: "Reels kommenti: \"NARX\"",
        message: "Xabar", messageText: "Salom {name}! Narxlar ro'yxati 👇", button: "Narxlarni olish",
        condition: "Shart", conditionText: "Sahifaga obuna bo'lganmi?", yes: "Ha", no: "Yo'q",
        input: "Savol", inputText: "Telefon raqamingiz?",
        action: "Amal", actionText: "Teg: lid · CRM · Telegram",
      },
      inbox: {
        title: "Live Inbox", all: "Barchasi", ai: "AI", operator: "Operator",
        chats: [
          { n: "Aziza K.", m: "Qizil rangi bormi?", ch: "instagram", tag: "lid", t: "2 daq" },
          { n: "Sardor", m: "Buyurtma beraman", ch: "telegram", tag: "vip", t: "5 daq" },
          { n: "Malika", m: "Dostavka qachon?", ch: "whatsapp", tag: "mijoz", t: "12 daq" },
          { n: "Jasur T.", m: "Rahmat, oldim 👍", ch: "facebook", tag: "sotuv", t: "1 soat" },
        ],
        card: "Mijoz kartochkasi", phone: "Telefon", window: "24 soatlik oyna", windowLeft: "21 soat qoldi", aiOn: "AI javob: yoqilgan", tags: "Teglar",
      },
      stats: {
        kpi: [{ l: "Xabarlar", v: "12 480" }, { l: "Lidlar", v: "1 284" }, { l: "Konversiya", v: "18.4%" }],
        chart: "Lidlar — oxirgi 7 kun",
        days: ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"],
        broadcast: "Ommaviy xabar", broadcastText: "\"vip\" tegi · 842 kishi", sent: "Yuborildi",
      },
    },
    bento: {
      badge: "Imkoniyatlar",
      title: "O'sish uchun kerakli hamma narsa",
      sub: "ChatPlace va ManyChat'dagi imkoniyatlar — o'zbek tilida va mahalliy to'lovlar bilan.",
      items: [
        { icon: "flow", title: "Vizual Flow Builder", text: "Ko'p bosqichli voronkalar: xabar → shart → amal → kutish. Telefonda ham tahrirlanadi." },
        { icon: "bolt", title: "Komment → Direct", text: "Post, Reels va jonli efirdagi kalit so'zga avtomatik ochiq javob va Direct xabar." },
        { icon: "megaphone", title: "Ommaviy xabarlar", text: "Teg va kanal bo'yicha segmentlab, shaxsiy xabarlar yuboring." },
        { icon: "users", title: "CRM va teglar", text: "Mijoz kartochkasi, maydonlar, izohlar, CSV eksport va filtrlar." },
        { icon: "spark", title: "O'rgatiladigan AI", text: "Instagram profilingizdan mahsulot, narx va uslubingizni o'rganadi. Ish vaqti bo'yicha yoqiladi yoki o'chiriladi." },
        { icon: "form", title: "Lid formalari", text: "Ism, telefon va savollarni chatda yig'ib, Google Sheets'ga yozadi." },
        { icon: "trophy", title: "Konkurs va geymifikatsiya", text: "Ball, referal havola, reyting va sovg'alar bilan faollikni oshiring." },
        { icon: "film", title: "AI kontent studiya", text: "Reels ssenariysi, karusel, post matni va kontent-reja bir necha soniyada." },
        { icon: "team", title: "Jamoa va rollar", text: "Operator, menejer va admin — har biriga o'z kirish huquqi." },
        { icon: "chart", title: "Analitika", text: "Flow'lar, lidlar va konversiyalar bo'yicha kunlik statistika." },
        { icon: "key", title: "Claude bilan boshqarish (MCP)", text: "Oddiy tilda yozing: \"Reels uchun giveaway flow qil\" — Claude o'zi yaratadi." },
        { icon: "shield", title: "Rasmiy Meta API", text: "Instagram, WhatsApp va Messenger rasmiy API orqali — akkaunt bloklanmaydi." },
      ],
    },
    channels: {
      badge: "Kanallar",
      title: "Mijozlar qayerda bo'lsa — siz ham o'sha yerdasiz",
      sub: "Har bir kanalning o'ziga xos imkoniyatlari to'liq ishlatiladi.",
      items: [
        { key: "instagram", cls: "ig", title: "Instagram", text: "Direct, kommentlar, Story va jonli efir.", points: ["Kommentga avto-DM va ochiq javob", "Story mention va reply", "Ice breaker va referal havolalar"] },
        { key: "telegram", cls: "tg", title: "Telegram", text: "Bot, kanal obunasi va Telegram Business.", points: ["Obuna va boost'ni tekshirish", "Shaxsiy akkauntdan AI javob (Business)", "Ovozli va rasmli xabarlar"] },
        { key: "whatsapp", cls: "wa", title: "WhatsApp", text: "Meta Cloud API orqali rasmiy ulanish.", points: ["Buyurtma va to'lovni tasdiqlash", "Media, fayl va katalog", "24 soatlik oyna nazorati"] },
        { key: "facebook", cls: "fb", title: "Messenger", text: "Facebook sahifangiz xabarlari.", points: ["Sahifa kommentlari", "Lead Ads mijozlariga javob", "Operatorga o'tkazish"] },
      ],
    },
    cases: {
      badge: "Misollar",
      title: "Sohangiz uchun tayyor ssenariylar",
      sub: "Shablonni tanlang, matnni o'zgartiring — 5 daqiqada ishga tushadi.",
      items: [
        { emoji: "🛍️", title: "Onlayn do'kon", text: "Kommentdagi \"narx\"ga katalog, rang tanlash, buyurtma va to'lov havolasi.", steps: ["Komment", "Katalog", "Buyurtma", "To'lov"] },
        { emoji: "🎓", title: "Kurs va ta'lim", text: "Obunani tekshirib bepul dars, keyin telefon va menejerga lid.", steps: ["\"KURS\"", "Obuna", "Bepul dars", "Lid"] },
        { emoji: "💅", title: "Salon va klinika", text: "Xizmatlar, narxlar, bo'sh vaqt va eslatma — navbat avtomatik yoziladi.", steps: ["Savol", "Xizmat", "Vaqt", "Eslatma"] },
        { emoji: "🍔", title: "Restoran va yetkazib berish", text: "Menyu, manzil, yetkazib berish narxi va operatorga ulash.", steps: ["Menyu", "Manzil", "Buyurtma", "Operator"] },
      ],
    },
  },

  // ==================== РУССКИЙ ====================
  ru: {
    heroSecondary: "Как это работает",
    heroChannels: "Instagram · Telegram · WhatsApp · Messenger",
    float: {
      comment: "Комментарий → Direct",
      commentSub: "написал «цена» — ответ за 1 секунду",
      speed: "0.8 с",
      speedSub: "среднее время ответа",
      lead: "Новый лид",
      leadSub: "Азиза · +998 90 ••• 45 67",
    },
    sim: {
      ig: { handle: "guli_store", sub: "Instagram · Direct", c1: "Здравствуйте! Сколько стоит платье? 😊", b1: "Здравствуйте! Платья от 150 000 до 300 000 сум. Какой цвет интересует?", q: ["Красный", "Чёрный", "Каталог"], c2: "Красный, доставляете?", b2: "Да ✅ По Ташкенту за 1 день, 20 000 сум. Оформим заказ?" },
      tg: { handle: "obunext_bot", sub: "Telegram · Бот", c1: "/start", b1: "Здравствуйте! 🤖 Добро пожаловать на курс. Чтобы получить бесплатный урок, подпишитесь на канал:", q: ["Подписался ✅", "Цены"], c2: "Подписался", b2: "Спасибо! 🎁 Бесплатный урок: obunext.uz/dars. Напишите имя — подготовим сертификат." },
      wa: { handle: "+998 90 123 45 67", sub: "WhatsApp · Cloud API", c1: "Здравствуйте, хочу сделать заказ.", b1: "Здравствуйте! 💚 Какой товар вам понравился?", q: ["Каталог", "Оператор"], c2: "2 чёрные футболки, размер L.", b2: "Принято! Итого 240 000 сум. Оплатить можно через Payme или Click." },
      fb: { handle: "Fashion Store", sub: "Facebook · Messenger", c1: "Где вы находитесь?", b1: "Ташкент, ул. Амира Темура 45. Ориентир: метро Юнусабад 📍", q: ["Карта", "Часы работы"], c2: "Сколько стоит доставка?", b2: "По Ташкенту 20 000 сум, в регионы через BTS — 30 000 сум." },
    },
    platforms: {
      title: "Официальные интеграции и подключения",
      extra: ["Google Sheets", "Make · Zapier · n8n", "Payme · Click", "Claude (MCP)"],
    },
    showcase: {
      badge: "Продукт",
      title: "Одна платформа — вся воронка продаж",
      sub: "От первого комментария клиента до оплаты — всё автоматически и в одной панели.",
      more: "Подробнее",
      rows: [
        {
          eyebrow: "Flow Builder",
          title: "Собирайте воронки перетаскиванием",
          text: "Соединяйте блоки сообщений, кнопок, вопросов, условий, задержек и AI. Начните с шаблона или опишите задачу — AI соберёт воронку сам.",
          points: ["12+ готовых шаблонов и генерация через AI", "Проверка подписки, теги, баллы, запись в CRM", "Симулятор, проверка ошибок, история версий"],
        },
        {
          eyebrow: "Live Inbox и CRM",
          title: "Все диалоги и клиенты в одном месте",
          text: "Сообщения из Instagram, Telegram, WhatsApp и Messenger в одном окне. У каждого клиента видны теги, телефон, заявки и 24-часовое окно.",
          points: ["Режим оператора: отключайте AI для отдельного чата", "Фильтры по тегам, каналам и активности", "Команда: роли и доступ для каждого оператора"],
        },
        {
          eyebrow: "Аналитика и рассылки",
          title: "Видьте результат в цифрах",
          text: "Отслеживайте, какая воронка приносит больше лидов и продаж. Отправляйте персональные рассылки по сегментам клиентов.",
          points: ["Сообщения, лиды и конверсия по дням", "Сегменты по тегам и персонализация {name}", "Передача в Google Sheets, Make, amoCRM, Bitrix24"],
        },
      ],
    },
    mock: {
      flow: {
        trigger: "Триггер", triggerText: "Комментарий к Reels: «ЦЕНА»",
        message: "Сообщение", messageText: "Привет, {name}! Прайс 👇", button: "Получить прайс",
        condition: "Условие", conditionText: "Подписан на страницу?", yes: "Да", no: "Нет",
        input: "Вопрос", inputText: "Ваш номер телефона?",
        action: "Действие", actionText: "Тег: лид · CRM · Telegram",
      },
      inbox: {
        title: "Live Inbox", all: "Все", ai: "AI", operator: "Оператор",
        chats: [
          { n: "Азиза К.", m: "Есть красный цвет?", ch: "instagram", tag: "лид", t: "2 мин" },
          { n: "Сардор", m: "Хочу заказать", ch: "telegram", tag: "vip", t: "5 мин" },
          { n: "Малика", m: "Когда доставка?", ch: "whatsapp", tag: "клиент", t: "12 мин" },
          { n: "Жасур Т.", m: "Спасибо, получил 👍", ch: "facebook", tag: "продажа", t: "1 ч" },
        ],
        card: "Карточка клиента", phone: "Телефон", window: "24-часовое окно", windowLeft: "осталось 21 ч", aiOn: "AI-ответ: включён", tags: "Теги",
      },
      stats: {
        kpi: [{ l: "Сообщения", v: "12 480" }, { l: "Лиды", v: "1 284" }, { l: "Конверсия", v: "18.4%" }],
        chart: "Лиды — последние 7 дней",
        days: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
        broadcast: "Рассылка", broadcastText: "тег «vip» · 842 человека", sent: "Отправлено",
      },
    },
    bento: {
      badge: "Возможности",
      title: "Всё, что нужно для роста",
      sub: "Возможности ChatPlace и ManyChat — на узбекском, русском и с местными платежами.",
      items: [
        { icon: "flow", title: "Визуальный Flow Builder", text: "Многошаговые воронки: сообщение → условие → действие → задержка. Редактируется и с телефона." },
        { icon: "bolt", title: "Комментарий → Direct", text: "Автоответ в комментариях и Direct по ключевому слову в постах, Reels и эфирах." },
        { icon: "megaphone", title: "Рассылки", text: "Сегментируйте по тегам и каналам, отправляйте персональные сообщения." },
        { icon: "users", title: "CRM и теги", text: "Карточка клиента, поля, заметки, экспорт в CSV и фильтры." },
        { icon: "spark", title: "Обучаемый AI", text: "Изучает товары, цены и ваш стиль из профиля Instagram. Включается по расписанию рабочего времени." },
        { icon: "form", title: "Формы заявок", text: "Собирает имя, телефон и ответы прямо в чате и пишет в Google Sheets." },
        { icon: "trophy", title: "Конкурсы и геймификация", text: "Баллы, реферальные ссылки, рейтинг и призы повышают активность." },
        { icon: "film", title: "AI-контент студия", text: "Сценарии Reels, карусели, тексты постов и контент-план за секунды." },
        { icon: "team", title: "Команда и роли", text: "Оператор, менеджер и админ — у каждого свои права доступа." },
        { icon: "chart", title: "Аналитика", text: "Ежедневная статистика по воронкам, лидам и конверсиям." },
        { icon: "key", title: "Управление через Claude (MCP)", text: "Напишите: «сделай воронку розыгрыша для Reels» — Claude создаст её сам." },
        { icon: "shield", title: "Официальный Meta API", text: "Instagram, WhatsApp и Messenger через официальный API — без блокировок." },
      ],
    },
    channels: {
      badge: "Каналы",
      title: "Вы там, где ваши клиенты",
      sub: "Используем все возможности каждого канала.",
      items: [
        { key: "instagram", cls: "ig", title: "Instagram", text: "Direct, комментарии, Stories и эфиры.", points: ["Авто-DM и ответ на комментарий", "Упоминания и ответы на Stories", "Ice breakers и реферальные ссылки"] },
        { key: "telegram", cls: "tg", title: "Telegram", text: "Бот, проверка подписки и Telegram Business.", points: ["Проверка подписки и бустов", "AI-ответы с личного аккаунта (Business)", "Голосовые и фото"] },
        { key: "whatsapp", cls: "wa", title: "WhatsApp", text: "Официальное подключение через Meta Cloud API.", points: ["Подтверждение заказов и оплат", "Медиа, файлы и каталог", "Контроль 24-часового окна"] },
        { key: "facebook", cls: "fb", title: "Messenger", text: "Сообщения вашей Facebook-страницы.", points: ["Комментарии страницы", "Ответ клиентам из Lead Ads", "Передача оператору"] },
      ],
    },
    cases: {
      badge: "Примеры",
      title: "Готовые сценарии для вашей ниши",
      sub: "Выберите шаблон, поменяйте текст — запуск за 5 минут.",
      items: [
        { emoji: "🛍️", title: "Интернет-магазин", text: "На «цена» в комментариях — каталог, выбор цвета, заказ и ссылка на оплату.", steps: ["Комментарий", "Каталог", "Заказ", "Оплата"] },
        { emoji: "🎓", title: "Курсы и обучение", text: "Проверка подписки, бесплатный урок, затем телефон и лид менеджеру.", steps: ["«КУРС»", "Подписка", "Урок", "Лид"] },
        { emoji: "💅", title: "Салоны и клиники", text: "Услуги, цены, свободное время и напоминание — запись автоматически.", steps: ["Вопрос", "Услуга", "Время", "Напоминание"] },
        { emoji: "🍔", title: "Рестораны и доставка", text: "Меню, адрес, стоимость доставки и подключение оператора.", steps: ["Меню", "Адрес", "Заказ", "Оператор"] },
      ],
    },
  },

  // ==================== ENGLISH ====================
  en: {
    heroSecondary: "How it works",
    heroChannels: "Instagram · Telegram · WhatsApp · Messenger",
    float: {
      comment: "Comment → DM",
      commentSub: "wrote \"price\" — replied in 1 second",
      speed: "0.8 s",
      speedSub: "average reply time",
      lead: "New lead",
      leadSub: "Aziza · +998 90 ••• 45 67",
    },
    sim: {
      ig: { handle: "guli_store", sub: "Instagram · Direct", c1: "Hi! How much is the dress? 😊", b1: "Hello! Our dresses are 150,000 – 300,000 UZS. Which colour do you like?", q: ["Red", "Black", "Catalog"], c2: "Red — do you deliver?", b2: "Yes ✅ Across Tashkent in 1 day for 20,000 UZS. Shall we place the order?" },
      tg: { handle: "obunext_bot", sub: "Telegram · Bot", c1: "/start", b1: "Hello! 🤖 Welcome to the course. Subscribe to the channel to get a free lesson:", q: ["Subscribed ✅", "Prices"], c2: "Subscribed", b2: "Thanks! 🎁 Free lesson: obunext.uz/dars. Send your name and we'll prepare a certificate." },
      wa: { handle: "+998 90 123 45 67", sub: "WhatsApp · Cloud API", c1: "Hello, I'd like to place an order.", b1: "Hello! 💚 Which product did you like?", q: ["Catalog", "Agent"], c2: "2 black T-shirts, size L.", b2: "Done! Total 240,000 UZS. You can pay with Payme or Click." },
      fb: { handle: "Fashion Store", sub: "Facebook · Messenger", c1: "Where are you located?", b1: "Tashkent, 45 Amir Temur street. Landmark: Yunusabad metro 📍", q: ["Map", "Opening hours"], c2: "How much is delivery?", b2: "20,000 UZS within Tashkent, 30,000 UZS to other regions via BTS." },
    },
    platforms: {
      title: "Official integrations and connections",
      extra: ["Google Sheets", "Make · Zapier · n8n", "Payme · Click", "Claude (MCP)"],
    },
    showcase: {
      badge: "Product",
      title: "One platform — your whole sales funnel",
      sub: "From a customer's first comment to payment — automated, in one dashboard.",
      more: "Learn more",
      rows: [
        {
          eyebrow: "Flow Builder",
          title: "Build funnels with drag and drop",
          text: "Connect message, button, question, condition, delay and AI blocks. Start from a template or describe what you need — AI builds the flow for you.",
          points: ["12+ templates and AI generation", "Follow checks, tags, points, CRM updates", "Simulator, error checks and version history"],
        },
        {
          eyebrow: "Live Inbox & CRM",
          title: "Every conversation and customer in one place",
          text: "Instagram, Telegram, WhatsApp and Messenger in a single inbox. See each customer's tags, phone, submissions and 24-hour window.",
          points: ["Agent mode: turn AI off per chat", "Filters by tag, channel and activity", "Team roles and per-agent access"],
        },
        {
          eyebrow: "Analytics & broadcasts",
          title: "See results in numbers",
          text: "Track which flow brings the most leads and sales. Send personalised broadcasts to tagged segments.",
          points: ["Daily messages, leads and conversion", "Tag segments and {name} personalisation", "Send to Google Sheets, Make, amoCRM, Bitrix24"],
        },
      ],
    },
    mock: {
      flow: {
        trigger: "Trigger", triggerText: "Reels comment: \"PRICE\"",
        message: "Message", messageText: "Hi {name}! Here's the price list 👇", button: "Get prices",
        condition: "Condition", conditionText: "Follows the page?", yes: "Yes", no: "No",
        input: "Question", inputText: "Your phone number?",
        action: "Action", actionText: "Tag: lead · CRM · Telegram",
      },
      inbox: {
        title: "Live Inbox", all: "All", ai: "AI", operator: "Agent",
        chats: [
          { n: "Aziza K.", m: "Do you have it in red?", ch: "instagram", tag: "lead", t: "2 min" },
          { n: "Sardor", m: "I want to order", ch: "telegram", tag: "vip", t: "5 min" },
          { n: "Malika", m: "When is delivery?", ch: "whatsapp", tag: "client", t: "12 min" },
          { n: "Jasur T.", m: "Thanks, got it 👍", ch: "facebook", tag: "sale", t: "1 h" },
        ],
        card: "Customer card", phone: "Phone", window: "24-hour window", windowLeft: "21 h left", aiOn: "AI reply: on", tags: "Tags",
      },
      stats: {
        kpi: [{ l: "Messages", v: "12,480" }, { l: "Leads", v: "1,284" }, { l: "Conversion", v: "18.4%" }],
        chart: "Leads — last 7 days",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        broadcast: "Broadcast", broadcastText: "tag \"vip\" · 842 people", sent: "Sent",
      },
    },
    bento: {
      badge: "Features",
      title: "Everything you need to grow",
      sub: "What ChatPlace and ManyChat offer — in Uzbek and Russian, with local payments.",
      items: [
        { icon: "flow", title: "Visual Flow Builder", text: "Multi-step funnels: message → condition → action → delay. Editable from your phone too." },
        { icon: "bolt", title: "Comment → DM", text: "Automatic public reply and DM for keywords on posts, Reels and live streams." },
        { icon: "megaphone", title: "Broadcasts", text: "Segment by tag and channel and send personalised messages." },
        { icon: "users", title: "CRM & tags", text: "Customer cards, fields, notes, CSV export and filters." },
        { icon: "spark", title: "Trainable AI", text: "Learns products, prices and your tone from your Instagram profile. Runs on your business-hours schedule." },
        { icon: "form", title: "Lead forms", text: "Collects name, phone and answers in chat and writes them to Google Sheets." },
        { icon: "trophy", title: "Giveaways & gamification", text: "Points, referral links, leaderboards and prizes to boost engagement." },
        { icon: "film", title: "AI content studio", text: "Reels scripts, carousels, captions and a content plan in seconds." },
        { icon: "team", title: "Team & roles", text: "Agent, manager and admin — each with their own permissions." },
        { icon: "chart", title: "Analytics", text: "Daily stats for flows, leads and conversions." },
        { icon: "key", title: "Manage with Claude (MCP)", text: "Just write \"make a giveaway flow for my Reels\" — Claude builds it." },
        { icon: "shield", title: "Official Meta API", text: "Instagram, WhatsApp and Messenger via the official API — no bans." },
      ],
    },
    channels: {
      badge: "Channels",
      title: "Be where your customers are",
      sub: "We use every capability each channel offers.",
      items: [
        { key: "instagram", cls: "ig", title: "Instagram", text: "Direct, comments, Stories and live.", points: ["Auto-DM and public comment replies", "Story mentions and replies", "Ice breakers and referral links"] },
        { key: "telegram", cls: "tg", title: "Telegram", text: "Bots, subscription checks and Telegram Business.", points: ["Channel subscription and boost checks", "AI replies from your personal account", "Voice and photo messages"] },
        { key: "whatsapp", cls: "wa", title: "WhatsApp", text: "Official connection via Meta Cloud API.", points: ["Order and payment confirmation", "Media, files and catalog", "24-hour window control"] },
        { key: "facebook", cls: "fb", title: "Messenger", text: "Your Facebook Page inbox.", points: ["Page comments", "Replies to Lead Ads contacts", "Hand-off to an agent"] },
      ],
    },
    cases: {
      badge: "Use cases",
      title: "Ready-made scenarios for your niche",
      sub: "Pick a template, change the text — live in 5 minutes.",
      items: [
        { emoji: "🛍️", title: "Online store", text: "\"Price\" in comments → catalog, colour choice, order and a payment link.", steps: ["Comment", "Catalog", "Order", "Payment"] },
        { emoji: "🎓", title: "Courses & education", text: "Check the follow, send a free lesson, then collect the phone for sales.", steps: ["\"COURSE\"", "Follow", "Lesson", "Lead"] },
        { emoji: "💅", title: "Salons & clinics", text: "Services, prices, free slots and reminders — bookings on autopilot.", steps: ["Question", "Service", "Slot", "Reminder"] },
        { emoji: "🍔", title: "Restaurants & delivery", text: "Menu, address, delivery fee and hand-off to an agent.", steps: ["Menu", "Address", "Order", "Agent"] },
      ],
    },
  },
};

export const home = (lang) => HOME[lang] || HOME.uz;
