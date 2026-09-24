/**
 * Ommaviy xabarlardan chiqish (opt-out) — Meta siyosati talabi.
 * Mijoz "STOP" (yoki shunga o'xshash) yozsa: ommaviy xabarlar va ketma-ketliklar
 * unga yuborilmaydi. "START" yozsa — qaytadan obuna bo'ladi.
 * Oddiy suhbat, flow'lar va AI javobi ishlashda davom etadi.
 *
 * contactMeta[key].optOut = ISO sana (chiqqan vaqti)
 */
import { getContactMeta } from "./contacts.js";
import { persist } from "./db.js";

const norm = (t) => String(t || "").toLowerCase().replace(/[‘’ʻʼ`´]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

export const STOP_WORDS = new Set([
  "stop", "стоп", "unsubscribe", "отписаться", "отписка", "отменить подписку",
  "obunani bekor qilish", "obunadan chiqish", "xabar yubormang", "xabar kerak emas", "rassilka kerak emas",
]);
export const START_WORDS = new Set(["start", "старт", "subscribe", "подписаться", "qayta obuna", "obunaga qaytish"]);

export const STOP_REPLY = "Siz ommaviy xabarlarimizdan chiqdingiz ✅ Endi sizga reklama xabarlari yuborilmaydi.\nQaytish uchun START deb yozing.";
export const START_REPLY = "Qaytganingizdan xursandmiz! 🎉 Yangiliklar va aksiyalarni yana yuborib turamiz.\nChiqish uchun istalgan vaqtda STOP deb yozing.";

export function isOptedOut(tenant, key) {
  return Boolean(tenant.contactMeta?.[key]?.optOut);
}

export function setOptOut(tenant, key, out) {
  const meta = getContactMeta(tenant, key);
  if (out) meta.optOut = new Date().toISOString();
  else delete meta.optOut;
  meta.updatedAt = new Date().toISOString();
  persist(tenant);
}

/**
 * Kiruvchi matnni tekshiradi. Qaytaradi: { reply } yoki null (opt-out buyrug'i emas).
 * "/start" (Telegram bot buyrug'i) bu yerda hisobga olinmaydi.
 */
export async function handleOptOutText(tenant, key, text) {
  const t = norm(text);
  if (!t || String(text).trim().startsWith("/")) return null;
  if (STOP_WORDS.has(t)) {
    setOptOut(tenant, key, true);
    const { unsubscribeAll } = await import("./sequences.js");
    unsubscribeAll(tenant, key);
    return { reply: STOP_REPLY };
  }
  if (START_WORDS.has(t) && isOptedOut(tenant, key)) {
    setOptOut(tenant, key, false);
    return { reply: START_REPLY };
  }
  return null;
}
