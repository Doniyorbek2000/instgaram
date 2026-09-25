/**
 * Admin tomonidan tarif sovg'a qilish.
 *
 *  - Bitta biznesga yoki segmentga (hammasi / sinovda / tugagan / bepul / faol) bir martada.
 *  - Muddat qolgan kunlarga qo'shiladi (faol obuna yoki sinov tugashidan keyin boshlanadi).
 *  - Faol obuna QIMMATROQ tarifda bo'lsa, tarif pasaytirilmaydi — sovg'a kunlari
 *    shu tarifga qo'shiladi (sovg'a hech qachon mijozni yo'qotishga olib kelmasin).
 *  - Biznes egasiga Telegram, email va kabinetdagi banner orqali xabar beriladi.
 *
 * user.subscription.gifts = [{ id, plan, days, note, at, until, kept }] (oxirgi 30 ta)
 * user.meta.giftNotice = { plan, days, note, at, until } — kabinetda yopilguncha ko'rinadi
 */
import crypto from "node:crypto";
import { persist, listUsers } from "./db.js";
import { PLAN_DEFS, isActive } from "./subscription.js";
import { currentPlan } from "./credits.js";
import { config } from "./config.js";

export const GIFT_DAYS = [7, 14, 30, 90, 180, 365];
export const GIFT_SEGMENTS = {
  all: "Barcha bizneslar",
  trial: "Sinov davridagilar",
  expired: "Obunasi tugaganlar (bepul tarif)",
  active: "Faol pullik obunadagilar",
};
const MAX_GIFTS = 30;
const PLAN_ORDER = Object.keys(PLAN_DEFS); // mini < lite < start < pro < business

const planRank = (p) => PLAN_ORDER.indexOf(p);

/** Segmentga mos bizneslar (bloklanganlar hech qachon kirmaydi). */
export function segmentUsers(users, segment) {
  return users.filter((u) => {
    if (u.meta?.blocked) return false;
    const plan = currentPlan(u);
    if (segment === "trial") return plan === "trial";
    if (segment === "expired") return plan === "free";
    if (segment === "active") return isActive(u) && u.subscription?.status === "active";
    return segment === "all";
  });
}

/**
 * Tarifni sovg'a qiladi (xabar yubormaydi — buni notifyGift qiladi).
 * Qaytaradi: yozilgan sovg'a yozuvi. Noto'g'ri tarif/muddatda Error otadi.
 */
export function giftPlan(user, { plan, days, note = "" } = {}) {
  if (!PLAN_DEFS[plan]) throw new Error("Noto'g'ri tarif");
  const d = Math.trunc(Number(days));
  if (!(d >= 1 && d <= 3650)) throw new Error("Muddat 1 kundan 3650 kungacha bo'lishi kerak");

  const now = Date.now();
  const s = (user.subscription ||= { plan: "start", status: "trial" });
  const activeUntil = s.status === "active" && Date.parse(s.expiresAt) > now ? Date.parse(s.expiresAt) : 0;
  const trialUntil = s.status === "trial" && Date.parse(s.trialEndsAt) > now ? Date.parse(s.trialEndsAt) : 0;
  const base = Math.max(now, activeUntil, trialUntil);

  // Faol qimmatroq tarifni pasaytirmaymiz — sovg'a kunlari shu tarifga qo'shiladi
  const kept = Boolean(activeUntil && planRank(s.plan) > planRank(plan));
  const finalPlan = kept ? s.plan : plan;

  s.status = "active";
  s.plan = finalPlan;
  s.expiresAt = new Date(base + d * 86400000).toISOString();

  const gift = {
    id: crypto.randomBytes(6).toString("hex"),
    plan: finalPlan,
    days: d,
    note: String(note || "").trim().slice(0, 500),
    at: new Date(now).toISOString(),
    until: s.expiresAt,
    ...(kept ? { kept: true, requested: plan } : {}),
  };
  s.gifts = [gift, ...(Array.isArray(s.gifts) ? s.gifts : [])].slice(0, MAX_GIFTS);
  user.meta ||= {};
  user.meta.giftNotice = { plan: gift.plan, days: d, note: gift.note, at: gift.at, until: gift.until };
  persist(user);
  return gift;
}

const fmtDay = (iso) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const escHtml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

/** Sovg'a haqida egasiga Telegram (ulangan bo'lsa) va email orqali xabar beradi. */
export async function notifyGift(user, gift) {
  const name = PLAN_DEFS[gift.plan]?.name || gift.plan;
  const url = `${config.baseUrl || ""}/dashboard`;
  const sent = { telegram: false, email: false };
  if (user.settings?.telegramChatId) {
    const { sendTelegram } = await import("./notify.js");
    sent.telegram = await sendTelegram(
      user.settings.telegramChatId,
      `🎁 <b>Sizga sovg'a!</b>\n\nObunext jamoasi <b>${escHtml(name)}</b> tarifini <b>${gift.days} kun</b>ga sovg'a qildi.\nObuna ${fmtDay(gift.until)} gacha faol.` +
        (gift.note ? `\n\n💬 ${escHtml(gift.note)}` : "") +
        `\n\n${url}`
    ).catch(() => false);
  }
  if (user.email) {
    const { sendPlatformMail } = await import("./mailer.js");
    sent.email = await sendPlatformMail(user.email, {
      subject: `🎁 Sizga ${name} tarifi sovg'a qilindi`,
      lines: [
        `Assalomu alaykum${user.businessName ? `, ${user.businessName}` : ""}!`,
        `Obunext jamoasi sizga ${name} tarifini ${gift.days} kunga sovg'a qildi. Obunangiz ${fmtDay(gift.until)} gacha faol.`,
        ...(gift.note ? [gift.note] : []),
      ],
      button: { label: "Kabinetga o'tish", url },
    }).catch(() => false);
  }
  return sent;
}

/**
 * Bir nechta biznesga sovg'a (segment yoki ID ro'yxati). Xabarlar fonda yuboriladi.
 * Qaytaradi: { count, skipped }
 */
export async function giftMany({ segment = "", ids = [], plan, days, note = "", notify = true }) {
  const users = await listUsers();
  const wanted = new Set(ids.map(String));
  const targets = ids.length ? users.filter((u) => wanted.has(u.id) && !u.meta?.blocked) : segmentUsers(users, segment);
  let count = 0;
  const done = [];
  for (const u of targets) {
    try {
      done.push([u, giftPlan(u, { plan, days, note })]);
      count++;
    } catch (err) {
      console.error(`[Sovg'a] ${u.email}:`, err.message);
    }
  }
  if (notify) {
    // Telegram limiti (~30 xabar/soniya) — ketma-ket, kichik pauza bilan
    (async () => {
      for (const [u, g] of done) {
        await notifyGift(u, g).catch(() => {});
        await new Promise((r) => setTimeout(r, 60));
      }
    })();
  }
  return { count, skipped: targets.length - count };
}

/** Barcha bizneslardagi sovg'alar tarixi (yangilari birinchi). */
export async function giftHistory(limit = 200) {
  const rows = [];
  for (const u of await listUsers()) {
    for (const g of u.subscription?.gifts || []) rows.push({ ...g, userId: u.id, business: u.businessName || u.email, email: u.email });
  }
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
