/**
 * Admin panel statistikasi: bizneslar bo'yicha qisqa ma'lumot va platforma ko'rsatkichlari.
 */
import { statusInfo } from "../subscription.js";
import { aiQuota, currentPlan } from "../credits.js";

const DAY = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/** Bitta biznesning ro'yxat uchun ma'lumoti. */
export function businessSummary(u, now = Date.now()) {
  const st = statusInfo(u);
  const days = u.stats?.days || {};
  let msg7 = 0;
  for (let i = 0; i < 7; i++) msg7 += days[dayKey(now - i * DAY)] || 0;
  const lastDay = Object.keys(days).sort().pop() || "";
  const chats = u.chats || {};
  let lastAt = lastDay ? Date.parse(lastDay) : 0;
  for (const list of Object.values(chats)) {
    const m = Array.isArray(list) ? list[list.length - 1] : null;
    const t = m?.at ? Date.parse(m.at) : 0;
    if (t > lastAt) lastAt = t;
  }
  const channels = {
    ig: Boolean(u.meta?.igAccessToken || u.meta?.igUserId),
    fb: Boolean(u.meta?.pageAccessToken),
    wa: Boolean(u.meta?.whatsappToken),
    tg: Boolean(u.settings?.telegramBotToken),
  };
  let q = { used: 0, left: 0, quota: 0 };
  try { q = aiQuota(u, new Date(now)); } catch { /* eski ma'lumot */ }
  return {
    id: u.id,
    name: u.businessName || "—",
    email: u.email || "",
    createdAt: u.createdAt || "",
    status: st,
    plan: u.subscription?.plan || "start",
    tier: currentPlan(u),
    expiresAt: u.subscription?.expiresAt || u.subscription?.trialEndsAt || "",
    channels,
    channelCount: Object.values(channels).filter(Boolean).length,
    contacts: Object.keys(u.stats?.customers || {}).filter((k) => !k.includes("comment:")).length,
    messages: Math.max(u.stats?.messages || 0, Object.values(days).reduce((x, n) => x + (Number(n) || 0), 0)),
    msg7,
    aiUsed: q.used || 0,
    aiLeft: q.left || 0,
    flows: (u.flows?.list || []).length,
    activeFlows: (u.flows?.list || []).filter((f) => f.enabled).length,
    orders: (u.shop?.orders || []).length,
    blocked: Boolean(u.meta?.blocked),
    lastAt,
    trained: Boolean(String(u.businessInfo || "").trim()),
  };
}

/** Platforma ko'rsatkichlari va 30 kunlik qatorlar. */
export function platformStats(users, orders, now = Date.now()) {
  const list = users.map((u) => businessSummary(u, now));
  const paid = orders.filter((o) => o.status === "paid");
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const prevMonthStart = new Date(monthStart);
  prevMonthStart.setUTCMonth(prevMonthStart.getUTCMonth() - 1);
  const revenueMonth = paid.filter((o) => o.createdAt >= monthStart.getTime()).reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const revenuePrev = paid.filter((o) => o.createdAt >= prevMonthStart.getTime() && o.createdAt < monthStart.getTime()).reduce((s, o) => s + (Number(o.amount) || 0), 0);

  const signups = [];
  const messages = [];
  const revenue = [];
  for (let i = 29; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    const label = k.slice(8, 10) + "." + k.slice(5, 7);
    signups.push({ label, title: k, value: users.filter((u) => String(u.createdAt || "").slice(0, 10) === k).length });
    messages.push({ label, title: k, value: users.reduce((s, u) => s + (u.stats?.days?.[k] || 0), 0) });
    revenue.push({ label, title: k, value: paid.filter((o) => dayKey(o.createdAt) === k).reduce((s, o) => s + (Number(o.amount) || 0), 0) });
  }
  const weekAgo = now - 7 * DAY;
  return {
    list,
    total: list.length,
    active: list.filter((b) => b.status.kind === "active").length,
    trial: list.filter((b) => b.status.kind === "trial").length,
    expired: list.filter((b) => b.status.kind === "expired").length,
    blocked: list.filter((b) => b.blocked).length,
    connected: list.filter((b) => b.channelCount > 0).length,
    newWeek: users.filter((u) => Date.parse(u.createdAt || 0) >= weekAgo).length,
    activeWeek: list.filter((b) => b.lastAt >= weekAgo).length,
    messages7: list.reduce((s, b) => s + b.msg7, 0),
    messagesTotal: list.reduce((s, b) => s + b.messages, 0),
    contacts: list.reduce((s, b) => s + b.contacts, 0),
    aiUsed: list.reduce((s, b) => s + b.aiUsed, 0),
    revenueMonth,
    revenuePrev,
    revenueTotal: paid.reduce((s, o) => s + (Number(o.amount) || 0), 0),
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    series: { signups, messages, revenue },
  };
}

/** Obuna/holat bo'yicha rangli belgi. */
export function statusPill(b) {
  if (b.blocked) return `<span class="pill bad">⛔ Bloklangan</span>`;
  const k = b.status.kind;
  const cls = k === "active" ? "ok" : k === "trial" ? "info" : "warn";
  return `<span class="pill ${cls}">${k === "expired" && b.tier === "free" ? "Bepul tarif" : b.status.label}</span>`;
}
