/**
 * ChatPlace.io uslubidagi professional avtomatlashtirish qoidalari dvigateli (Rules Engine).
 *  - comment_to_dm: Komment yozilganda ochiq javob (Anti-Spam random) + Follower Gate (Obuna tekshiruvi) + DM yuborish
 *  - story_mention: Biznes story'da belgilanganda avto-minnatdorchilik
 *  - story_reply: Story'ga javob/reaksiya bildirilganda maxsus voronka
 *  - keyword_dm: DM'da kalit so'zlarga tezkor javoblar / interaktiv tugmalar
 */

import { persist } from "./db.js";

/** Standard sukut bo'yicha qoidalar (yangi foydalanuvchi yaratilganda) */
export function getDefaultRules() {
  return [
    {
      id: "rule_comment_price",
      type: "comment_to_dm",
      name: "🎁 Sovg'a/Narx so'ralganda (Follower Gate)",
      keyword: "narx",
      matchType: "contains",
      targetMediaId: "*", // Hamma postlar yoki aniq media_id
      requireFollow: true, // ChatPlace.io uslubida obunani tekshirish
      notFollowingMessage: "Assalomu alaykum! 🎁 Maxsus sovg'a va narxlar katalogimizni olish uchun avval sahifamizga obuna bo'ling va quyidagi tugmani bosing:",
      notFollowingButton: "Obuna bo'ldim ✅",
      publicReplies: [
        "Batafsil ma'lumotni Direct'ga yubordik! 📥 Check qiling.",
        "Xabaringizga javob berdik! Direct'ni tekshiring ✨",
        "Direct'ingizga yozib yubordik! 😊",
        "Assalomu alaykum! Direct'da to'liq ma'lumot qoldirdik 📩"
      ],
      publicReply: "Batafsil ma'lumotni Direct'ga yubordik! 📥 Check qiling.",
      privateReply: "Assalomu alaykum! Narxlar va aksiya haqida to'liq katalogimiz tayyor: https://instagram.com/catalog 📲 Marhamat, tanishib chiqing!",
      enabled: true,
    },
    {
      id: "rule_story_mention",
      type: "story_mention",
      name: "🌟 Story'da belgilaganda rahmat aytish",
      keyword: "*",
      matchType: "any",
      targetMediaId: "*",
      requireFollow: false,
      publicReply: "",
      privateReply: "Bizni Story'ingizda belgilaganingiz uchun katta rahmat! 🌟 Sizga 10% chegirma promokodimiz: BONUS2026",
      enabled: true,
    },
    {
      id: "rule_story_reply",
      type: "story_reply",
      name: "💬 Story'ga javob yozganda qabul qilish",
      keyword: "*",
      matchType: "any",
      targetMediaId: "*",
      requireFollow: false,
      publicReply: "",
      privateReply: "Story'imizga bildirgan munosabatingiz uchun rahmat! 😊 Qanday savollaringiz bor?",
      enabled: true,
    },
    {
      id: "rule_keyword_catalog",
      type: "keyword_dm",
      name: "📋 Katalog yoki narxlar",
      keyword: "katalog",
      matchType: "contains",
      targetMediaId: "*",
      requireFollow: false,
      publicReply: "",
      privateReply: "Barcha mahsulotlarimiz va narxlar katalogini quyidagi havola orqali ko'rishingiz mumkin: 📲 https://instagram.com",
      enabled: true,
    },
  ];
}

/** User obyektida rules mavjudligini ta'minlaydi */
export function ensureRules(user) {
  if (!user.rules || !Array.isArray(user.rules)) {
    user.rules = getDefaultRules();
    persist(user);
  }
  return user.rules;
}

/** Anti-Spam: Komment uchun tasodifiy ochiq javob tanlaydi (Instagram Shadowban oldini oladi) */
export function pickPublicReply(rule) {
  if (!rule) return "";
  const list = (rule.publicReplies && rule.publicReplies.length)
    ? rule.publicReplies.filter((t) => t && t.trim())
    : (rule.publicReply ? [rule.publicReply] : []);

  if (!list.length) return "";
  const randomIndex = Math.floor(Math.random() * list.length);
  return list[randomIndex];
}

/**
 * Matnni solishtirish uchun normallashtiradi: kichik harf, o'zbekcha apostrof
 * variantlari (o' o‘ o’ o`) bitta ko'rinishga, ortiqcha bo'shliqlar olib tashlanadi.
 * Shunda mijoz "sovg‘a" yoki "sovg`a" deb yozsa ham "sovg'a" qoidasi ishlaydi.
 */
export function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BB\u02BC`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Qoidaning kalit so'zlari ro'yxati ("narx, price, цена" → 3 ta variant). */
export function ruleKeywords(rule) {
  return String(rule?.keyword || "")
    .split(/[,\n]/)
    .map(normalizeText)
    .filter(Boolean);
}

/** Qoida har qanday matnga ishlaydimi (kalit so'z "*" yoki bo'sh, yoki moslik "any"). */
export function isCatchAll(rule) {
  if (rule.matchType === "any") return true;
  const kws = ruleKeywords(rule);
  return !kws.length || kws.includes("*");
}

/**
 * Matn qoidaning kalit so'zlaridan biriga mos keladimi.
 * matchType: contains | exact | regex | any. "ai" qoidalari bu yerda false —
 * ular alohida (asinxron) AI klassifikatsiya orqali tekshiriladi.
 */
export function matchesRule(rule, text) {
  if (rule.matchType === "ai") return false;
  if (isCatchAll(rule)) return true;
  const t = normalizeText(text);
  if (!t) return false;
  for (const kw of ruleKeywords(rule)) {
    if (rule.matchType === "exact" && t === kw) return true;
    if (rule.matchType === "regex") {
      try {
        if (new RegExp(kw, "i").test(t)) return true;
      } catch {
        // Noto'g'ri regex — bu variantni o'tkazib yuboramiz
      }
      continue;
    }
    if ((rule.matchType === "contains" || !rule.matchType) && t.includes(kw)) return true;
  }
  return false;
}

function targetsMedia(rule, mediaId) {
  return !rule.targetMediaId || rule.targetMediaId === "*" || !mediaId || rule.targetMediaId === mediaId;
}

/** Komment yozilganda mos keluvchi qoidani topadi (post ID va kalit so'z bo'yicha) */
export function findCommentRule(user, commentText, mediaId = "", type = "comment_to_dm") {
  const candidates = ensureRules(user).filter(
    (r) => r.type === type && r.enabled && targetsMedia(r, mediaId)
  );
  // 1. Aniq kalit so'z mosligi (aniq post uchun yozilgan qoida umumiysidan ustun)
  const specific = candidates.filter((r) => r.matchType !== "ai" && !isCatchAll(r) && matchesRule(r, commentText));
  const exactPost = specific.find((r) => r.targetMediaId && r.targetMediaId !== "*");
  if (exactPost || specific[0]) return exactPost || specific[0];
  // 2. Hamma kommentga javob beruvchi "*" qoida
  return candidates.find((r) => r.matchType !== "ai" && isCatchAll(r)) || null;
}

/** Story mention bo'lganda mos qoidani topadi */
export function findStoryMentionRule(user) {
  const rules = ensureRules(user);
  return rules.find((r) => r.type === "story_mention" && r.enabled) || null;
}

/** Story reply (story'ga javob/reaksiya) bo'lganda mos qoidani topadi */
export function findStoryReplyRule(user, messageText = "") {
  const rules = ensureRules(user).filter((r) => r.type === "story_reply" && r.enabled && r.matchType !== "ai");
  return rules.find((r) => !isCatchAll(r) && matchesRule(r, messageText)) || rules.find(isCatchAll) || null;
}

/** Direct Message kelganda kalit so'z bo'yicha mos qoidani topadi */
export function findKeywordRule(user, messageText) {
  if (!normalizeText(messageText)) return null;
  return (
    ensureRules(user).find(
      (r) => r.type === "keyword_dm" && r.enabled && r.matchType !== "ai" && !isCatchAll(r) && matchesRule(r, messageText)
    ) || null
  );
}

/** Berilgan turdagi yoqilgan "AI trigger" qoidalari (kalit so'zsiz, ma'no bo'yicha). */
export function aiRules(user, type, mediaId = "") {
  return ensureRules(user).filter(
    (r) => r.type === type && r.enabled && r.matchType === "ai" && targetsMedia(r, mediaId)
  );
}

const clampInt = (v, min, max, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/**
 * "Nomi | https://havola" qatorlarini tugmalar ro'yxatiga aylantiradi.
 * Instagram tugmali shablon maksimal 3 ta tugmani qabul qiladi.
 */
export function parseButtons(raw) {
  if (Array.isArray(raw)) return raw.filter((b) => b?.title && b?.url).slice(0, 3);
  return String(raw || "")
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("|");
      if (i < 0) return null;
      const title = line.slice(0, i).trim().slice(0, 20);
      const url = line.slice(i + 1).trim();
      return title && /^https?:\/\/\S+$/i.test(url) ? { title, url } : null;
    })
    .filter(Boolean)
    .slice(0, 3);
}

/** Tugmalarni tahrirlash formasi uchun matnga qaytaradi. */
export function buttonsToText(buttons) {
  return (buttons || []).map((b) => `${b.title} | ${b.url}`).join("\n");
}

/**
 * ChatPlace "Action" bloklariga mos qo'shimcha maydonlar:
 *  - aiIntent: AI trigger uchun ma'no tavsifi (matchType = "ai")
 *  - tags: qoida ishlaganda kontaktga qo'yiladigan teglar
 *  - buttons: DM javobidagi havola tugmalari
 *  - reminder*: obuna bo'lmaganlarga N daqiqadan so'ng eslatma
 *  - followUp*: sovg'a yuborilgach N daqiqadan so'ng qo'shimcha xabar
 */
export function sanitizeRuleExtras(data = {}) {
  const tags = Array.isArray(data.tags)
    ? data.tags
    : String(data.tags || "").split(",");
  return {
    aiIntent: String(data.aiIntent || "").trim().slice(0, 300),
    tags: tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 10),
    buttons: parseButtons(data.buttons),
    reminderText: String(data.reminderText || "").trim().slice(0, 1000),
    reminderDelayMin: clampInt(data.reminderDelayMin, 0, 1380, 45),
    followUpText: String(data.followUpText || "").trim().slice(0, 1000),
    followUpDelayMin: clampInt(data.followUpDelayMin, 1, 1380, 60),
  };
}

/** Yangi qoida qo'shish */
export function addRule(user, ruleData) {
  const rules = ensureRules(user);
  const newRule = {
    id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: ruleData.type || "comment_to_dm",
    name: ruleData.name || "Yangi qoida",
    keyword: ruleData.keyword || "*",
    matchType: ruleData.matchType || "contains",
    targetMediaId: ruleData.targetMediaId || "*",
    requireFollow: Boolean(ruleData.requireFollow),
    notFollowingMessage: ruleData.notFollowingMessage || "Sovg'ani olish uchun avval sahifamizga obuna bo'ling va tugmani bosing! 👇",
    notFollowingButton: ruleData.notFollowingButton || "Obuna bo'ldim ✅",
    publicReplies: Array.isArray(ruleData.publicReplies) ? ruleData.publicReplies : (ruleData.publicReply ? [ruleData.publicReply] : []),
    publicReply: ruleData.publicReply || "",
    privateReply: ruleData.privateReply || "",
    ...sanitizeRuleExtras(ruleData),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  rules.unshift(newRule);
  persist(user);
  return newRule;
}

/** Qoidani yangilash */
export function updateRule(user, ruleId, patch) {
  const rules = ensureRules(user);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;
  Object.assign(rule, patch);
  persist(user);
  return rule;
}

/** Qoidani o'chirish */
export function deleteRule(user, ruleId) {
  if (!user.rules) return false;
  const initialLen = user.rules.length;
  user.rules = user.rules.filter((r) => r.id !== ruleId);
  if (user.rules.length !== initialLen) {
    persist(user);
    return true;
  }
  return false;
}

