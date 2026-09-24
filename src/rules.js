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

/** Komment yozilganda mos keluvchi qoidani topadi (post ID va kalit so'z bo'yicha) */
export function findCommentRule(user, commentText, mediaId = "") {
  const rules = ensureRules(user);
  const text = (commentText || "").toLowerCase().trim();

  // 1. Avval aniq post ID va aniq kalit so'z mosligini tekshiramiz
  for (const rule of rules) {
    if (rule.type !== "comment_to_dm" || !rule.enabled) continue;
    if (rule.targetMediaId && rule.targetMediaId !== "*" && mediaId && rule.targetMediaId !== mediaId) continue;
    if (rule.keyword === "*" || !rule.keyword) continue;

    const kw = rule.keyword.toLowerCase().trim();
    if (rule.matchType === "exact" && text === kw) return rule;
    if (rule.matchType === "contains" && text.includes(kw)) return rule;
  }

  // 2. Aniq moslik topilmasa, hamma kommentga javob beruvchi "*" qoidani izlaymiz
  for (const rule of rules) {
    if (rule.type === "comment_to_dm" && rule.enabled) {
      if (rule.targetMediaId && rule.targetMediaId !== "*" && mediaId && rule.targetMediaId !== mediaId) continue;
      if (rule.keyword === "*" || !rule.keyword) return rule;
    }
  }

  return null;
}

/** Story mention bo'lganda mos qoidani topadi */
export function findStoryMentionRule(user) {
  const rules = ensureRules(user);
  return rules.find((r) => r.type === "story_mention" && r.enabled) || null;
}

/** Story reply (story'ga javob/reaksiya) bo'lganda mos qoidani topadi */
export function findStoryReplyRule(user, messageText = "") {
  const rules = ensureRules(user);
  const text = (messageText || "").toLowerCase().trim();

  for (const rule of rules) {
    if (rule.type !== "story_reply" || !rule.enabled) continue;
    if (rule.keyword === "*" || !rule.keyword) return rule;
    const kw = rule.keyword.toLowerCase().trim();
    if (rule.matchType === "exact" && text === kw) return rule;
    if (rule.matchType === "contains" && text.includes(kw)) return rule;
  }
  return null;
}

/** Direct Message kelganda kalit so'z bo'yicha mos qoidani topadi */
export function findKeywordRule(user, messageText) {
  const rules = ensureRules(user);
  const text = (messageText || "").toLowerCase().trim();
  if (!text) return null;

  for (const rule of rules) {
    if (rule.type !== "keyword_dm" || !rule.enabled) continue;
    const kw = (rule.keyword || "").toLowerCase().trim();
    if (!kw) continue;

    if (rule.matchType === "exact" && text === kw) return rule;
    if (rule.matchType === "contains" && text.includes(kw)) return rule;
    if (rule.matchType === "regex") {
      try {
        const re = new RegExp(kw, "i");
        if (re.test(text)) return rule;
      } catch {}
    }
  }
  return null;
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

