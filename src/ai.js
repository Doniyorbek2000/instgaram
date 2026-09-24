import Anthropic from "@anthropic-ai/sdk";
import { persist, getPlatformGeminiKey } from "./db.js";
import { canUseAi, consumeAi, warnCreditsOut } from "./credits.js";

// Global (zaxira) kalitlar — foydalanuvchi o'z kalitini kiritmagan bo'lsa ishlatiladi
const globalGeminiKey = process.env.GEMINI_API_KEY || "";
const globalAnthropicKey = process.env.ANTHROPIC_API_KEY || "";const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const CLAUDE_MODEL = process.env.AI_MODEL || "claude-3-5-sonnet-20241022";

const anthropicClient = globalAnthropicKey ? new Anthropic() : null;

// Suhbat tarixi tenant.chats[chatKey] da saqlanadi (bazada, server o'chsa yo'qolmaydi).
const MAX_HISTORY = 16;
const MAX_CHATS = 500; // bir biznesda saqlanadigan suhbatlar soni

import { findRelevantChunks } from "./rag.js";

/** userText bo'lmaganda (masalan faqat ovoz/rasm xabar, matnsiz) to'liq ma'lumotni beradi */
function formatBusinessInfo(businessInfo) {
  return (businessInfo || "").trim();
}

export function buildSystemPrompt(tenant, userText = "", isFirstMessage = true) {
  const creativeMode = tenant.settings?.creativeReasoning ?? true;

  // MUHIM: "erkin fikrlash" faqat OHANG va TUZILISHGA tegishli — bazada yo'q
  // faktni (mahsulot/xizmat bor-yo'qligi, narx va h.k.) o'ylab topish HAR
  // IKKALA rejimda ham taqiqlangan (pastdagi umumiy "HALOLLIK" qoidasiga qarang).
  const modeGuidance = creativeMode
    ? `ERKIN FIKRLASH (ON): Bilimlar bazasidagi HAQIQIY ma'lumotlarga tayanib, ularni mijozga qanday YETKAZISH (ohang, tuzilish, qisqa maslahat) borasida erkin va tabiiy fikrla — lekin bazada yo'q faktni hech qachon o'ylab topma.`
    : `QAT'IY CHEKLANGAN REJIM (STRICT OFF): Faqat va faqat quyidagi "Biznes ma'lumotlari" bo'limidagi faktlarga tayanib, imkon qadar qisqa javob ber.`;

  // Vector Search (RAG): Mijoz savoliga eng yaqin bilim bo'laklarini ajratib olish.
  // userText bo'sh bo'lsa (masalan faqat ovoz/rasm, matnsiz xabar) — qidiruv uchun
  // so'rov yo'q, shuning uchun butun biznes ma'lumotini beramiz.
  const relevantKb = userText
    ? findRelevantChunks(tenant.businessInfo, userText, 4)
    : formatBusinessInfo(tenant.businessInfo);

  return `Sen "${tenant.businessName || "biznes"}" nomli biznesning mijozlar bilan ishlash bo'yicha ADM AI aqlli yordamchisisan. Instagram, Telegram va Facebook messenjerlari orqali yozgan mijozlarga javob berasan.

${modeGuidance}

⚠️ ENG MUHIM VA QAT'IY QOIDA — HECH QACHON BUZILMASIN: Har bir savolga javob berishdan OLDIN o'zingdan so'ra — "bu aniq mahsulot/xizmat/shart pastdagi 'Bilimlar Bazasi'da SO'ZMA-SO'Z yoki aniq ma'noda zikr etilganmi?" Agar YO'Q bo'lsa — buni "bor", "mavjud", "bizda bu ham bor" yoki shunga o'xshash tasdiqlovchi so'zlar bilan HECH QACHON javob berma, hatto bu mantiqan ehtimol tuyulsa ham (masalan telefon do'koni zaryadnik ham sotishi "ehtimol"dir, lekin bu FAQTDAN OLIS BO'LMOKDA — bazada yo'q bo'lsa, buni bilmaysan). Bunday holatda tan ol va tabiiy javob ber, masalan: "Hozircha bu haqda aniq ma'lumotim yo'q, operatordan so'rab, sizga albatta xabar beraman." Bu qoidani buzib, mavjud bo'lmagan narsani "bor" deyish — MIJOZNI ALDASH va biznesga real zarar hisoblanadi.

Qoidalar:
- TIL: Mijozning ENG OXIRGI xabari qaysi tilda yozilgan bo'lsa, aynan o'sha tilda javob ber — o'zbek, rus yoki ingliz. Suhbat tarixida boshqa til ishlatilgan bo'lsa ham, har doim mijozning so'nggi xabaridagi tilga moslash. Til aniq bo'lmasa (masalan bitta so'z yoki emoji), oldingi suhbat tiliga tayan; u ham bo'lmasa o'zbek tilida javob ber.
- OHANG: Xuddi tirik, tajribali operator kabi tabiiy, samimiy va iliq yoz — sun'iy yoki shablon jumlalar ishlatma. Hech qachon o'zingni robot, bot yoki AI deb tanishtirma va bu haqda ishora ham qilma — mijoz buni sira sezmasligi kerak.
- SALOMLASHISH: ${isFirstMessage
      ? `Bu mijozning shu suhbatdagi BIRINCHI xabari — tabiiy tarzda bitta marta salomlash mumkin (masalan "Assalomu alaykum!")."`
      : `Bu suhbat DAVOM ETMOQDA (birinchi xabar emas) — QAYTA SALOMLASHMA ("Assalomu alaykum" va shunga o'xshashlarni takrorlama), to'g'ridan-to'g'ri savolga javob ber, xuddi bir zumdagi tabiiy suhbatni davom ettirayotgandek.`}
- QISQALIK VA ANIQLIK: Har doim qisqa va aniq yoz — bu messenjer suhbati, odatda 1-3 qisqa jumla yetarli. Mijoz FAQAT bitta mahsulot/xizmat haqida so'rasa, FAQAT o'shani javob ber — butun katalog yoki ro'yxatni qayta chiqarma. Agar tegishli boshqa variantlar ham bo'lsa, ularni sanab o'tirmasdan qisqa eslatib o't (masalan "boshqa modellari ham bor, xohlasangiz aytib beraman") va mijoz so'rasa keyingi xabarda batafsil ayt. Mijoz aniq "hammasini/ro'yxatni ko'rsating" desagina to'liq ro'yxat ber.
- NOANIQ/KELAJAKKA OID SAVOLLAR: Bazada javobi yo'q, taxminiy yoki kelajakka oid savollarda (masalan "boshqa shaharga kelasizmi?", "aksiya bo'ladimi?") qat'iy "ha"/"yo'q" deb da'vo qilma — tabiiy, umidli lekin halol javob ber (masalan: "harakat qilamiz, imkon boricha albatta boramiz" yoki "buni tekshirib, sizga xabar beraman").
- KONTEKST: Suhbat tarixini albatta hisobga ol — mijoz avval aytgan narsani (ismi, savoli, buyurtma tafsilotlari) qayta so'rama, xuddi shu suhbatni davom ettirayotgandek tabiiy oqimda javob ber.
- Mijoz ovozli xabar yuborsa — eshitib, mazmuniga javob ber. Rasm yoki video yuborsa — ko'rib, nimaligini aniqlab javob ber.
- Narx, manzil, yetkazib berish kabi savollarga — FAQAT bazada bor bo'lsa — aniq raqamlar bilan javob ber.
- Buyurtma bermoqchi bo'lgan mijozdan kerakli ma'lumotlarni so'ra.
${tenant.settings?.aiStyle ? `- BIZNES USLUBI (egasi belgilagan, doim amal qil): ${String(tenant.settings.aiStyle).slice(0, 1500)}
` : ""}
# ADM AI Bilimlar Bazasi (Vector RAG Search Matnlari):

${relevantKb || "Biznes haqida ma'lumot kiritilmagan."}`;
}

/** Gemini — matn + ovoz + rasm + video birga tahlil qilinadi */
export async function askGemini(apiKey, systemPrompt, history, text, media, opts = {}) {
  const parts = [
    ...media.map((m) => ({
      inline_data: { mime_type: m.mimeType, data: m.data },
    })),
  ];
  if (text) parts.push({ text });
  if (parts.length === 0) return "";

  const contents = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts },
  ];

  // maxOutputTokens ilgari 1024 edi — tizim ko'rsatmasi "1-3 qisqa jumla" desa
  // ham, model ba'zan uzun javob generatsiya qilib, buning o'ziyoq bir necha
  // soniya qo'shimcha vaqt olardi (production loglarida 19-22 soniyalik javob
  // vaqtlari kuzatildi). Chegarani pasaytirish real javob tezligini oshiradi.
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxOutputTokens || 400,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    },
  });

  // Eski nomlar (2.5/2.0/1.5-flash*) Google tomonidan bekor qilingan — Gemini API
  // ularning o'zi qaytargan xato xabarida aniq ko'rsatgan joriy modellar bilan almashtirildi.
  //
  // flash-lite ASOSIY qilib qo'yildi (ilgari faqat zaxira edi): narxi flash'dan
  // ~2.5 baravar arzon ($0.30/$2.50 vs $0.75/$3.75 — 1 mln token uchun), tezroq
  // ishlaydi, va oddiy mijozlar-bilan-suhbat vazifasi uchun sifati real testlarda
  // (halollik qoidasi, narx savollari, kontekst) to'liq yetarli ekani tasdiqlandi.
  // gemini-3.6-flash faqat flash-lite ishlamay qolgan holatlar uchun zaxirada qoladi.
  const modelsToTry = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
  ];
  let lastError = null;

  // Har bir urinish uchun qat'iy vaqt chegarasi — avval BU YO'Q edi, shuning
  // uchun Gemini serveri sekinlashganda (masalan yuqori talab davrida) so'rov
  // cheksiz kutar edi. Endi belgilangan vaqtda javob kelmasa, keyingi modelga
  // (yoki halol zaxira javobga) o'tiladi — mijoz hech qachon o'nlab soniya
  // kutmaydi.
  const FETCH_TIMEOUT_MS = opts.timeoutMs || 9000;

  for (const modelName of modelsToTry) {
    const RETRYABLE = new Set([429, 500, 503]);
    let data = {};

    // Bitta model bo'yicha faqat 1 marta uriniladi (ilgari 2 marta, orasida
    // 600ms kutish bilan edi) — 503/"yuqori talab" xatosida SHU modelni
    // qayta so'rash foyda bermaydi, keyingi modelga tezroq o'tish samaraliroq.
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body,
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timer);
      }
      data = await res.json().catch(() => ({}));
      if (res.ok) {
        const ans = (data.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || "")
          .join("")
          .trim();
        if (ans) return ans;
      } else {
        lastError = new Error(`Status ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
        if (!RETRYABLE.has(res.status)) console.error(`[Gemini Error ${modelName}]:`, res.status, data.error?.message || data);
      }
    } catch (err) {
      lastError = err.name === "AbortError" ? new Error(`${modelName}: ${FETCH_TIMEOUT_MS}ms ichida javob kelmadi`) : err;
      console.error(`[Gemini Error ${modelName}]:`, lastError.message);
    }
  }

  throw new Error(`Gemini API xatosi: ${lastError ? lastError.message : "So'rov bajarilmadi"}`);
}

/** Claude — matn va rasm */
async function askClaude(systemPrompt, history, text, media) {
  const content = [];
  let unsupported = 0;
  for (const m of media) {
    if (m.mimeType.startsWith("image/")) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: m.mimeType, data: m.data },
      });
    } else {
      unsupported++;
    }
  }
  let userText = text || "";
  if (unsupported > 0) {
    userText =
      `[Mijoz ${unsupported} ta ovozli/video xabar yubordi — mazmunini ko'ra olmading. ` +
      `Undan xabarini matnda yozishini muloyim so'ra.] ${userText}`;
  }
  if (userText) content.push({ type: "text", text: userText });
  if (content.length === 0) return "";

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content },
  ];

  const response = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: [
      { type: "text", text: systemPrompt },
    ],
    messages,
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * AI umuman ishlamagan holatlar uchun (kalit yo'q yoki API xato berdi) yengil til
 * aniqlash — mijoz qaysi tilda yozgan bo'lsa, zaxira javob ham o'sha tilda bo'lsin.
 * Aniq bo'lmasa (bo'sh matn, faqat emoji va h.k.) o'zbek tiliga tushadi.
 */
function detectLang(text) {
  if (!text) return "uz";
  if (/[Ѐ-ӿ]/.test(text)) return "ru"; // kirill harflar — rus tili
  const looksUzbek = /[ʻʼ‘’]|\b(bo'l|bor|kerak|qancha|salom|rahmat|manzil|narx|qayerda)\b/i.test(text);
  const looksEnglish = /\b(the|is|are|price|how much|hello|hi|thanks|please|order|delivery|cost|where)\b/i.test(text);
  if (looksEnglish && !looksUzbek) return "en";
  return "uz";
}

/** Zaxira javoblar (AI ishlamaganda) — uz/ru/en, mijoz tiliga mos tanlanadi */
const FALLBACK_TEXT = {
  uz: {
    greet: (b) => `Assalomu alaykum! 👋 ${b}ga xush kelibsiz! Sizga qanday yordam bera olamiz?`,
    price: (b) => `Assalomu alaykum! ${b} narxlari va xizmatlari bo'yicha batafsil ma'lumot beramiz. 📋 Qaysi xizmatimiz yoki mahsulotimiz qiziqtiryapti?`,
    address: () => `Assalomu alaykum! Manzilimiz va ish soatlarimiz bo'yicha ma'lumot beramiz. 📍 Qaysi hududdansiz?`,
    who: (b) => `Assalomu alaykum! Men ${b} brendining ADM AI intellektual yordamchisiman. 🤖 Sizga qanday yordam bera olamiz?`,
    kb: (b, info) => `Assalomu alaykum! ${b} bo'yicha ma'lumot:\n\n${info}\n\nQo'shimcha savollaringiz bo'lsa, bemalol so'rang! 😊`,
    fallback: (b) => `Assalomu alaykum! 👋 ${b}ga xush kelibsiz! Xabaringiz qabul qilindi, sizga qanday yordam bera olamiz?`,
  },
  ru: {
    greet: (b) => `Здравствуйте! 👋 Добро пожаловать в ${b}! Чем можем помочь?`,
    price: (b) => `Здравствуйте! Расскажем подробнее о ценах и услугах ${b}. 📋 Какой товар или услуга вас интересует?`,
    address: () => `Здравствуйте! Расскажем про адрес и часы работы. 📍 Из какого вы региона?`,
    who: (b) => `Здравствуйте! Я интеллектуальный ассистент ADM AI бренда ${b}. 🤖 Чем могу помочь?`,
    kb: (b, info) => `Здравствуйте! Информация о ${b}:\n\n${info}\n\nЕсли есть ещё вопросы — пишите! 😊`,
    fallback: (b) => `Здравствуйте! 👋 Добро пожаловать в ${b}! Ваше сообщение получено, чем можем помочь?`,
  },
  en: {
    greet: (b) => `Hello! 👋 Welcome to ${b}! How can we help you?`,
    price: (b) => `Hello! We'd be happy to share pricing and service details for ${b}. 📋 Which product or service are you interested in?`,
    address: () => `Hello! Here's our address and working hours. 📍 Which area are you in?`,
    who: (b) => `Hello! I'm the ADM AI assistant for ${b}. 🤖 How can I help you?`,
    kb: (b, info) => `Hello! Here's some information about ${b}:\n\n${info}\n\nFeel free to ask if you have more questions! 😊`,
    fallback: (b) => `Hello! 👋 Welcome to ${b}! We've received your message — how can we help?`,
  },
};

export function smartFallbackReply(tenant, text) {
  const businessName = tenant.businessName || "Biznesimiz";
  const T = FALLBACK_TEXT[detectLang(text)];

  if (!text) return T.greet(businessName);

  const lower = text.toLowerCase();

  // Umumiy (biznes-neytral) mavzu bo'yicha aniqlashtiruvchi savollar — hech qanday
  // soxta da'vo yo'q (masalan "biz veb-sayt/bot xizmati beramiz" kabi faqat
  // dasturchi-bizneslarga to'g'ri keladigan yolg'on shablon endi ishlatilmaydi).
  if (lower.includes("narx") || lower.includes("qancha") || lower.includes("prays") || lower.includes("стоимость") || lower.includes("цена") || lower.includes("price") || lower.includes("cost")) {
    return T.price(businessName);
  }
  if (lower.includes("manzil") || lower.includes("qayerda") || lower.includes("lokatsiya") || lower.includes("адрес") || lower.includes("где") || lower.includes("address") || lower.includes("location")) {
    return T.address();
  }
  if (lower.includes("kim") || lower.includes("kimsan") || lower.includes("nima") || lower.includes("кто") || lower.includes("что") || lower.includes("who")) {
    return T.who(businessName);
  }

  // Tadbirkorning o'zi kiritgan haqiqiy bilimlar bazasidan javob qidiramiz
  if (tenant.businessInfo && tenant.businessInfo.length > 20) {
    const relevant = findRelevantChunks(tenant.businessInfo, text, 3);
    if (relevant && relevant.trim() && !relevant.includes("kiritilmagan")) {
      const cleanReply = relevant
        .split("\n")
        .filter((l) => !l.startsWith("---") && !l.startsWith("#"))
        .join("\n")
        .trim();
      if (cleanReply) {
        return T.kb(businessName, cleanReply);
      }
    }
  }

  return T.fallback(businessName);
}

/**
 * Mijoz xabariga AI javob qaytaradi (multi-tenant, multimodal).
 */
export async function generateReply(tenant, chatKey, { text = "", media = [] } = {}) {
  const platformKey = await getPlatformGeminiKey();
  const geminiKey = tenant.geminiApiKey || platformKey || process.env.GEMINI_API_KEY || globalGeminiKey;
  const provider = geminiKey ? "gemini" : (anthropicClient ? "claude" : "none");

  if (provider === "none") {
    return smartFallbackReply(tenant, text);
  }
  // AI kvotasi/kreditlari tugagan — bot kalit so'z rejimida javob beradi
  if (!canUseAi(tenant)) {
    warnCreditsOut(tenant).catch(() => {});
    return smartFallbackReply(tenant, text);
  }

  tenant.chats ||= {};
  const history = tenant.chats[chatKey] || [];
  const systemPrompt = buildSystemPrompt(tenant, text, history.length === 0);

  try {
    const reply =
      provider === "gemini"
        ? await askGemini(geminiKey, systemPrompt, history, text, media)
        : await askClaude(systemPrompt, history, text, media);

    if (!reply) return smartFallbackReply(tenant, text);
    consumeAi(tenant);

    const nowIso = new Date().toISOString();
    const summary = text || (media.length ? "[Media xabar]" : "...");
    
    tenant.chats[chatKey] = [
      ...history,
      { role: "user", text: summary, at: nowIso },
      { role: "assistant", text: reply, at: nowIso },
    ].slice(-MAX_HISTORY);

    // Suhbatlar soni cheklovi — eng eskilarini o'chiramiz
    const keys = Object.keys(tenant.chats);
    if (keys.length > MAX_CHATS) {
      for (const k of keys.slice(0, keys.length - MAX_CHATS)) delete tenant.chats[k];
    }
    persist(tenant);

    return reply;

  } catch (error) {
    console.error("AI javob berishda xato:", error.message || error);
    return smartFallbackReply(tenant, text);
  }
}

/**
 * "AI trigger" (ChatPlace smart trigger): kalit so'zsiz, MA'NO bo'yicha qoida tanlash.
 * Masalan qoida tavsifi "narx yoki to'lov haqida so'rash" bo'lsa, "qancha turadi?",
 * "сколько стоит" yoki "price?" kommentlari ham shu qoidani ishga tushiradi.
 *
 * Bitta AI so'rovi bilan barcha nomzod qoidalar orasidan tanlaydi.
 * Qaytaradi: mos qoida yoki null (AI yo'q / xato / hech biri mos emas).
 */
export async function classifyIntent(tenant, text, rules) {
  const candidates = (rules || []).filter(Boolean);
  const message = String(text || "").trim();
  if (!candidates.length || !message) return null;

  const geminiKey = await resolveGeminiKey(tenant);
  if (!geminiKey) return null;

  const list = candidates
    .map((r, i) => `${i + 1}. ${(r.aiIntent || r.name || r.keyword || "").replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  const systemPrompt =
    "You route customer messages to automation rules. You receive a numbered list of rule " +
    "descriptions and one customer message (any language: Uzbek, Russian, English). " +
    "Answer with ONLY the number of the single best matching rule, or 0 if none clearly matches. " +
    "No words, no punctuation — just the number.";

  try {
    const answer = await askGemini(geminiKey, systemPrompt, [], `Rules:\n${list}\n\nMessage: ${message.slice(0, 1000)}`, []);
    const idx = Number.parseInt(String(answer).match(/\d+/)?.[0] ?? "0", 10);
    return idx >= 1 && idx <= candidates.length ? candidates[idx - 1] : null;
  } catch (err) {
    console.error("[AI Trigger] klassifikatsiya xatosi:", err.message);
    return null;
  }
}

/** Biznes uchun ishlatiladigan Gemini kaliti: biznesning o'zi → platforma → .env */
export async function resolveGeminiKey(tenant) {
  return tenant?.geminiApiKey || (await getPlatformGeminiKey()) || globalGeminiKey || "";
}

/** AI (Gemini) sozlanganmi — UI'da AI tugmalarini ko'rsatish/yashirish uchun. */
export async function aiAvailable(tenant) {
  return Boolean(await resolveGeminiKey(tenant));
}

/**
 * Umumiy matn generatsiyasi (kontent studiya, xabarni qayta yozish, flow yaratish).
 * Suhbat tarixiga yozilmaydi. json: true bo'lsa model JSON qaytaradi va u parse qilinadi.
 * Xatoda Error otadi — chaqiruvchi foydalanuvchiga tushunarli xabar ko'rsatadi.
 */
export async function generateText(tenant, systemPrompt, prompt, { maxOutputTokens = 2048, json = false, temperature } = {}) {
  const key = await resolveGeminiKey(tenant);
  if (!key) throw new Error("AI kaliti sozlanmagan. Admin paneldan Gemini kalitini kiriting.");
  if (!canUseAi(tenant)) throw new Error("AI kreditlari tugadi — Obuna & Tariflar sahifasida kredit paketi oling.");
  consumeAi(tenant);
  const out = await askGemini(key, systemPrompt, [], prompt, [], { maxOutputTokens, json, temperature, timeoutMs: 30000 });
  if (!json) return out;
  const cleaned = String(out).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI javobini o'qib bo'lmadi, qaytadan urinib ko'ring.");
  }
}
