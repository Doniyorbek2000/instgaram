import { persist } from "./db.js";

// Operator chaqirilganda qo'lda rejim shuncha davom etadi (bot jim turadi)
const MANUAL_MODE_MS = 2 * 60 * 60 * 1000; // 2 soat

// Mijoz operatorni chaqirayotganini bildiruvchi so'zlar
const HANDOFF_KEYWORDS = [
  "operator",
  "operatorga",
  "operator kerak",
  "odam bilan",
  "tirik odam",
  "menejer",
  "administrator",
  "admin bilan",
  "оператор",
  "человек",
  "менеджер",
  "живой",
  "human",
];

// Buyurtma niyatini bildiruvchi so'zlar (statistika uchun)
const ORDER_KEYWORDS = [
  "buyurtma",
  "zakaz",
  "olaman",
  "sotib olaman",
  "band qilaman",
  "заказ",
  "заказать",
  "куплю",
  "хочу заказать",
  "order",
];

function matches(text, list) {
  const lower = (text || "").toLowerCase();
  return list.some((kw) => lower.includes(kw));
}

const MAX_LEADS = 100;

/** Har bir kiruvchi xabarni statistika va mijozlar ro'yxatiga (CRM) yozadi */
export function recordMessage(user, channel, chatKey, text) {
  const s = user.stats;
  s.messages = (s.messages || 0) + 1;
  s.customers ||= {};
  s.customers[chatKey] = true;
  s.channels ||= { instagram: 0, facebook: 0, whatsapp: 0 };
  if (s.channels[channel] != null) s.channels[channel]++;
  const day = new Date().toISOString().slice(0, 10);
  s.days ||= {};
  s.days[day] = (s.days[day] || 0) + 1;
  if (matches(text, ORDER_KEYWORDS)) s.orders = (s.orders || 0) + 1;

  // Mijozlar ro'yxati (mini-CRM) — eng yangisi tepada
  user.leads ||= [];
  const snippet = (text || "[media xabar]").slice(0, 80);
  const existing = user.leads.find((l) => l.chatKey === chatKey && l.channel === channel);
  if (existing) {
    existing.lastText = snippet;
    existing.lastAt = new Date().toISOString();
    existing.count = (existing.count || 1) + 1;
    user.leads = user.leads.filter((l) => l !== existing);
    user.leads.unshift(existing);
  } else {
    user.leads.unshift({
      chatKey,
      channel,
      lastText: snippet,
      lastAt: new Date().toISOString(),
      count: 1,
    });
  }
  user.leads = user.leads.slice(0, MAX_LEADS);

  persist(user);
}

/** Dashboard uchun oxirgi mijozlar */
export function recentLeads(user, n = 15) {
  return (user.leads || []).slice(0, n);
}

/** Statistikani panelga qulay ko'rinishda qaytaradi */
export function statsSummary(user) {
  const s = user.stats || {};
  const days = s.days || {};
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    last7.push({ day: d.slice(5), count: days[d] || 0 });
  }
  return {
    messages: s.messages || 0,
    customers: Object.keys(s.customers || {}).length,
    channels: s.channels || { instagram: 0, facebook: 0, whatsapp: 0 },
    orders: s.orders || 0,
    last7,
  };
}

// ==== Operator chaqirish (handoff) ====

/** Mijoz operatorni chaqirayaptimi? */
export function isHandoffRequest(text) {
  return matches(text, HANDOFF_KEYWORDS);
}

/** Chat hozir qo'lda rejimda (operator boshqarmoqda)mi? */
export function isManual(user, chatKey) {
  const until = user.manualChats?.[chatKey];
  if (!until) return false;
  if (Date.now() > until) {
    delete user.manualChats[chatKey];
    persist(user);
    return false;
  }
  return true;
}

/** Chatni qo'lda rejimga o'tkazadi va murojaatni ro'yxatga qo'shadi */
export function startHandoff(user, channel, chatKey) {
  user.manualChats ||= {};
  user.manualChats[chatKey] = Date.now() + MANUAL_MODE_MS;
  user.handoffs ||= [];
  user.handoffs.unshift({
    id: `${Date.now()}-${chatKey}`,
    chatKey,
    channel,
    at: new Date().toISOString(),
    resolved: false,
  });
  user.handoffs = user.handoffs.slice(0, 50); // oxirgi 50 tasi
  persist(user);
}

/** Kutayotgan (hal qilinmagan) operator murojaatlari */
export function pendingHandoffs(user) {
  return (user.handoffs || []).filter((h) => !h.resolved);
}

/** Murojaatni hal qilingan deb belgilaydi va botni qayta yoqadi */
export function resolveHandoff(user, id) {
  const h = (user.handoffs || []).find((x) => x.id === id);
  if (h) {
    h.resolved = true;
    if (user.manualChats) delete user.manualChats[h.chatKey];
    persist(user);
  }
}
