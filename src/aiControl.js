/**
 * AI avtomatik javobini boshqarish:
 *  - umumiy yoqish/o'chirish
 *  - kanal bo'yicha (Instagram, Telegram, WhatsApp, Messenger)
 *  - jadval: doim / faqat ish vaqtida / faqat ish vaqtidan tashqarida
 *  - alohida chat uchun o'chirish (Inbox yoki mijoz kartochkasidan)
 *  - AI o'chiq paytda: jim turish yoki qisqa zaxira javob
 *
 * AI o'chiq bo'lsa ham flow'lar, kalit so'z qoidalari, formalar va
 * geymifikatsiya ishlashda davom etadi — faqat erkin AI javob o'chadi.
 *
 * tenant.settings.ai = { enabled, channels: {ig,fb,wa,tg}, mode, hours, days, whenOff, offMessage }
 * tenant.contactMeta[key].aiOff = true — shu chatda AI o'chiq
 */
import { zonedParts } from "./templating.js";
import { persist } from "./db.js";
import { getContactMeta } from "./contacts.js";

export const AI_MODES = {
  always: "Doim",
  work_hours: "Faqat ish vaqtida",
  off_hours: "Faqat ish vaqtidan tashqarida",
};

export const CHANNELS = { ig: "Instagram", tg: "Telegram", wa: "WhatsApp", fb: "Messenger" };

const DEFAULTS = {
  enabled: true,
  channels: { ig: true, tg: true, wa: true, fb: true },
  mode: "always",
  hours: "09:00-18:00",
  days: "1,2,3,4,5,6",
  whenOff: "silent",
  offMessage: "Rahmat! Xabaringizni oldik, tez orada javob beramiz 🙏",
  actions: true, // AI kontakt/teg/lid yozadi
  aiHandoff: true, // AI kerak bo'lsa operatorga o'tkazadi
  askConsent: false, // shaxsiy ma'lumotdan oldin rozilik so'raladi
};

/** Sozlamalar (eski biznes uchun ham to'liq, sukut bo'yicha AI yoqilgan). */
export function aiSettings(tenant) {
  const s = tenant.settings?.ai || {};
  return {
    ...DEFAULTS,
    ...s,
    channels: { ...DEFAULTS.channels, ...(s.channels || {}) },
  };
}

const parseHm = (v) => {
  const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Hozir biznesning ish vaqtimi (biznes vaqt mintaqasida). */
export function isWorkTime(tenant, now = new Date()) {
  const s = aiSettings(tenant);
  const p = zonedParts(tenant, now);
  const days = String(s.days || "").split(",").map(Number);
  if (!days.includes(p.weekday)) return false;
  const [from, to] = String(s.hours || "").split("-").map(parseHm);
  if (from === null || to === null || from === undefined || to === undefined) return true;
  return from <= to ? p.minutes >= from && p.minutes < to : p.minutes >= from || p.minutes < to;
}

/**
 * Shu xabarga AI javob bera oladimi.
 * Qaytaradi: { allowed, reason } — reason: "global" | "channel" | "schedule" | "chat" | ""
 */
export function aiAllowed(tenant, chan, key = "", now = new Date()) {
  const s = aiSettings(tenant);
  if (!s.enabled) return { allowed: false, reason: "global" };
  if (chan && s.channels[chan] === false) return { allowed: false, reason: "channel" };
  if (key && tenant.contactMeta?.[key]?.aiOff) return { allowed: false, reason: "chat" };
  if (s.mode === "work_hours" && !isWorkTime(tenant, now)) return { allowed: false, reason: "schedule" };
  if (s.mode === "off_hours" && isWorkTime(tenant, now)) return { allowed: false, reason: "schedule" };
  return { allowed: true, reason: "" };
}

/** AI o'chiq bo'lganda mijozga nima yuboriladi (null — jim). */
export function offReply(tenant) {
  const s = aiSettings(tenant);
  return s.whenOff === "message" && s.offMessage ? String(s.offMessage).slice(0, 1000) : null;
}

/** Formadan kelgan qiymatlarni tozalab saqlaydi. */
export function saveAiSettings(tenant, body = {}) {
  const hm = (v, def) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v) : def);
  const days = [].concat(body.days || []).map(Number).filter((d) => d >= 1 && d <= 7);
  tenant.settings ||= {};
  tenant.settings.ai = {
    enabled: body.enabled === "on" || body.enabled === true,
    channels: Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, body[`ch_${c}`] === "on" || body[`ch_${c}`] === true])),
    mode: AI_MODES[body.mode] ? body.mode : "always",
    hours: `${hm(body.from, "09:00")}-${hm(body.to, "18:00")}`,
    days: (days.length ? [...new Set(days)].sort() : [1, 2, 3, 4, 5, 6]).join(","),
    whenOff: body.whenOff === "message" ? "message" : "silent",
    offMessage: String(body.offMessage || DEFAULTS.offMessage).trim().slice(0, 1000),
    actions: body.actions === "on" || body.actions === true,
    aiHandoff: body.aiHandoff === "on" || body.aiHandoff === true,
    askConsent: body.askConsent === "on" || body.askConsent === true,
  };
  persist(tenant);
  return tenant.settings.ai;
}

/** Tez yoqish/o'chirish (dashboard tugmasi, Telegram buyrug'i). */
export function setAiEnabled(tenant, enabled) {
  tenant.settings ||= {};
  tenant.settings.ai = { ...aiSettings(tenant), enabled: Boolean(enabled) };
  persist(tenant);
  return tenant.settings.ai.enabled;
}

/** Bitta chat uchun AI'ni o'chirish/yoqish. */
export function setChatAi(tenant, key, on) {
  const meta = getContactMeta(tenant, key);
  if (on) delete meta.aiOff;
  else meta.aiOff = true;
  meta.updatedAt = new Date().toISOString();
  persist(tenant);
  return !meta.aiOff;
}

/** Panelda ko'rsatish uchun qisqa holat matni. */
export function aiStatusLabel(tenant, now = new Date()) {
  const s = aiSettings(tenant);
  if (!s.enabled) return { on: false, label: "AI javob o'chiq" };
  const off = Object.entries(s.channels).filter(([, v]) => !v).map(([c]) => CHANNELS[c]);
  const sched = s.mode === "always" ? "" : ` · ${AI_MODES[s.mode].toLowerCase()} (${s.hours})`;
  const active = aiAllowed(tenant, "", "", now).allowed;
  return {
    on: true,
    active,
    label: `AI javob yoqilgan${sched}${off.length ? ` · o'chiq: ${off.join(", ")}` : ""}${!active ? " — hozir dam olmoqda" : ""}`,
  };
}
