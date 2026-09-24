import { persist, getPlanPrices, listUsers } from "./db.js";
import { config } from "./config.js";

// Vaqtincha rejim: hamma foydalanuvchi to'lovsiz VIP/faol hisoblanadi.
// To'lov tizimi (Payme, /billing) o'zgarishsiz qoladi — faqat gating o'chirilgan.
// Yoqish/o'chirish: .env dagi FREE_MODE=true/false (kod o'zgartirilmasdan).
const FREE_MODE = String(process.env.FREE_MODE || "").toLowerCase() === "true";

// Tarif ta'riflari (narxlar so'mda, oyiga). Narx admin tomonidan o'zgartirilishi mumkin —
// o'zgartirilgani bazada saqlanadi, aks holda defaultPrice ishlatiladi.
export const PLAN_DEFS = {
  start: {
    id: "start",
    name: "Start",
    defaultPrice: 99000,
    tagline: "Kichik biznes uchun",
    features: ["Instagram + Messenger", "AI matn javoblari", "Kommentlarga javob", "Asosiy statistika"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    defaultPrice: 199000,
    tagline: "O'sayotgan biznes uchun",
    features: [
      "Start'dagi hammasi",
      "WhatsApp integratsiyasi",
      "AI ovoz / rasm / video tahlili",
      "Suhbat tarixi",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    defaultPrice: 399000,
    tagline: "Yuqori yuklamali biznes uchun",
    features: [
      "Pro'dagi hammasi",
      "Ovozli javob (TTS)",
      "Operator chaqirish rejimi",
      "Telegram bildirishnoma",
      "Kengaytirilgan statistika",
    ],
  },
};

/** Joriy narxlar bilan tarif rejalari (admin o'zgartirgan narx yoki default). */
export async function getPlans() {
  const prices = await getPlanPrices();
  const out = {};
  for (const def of Object.values(PLAN_DEFS)) {
    const p = Number(prices[def.id]);
    out[def.id] = { ...def, price: Number.isFinite(p) && p > 0 ? p : def.defaultPrice };
  }
  return out;
}

/** Bitta tarifni id bo'yicha (joriy narx bilan) qaytaradi. */
export async function getPlan(id) {
  const plans = await getPlans();
  return plans[id] || null;
}

/** Obuna hozir faolmi? (trial tugamagan yoki to'langan muddat ichida) */
export function isActive(user) {
  if (!user) return false;
  if (FREE_MODE) return true;
  if (user.email && config.adminEmails?.includes(user.email)) {
    return true;
  }
  const s = user.subscription;
  if (!s) return false;
  const now = Date.now();
  if (s.status === "active" && s.expiresAt && new Date(s.expiresAt) > now) {
    return true;
  }
  if (s.status === "trial" && s.trialEndsAt && new Date(s.trialEndsAt) > now) {
    return true;
  }
  return false;
}

/** Obuna holati (panelda ko'rsatish uchun) */
export function statusInfo(user) {
  if (FREE_MODE) {
    return { active: true, label: "🎁 VIP (hozircha bepul)", until: null, kind: "active" };
  }
  const s = user.subscription || {};
  const now = Date.now();
  if (s.status === "active" && s.expiresAt) {
    const until = new Date(s.expiresAt);
    const active = until > now;
    return {
      active,
      label: active ? "Faol obuna" : "Obuna tugagan",
      until,
      kind: active ? "active" : "expired",
    };
  }
  if (s.status === "trial" && s.trialEndsAt) {
    const until = new Date(s.trialEndsAt);
    const active = until > now;
    const days = Math.ceil((until - now) / 86400000);
    return {
      active,
      label: active ? `Sinov muddati (${days} kun qoldi)` : "Sinov muddati tugadi",
      until,
      kind: active ? "trial" : "expired",
    };
  }
  return { active: false, label: "Obuna yo'q", until: null, kind: "expired" };
}

/**
 * Obunani faollashtiradi/uzaytiradi (admin to'lovni tasdiqlagach).
 * Agar obuna hali faol bo'lsa — mavjud muddatga qo'shiladi.
 */
export function activate(user, days, plan) {
  const now = Date.now();
  const s = user.subscription;
  const base =
    s.status === "active" && s.expiresAt && new Date(s.expiresAt) > now
      ? new Date(s.expiresAt).getTime()
      : now;
  s.status = "active";
  s.expiresAt = new Date(base + days * 86400000).toISOString();
  if (plan && PLAN_DEFS[plan]) s.plan = plan;
  persist(user);
  return user;
}

/** Obunani bekor qiladi (admin) */
export function deactivate(user) {
  user.subscription.status = "expired";
  user.subscription.expiresAt = null;
  persist(user);
  return user;
}

const REFERRAL_BONUS_DAYS = 3;

/**
 * Referal havolasi orqali ro'yxatdan o'tilganda chaqiriladi — taklif qiluvchini
 * ID prefiksi bo'yicha topib, sinov/obunasini +3 kunga uzaytiradi va
 * growth.referrals ro'yxatiga yozadi. O'z-o'zini taklif qilishga yo'l qo'ymaydi.
 * Taklif qiluvchi topilib, mukofot berilgan bo'lsa `true` qaytaradi.
 */
export async function creditReferral(refCode, newUser) {
  const code = String(refCode || "").trim();
  if (!code || !newUser?.id) return false;

  const users = await listUsers();
  const referrer = users.find((u) => u.id.startsWith(code) && u.id !== newUser.id);
  if (!referrer) return false;

  referrer.growth ||= {};
  referrer.growth.referrals ||= [];
  referrer.growth.referrals.unshift({ userId: newUser.id, email: newUser.email, at: new Date().toISOString() });
  activate(referrer, REFERRAL_BONUS_DAYS, referrer.subscription.plan || "start"); // activate() ichida persist(referrer) ham chaqiriladi
  return true;
}
