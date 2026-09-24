/**
 * Bepul tarif va AI kreditlari (ChatPlace'dagi "pay for what you use" modeli).
 *
 *  - Har bir tarifda oylik AI javoblar kvotasi bor (free/trial/start/pro/business).
 *  - Kvota tugasa — sotib olingan qo'shimcha kreditlar (bonus) sarflanadi; ular yonmaydi.
 *  - Kreditlar ham tugasa — bot kalit so'z/flow rejimida ishlashda davom etadi,
 *    egasiga Telegram'da bir marta ogohlantirish yuboriladi.
 *  - Sinov/obuna tugagach biznes "Bepul" tarifga o'tadi (admin o'chirmagan bo'lsa):
 *    flow'lar (N tagacha), qoidalar, formalar va oylik kichik AI kvotasi ishlaydi;
 *    ommaviy xabarlar — faqat pullik tariflarda.
 *
 * tenant.aiUsage = { month: "2026-09", used, bonus, warnedMonth }
 */
import { getPlatformSettings, setPlatformSettings, updateUser, persist, getPlanPrices } from "./db.js";
import { isActive } from "./subscription.js";
import { config } from "./config.js";

export const AI_QUOTA = { free: 50, trial: 300, start: 1000, pro: 3000, business: 10000 };

export const CREDIT_PACKS = {
  c500: { id: "c500", credits: 500, defaultPrice: 29000 },
  c2000: { id: "c2000", credits: 2000, defaultPrice: 99000 },
  c10000: { id: "c10000", credits: 10000, defaultPrice: 399000 },
};

const DEFAULT_SETTINGS = { freePlan: true, freeFlowLimit: 3 };
let settingsCache = { ...DEFAULT_SETTINGS };
let loadedAt = 0;

/** Platforma sozlamalari (sinxron, keshdan). Kesh har daqiqada fon rejimida yangilanadi. */
export function platformSettings() {
  if (Date.now() - loadedAt > 60000) {
    loadedAt = Date.now();
    getPlatformSettings()
      .then((s) => { settingsCache = { ...DEFAULT_SETTINGS, ...(s || {}) }; })
      .catch(() => {});
  }
  return settingsCache;
}

export async function loadPlatformSettings() {
  settingsCache = { ...DEFAULT_SETTINGS, ...((await getPlatformSettings()) || {}) };
  loadedAt = Date.now();
  return settingsCache;
}

export async function savePlatformSettings(patch) {
  const next = await setPlatformSettings(patch);
  settingsCache = { ...DEFAULT_SETTINGS, ...(next || {}) };
  loadedAt = Date.now();
  return settingsCache;
}

const isAdminUser = (u) => Boolean(u?.email && config.adminEmails?.includes(u.email));

/** Joriy tarif: free | trial | start | pro | business. */
export function currentPlan(user) {
  if (!isActive(user)) return "free";
  if (isAdminUser(user)) return "business";
  const s = user.subscription || {};
  if (s.status === "trial") return "trial";
  return AI_QUOTA[s.plan] ? s.plan : "start";
}

/** Bot ishlashi mumkinmi: pullik/sinov yoki bepul tarif yoqilgan bo'lsa. */
export function botEnabled(user) {
  return isActive(user) || Boolean(platformSettings().freePlan);
}

const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

function usage(user, now = new Date()) {
  const u = (user.aiUsage ||= {});
  const m = monthKey(now);
  if (u.month !== m) {
    u.month = m;
    u.used = 0;
  }
  u.used ||= 0;
  u.bonus ||= 0;
  return u;
}

/** AI kvotasi holati (panel uchun). */
export function aiQuota(user, now = new Date()) {
  const plan = currentPlan(user);
  const quota = plan === "free" && !platformSettings().freePlan ? 0 : AI_QUOTA[plan] ?? 0;
  const u = usage(user, now);
  const left = Math.max(0, quota - u.used) + u.bonus;
  return { plan, quota, used: u.used, bonus: u.bonus, left, month: u.month };
}

export function canUseAi(user) {
  if (isAdminUser(user)) return true;
  return aiQuota(user).left > 0;
}

/** Bitta AI javobini hisobdan chiqaradi (avval oylik kvota, keyin bonus kreditlar). */
export function consumeAi(user, n = 1) {
  if (isAdminUser(user)) return;
  const { quota } = aiQuota(user);
  const u = usage(user);
  for (let i = 0; i < n; i++) {
    if (u.used < quota) u.used++;
    else if (u.bonus > 0) u.bonus--;
  }
  // Faqat hisoblagich maydonini yozamiz (butun obyekt emas)
  updateUser(user.id, { aiUsage: u }).catch(() => {});
}

export function addCredits(user, n) {
  const u = usage(user);
  u.bonus = Math.max(0, u.bonus + Math.trunc(Number(n) || 0));
  persist(user);
  return u.bonus;
}

/** Kreditlar tugaganini egasiga oyiga bir marta Telegram orqali bildiradi. */
export async function warnCreditsOut(user) {
  const u = usage(user);
  if (u.warnedMonth === u.month || !user.settings?.telegramChatId) return false;
  u.warnedMonth = u.month;
  updateUser(user.id, { aiUsage: u }).catch(() => {});
  const { sendTelegram } = await import("./notify.js");
  const url = `${config.baseUrl || ""}/billing#credits`;
  await sendTelegram(
    user.settings.telegramChatId,
    `⚠️ <b>AI kreditlari tugadi</b>\n\nBu oy uchun AI javoblar limiti tugadi. Bot kalit so'z qoidalari va flow'lar bilan ishlashda davom etadi.\nAI'ni qayta yoqish uchun kredit paketi oling yoki tarifni oshiring:\n${url}`
  ).catch(() => {});
  return true;
}

/** Bepul tarifda faqat birinchi N ta yoqilgan flow ishlaydi. */
export function isFlowAllowed(user, flow, list) {
  if (currentPlan(user) !== "free") return true;
  const limit = Number(platformSettings().freeFlowLimit) || DEFAULT_SETTINGS.freeFlowLimit;
  const enabled = (list || []).filter((f) => f.enabled);
  return enabled.slice(0, limit).some((f) => f.id === flow.id);
}

export async function getCreditPacks() {
  const prices = await getPlanPrices();
  return Object.values(CREDIT_PACKS).map((p) => {
    const custom = Number(prices[`credits_${p.id}`]);
    return { ...p, price: Number.isFinite(custom) && custom > 0 ? custom : p.defaultPrice };
  });
}

export const CREDIT_ORDER_PREFIX = "credits:";
