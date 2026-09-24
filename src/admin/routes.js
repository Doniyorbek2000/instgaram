/**
 * Obunext admin paneli (/admin) — platforma egasi uchun alohida ilova.
 * Biznes akkauntlaridan mustaqil kirish (telefon + parol), barcha amallar audit jurnaliga yoziladi.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { esc } from "../web/layout.js";
import { logoMark } from "../web/brand.js";
import { adminPage, barChart, money, fmtDate } from "./layout.js";
import { businessSummary, platformStats, statusPill } from "./stats.js";
import {
  verifyAdmin, issueSession, readCookie, checkSession, sessionCookie, requireAdminSession,
  audit, auditLog, clientIp, changeAdminPassword, usingDefaultPassword, adminLogin,
} from "./auth.js";
import {
  listUsers, findUserById, updateUser, dbStatus, persist, listOrders, findOrder, updateOrder, deleteUser,
  createSession, deleteUserSessions, getPlanPrices, setPlanPrices, getPlatformGeminiKey, setPlatformGeminiKey, listPaymeTx,
} from "../db.js";
import { getPlans, PLAN_DEFS, activate, deactivate } from "../subscription.js";
import { addCredits, CREDIT_PACKS, CREDIT_ORDER_PREFIX, getCreditPacks, platformSettings, savePlatformSettings, AI_QUOTA } from "../credits.js";
import { config, paymeReady } from "../config.js";
import { isPgReady } from "../pgdb.js";
import { deleteHistory } from "../chatStore.js";
import { diagnoseBusiness } from "./diagnostics.js";
import { registerAiCostRoutes } from "./aiCostPage.js";
import { monthCost, toSom, aiPricing } from "../aiCost.js";
import { siteSettings, saveSiteSettings, contactMessages, updateContactMessages } from "../siteSettings.js";

export const adminRouter = Router();

const CHAN = { ig: "IG", fb: "FB", wa: "WA", tg: "TG" };
const back = (req, fallback) => (typeof req.body?.back === "string" && /^\/admin(\/|\?|$)/.test(req.body.back) ? req.body.back : fallback);
const flashOf = (req) => (req.query.ok ? [String(req.query.ok), "ok"] : req.query.err ? [String(req.query.err), "bad"] : ["", "ok"]);
const go = (res, url, key, msg) => res.redirect(`${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);

// ================= Kirish =================

function loginPage(error = "", next = "/admin") {
  return `<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kirish — Obunext Admin</title><meta name="robots" content="noindex, nofollow"><link rel="icon" href="/favicon.png" type="image/png">
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(700px 400px at 50% -10%,rgba(139,92,246,.28),transparent 70%),#0a0d16;color:#e6e9f2;font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .box{width:100%;max-width:380px;background:#111626;border:1px solid #222a42;border-radius:18px;padding:30px 28px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
  .b{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;margin-bottom:6px} .b small{display:block;font-size:11px;letter-spacing:.14em;color:#8b5cf6;text-transform:uppercase}
  p{color:#8a93ab;margin:0 0 20px} label{display:block;font-size:12px;font-weight:700;color:#aeb5c9;margin-top:10px}
  input{width:100%;background:#0b0f1c;border:1px solid #222a42;color:#e6e9f2;border-radius:10px;padding:12px 13px;font:inherit;margin-top:5px}
  input:focus{outline:none;border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.2)}
  button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:linear-gradient(120deg,#8b5cf6,#ec4899);color:#fff;font:inherit;font-weight:800;cursor:pointer}
  .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5;padding:10px 12px;border-radius:10px;margin-bottom:12px;font-weight:600}
  .f{margin-top:18px;text-align:center;font-size:12px;color:#5b647d}
</style></head><body>
<form class="box" method="post" action="/admin/login" autocomplete="on">
  <div class="b">${logoMark(34)}<div>Obunext<small>Admin panel</small></div></div>
  <p>Platforma boshqaruviga kirish</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="l">Telefon raqam</label>
  <input id="l" name="login" type="tel" inputmode="tel" autocomplete="username" placeholder="+998 90 123 45 67" required autofocus>
  <label for="p">Parol</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button>Kirish</button>
  <div class="f">Barcha kirishlar jurnalga yoziladi</div>
</form></body></html>`;
}

adminRouter.get("/admin/login", async (req, res) => {
  if (await checkSession(readCookie(req))) return res.redirect("/admin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  const next = /^\/admin(\/|\?|$)/.test(String(req.query.next || "")) ? String(req.query.next) : "/admin";
  res.send(loginPage("", next));
});

adminRouter.post("/admin/login", async (req, res) => {
  const ip = clientIp(req);
  const r = await verifyAdmin(req.body?.login, req.body?.password, ip);
  const next = /^\/admin(\/|\?|$)/.test(String(req.body?.next || "")) && !String(req.body.next).startsWith("/admin/login") ? String(req.body.next) : "/admin";
  if (!r.ok) {
    await audit(req, "login_failed", String(req.body?.login || "").slice(0, 20));
    return res.status(401).send(loginPage(r.error, next));
  }
  await audit(req, "login", await adminLogin());
  res.setHeader("Set-Cookie", sessionCookie(req, await issueSession()));
  res.redirect(next);
});

adminRouter.post("/admin/logout", async (req, res) => {
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
  res.redirect("/admin/login");
});

// Qolgan barcha /admin sahifalari — faqat admin sessiyasi bilan
adminRouter.use("/admin", requireAdminSession);

// Dastlabki (repodagi) parol bilan ishlash mumkin emas — avval parolni almashtirish shart
adminRouter.use("/admin", async (req, res, next) => {
  if (req.path === "/security" || req.path === "/logout" || !(await usingDefaultPassword())) return next();
  if (req.method !== "GET") return res.status(403).send("Avval dastlabki admin parolini almashtiring");
  go(res, "/admin/security", "err", "Davom etish uchun dastlabki parolni almashtiring");
});

// ================= Boshqaruv (dashboard) =================

adminRouter.get("/admin", async (req, res) => {
  const [users, orders] = await Promise.all([listUsers(), listOrders({ limit: 2000 })]);
  const s = platformStats(users, orders);
  const recent = [...s.list].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 8);
  const top = [...s.list].sort((a, b) => b.msg7 - a.msg7).slice(0, 8);
  const expiring = s.list.filter((b) => b.status.active && b.status.until && b.status.until - Date.now() < 3 * 86400000).slice(0, 8);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const revDelta = s.revenuePrev ? Math.round(((s.revenueMonth - s.revenuePrev) / s.revenuePrev) * 100) : null;
  const dbs = dbStatus();
  const warn = dbs.fallback
    ? `<div class="flash bad">⚠️ PostgreSQL'ga ulanib bo'lmadi — ma'lumotlar VAQTINCHA JSON faylga yozilmoqda. Sabab: ${esc(dbs.error || "noma'lum")}. Bazani tiklab, serverni qayta ishga tushiring (<a href="/admin/system">Tizim</a>).</div>`
    : "";

  const kpi = (l, v, sub = "", cls = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s ${cls}">${sub}</div>` : ""}</div>`;
  const body = `${warn}
    <div class="grid kpis">
      ${kpi("Bizneslar", s.total, `+${s.newWeek} shu hafta`, s.newWeek ? "up" : "")}
      ${kpi("Faol obuna", s.active, `${s.trial} sinovda · ${s.expired} tugagan`)}
      ${kpi("Shu oy tushum", money(s.revenueMonth), revDelta === null ? "o'tgan oy: 0" : `${revDelta >= 0 ? "▲" : "▼"} ${Math.abs(revDelta)}% o'tgan oyga nisbatan`, revDelta === null ? "" : revDelta >= 0 ? "up" : "down")}
      ${kpi("Xabarlar (7 kun)", s.messages7.toLocaleString("ru-RU"), `jami ${s.messagesTotal.toLocaleString("ru-RU")}`)}
      ${kpi("Faol bizneslar (7 kun)", s.activeWeek, `${s.connected} ta tarmoq ulagan`)}
      ${kpi("AI javoblar (shu oy)", s.aiUsed.toLocaleString("ru-RU"), `${s.contacts.toLocaleString("ru-RU")} ta mijoz kontakti`)}
    </div>
    <div class="grid half">
      <div class="card"><h2>📈 Ro'yxatdan o'tishlar — 30 kun</h2>${barChart(s.series.signups)}</div>
      <div class="card"><h2>💬 Xabarlar — 30 kun</h2>${barChart(s.series.messages, { format: (v) => v.toLocaleString("ru-RU") })}</div>
    </div>
    <div class="card"><h2>💰 Tushum — 30 kun</h2>${barChart(s.series.revenue, { format: money })}</div>
    <div class="grid half">
      <div class="card"><h2>🆕 Yangi bizneslar</h2>${miniTable(recent, (b) => `<td><a href="/admin/businesses/${esc(b.id)}"><b>${esc(b.name)}</b></a><div class="hint">${esc(b.email)}</div></td><td>${statusPill(b)}</td><td class="hint">${esc(fmtDate(b.createdAt))}</td>`)}</div>
      <div class="card"><h2>🔥 Eng faol (7 kun)</h2>${miniTable(top, (b) => `<td><a href="/admin/businesses/${esc(b.id)}"><b>${esc(b.name)}</b></a></td><td>${b.msg7.toLocaleString("ru-RU")} xabar</td><td class="hint">${b.contacts} mijoz</td>`)}</div>
    </div>
    <div class="grid half">
      <div class="card"><h2>⏳ 3 kun ichida tugaydi</h2>${expiring.length ? miniTable(expiring, (b) => `<td><a href="/admin/businesses/${esc(b.id)}"><b>${esc(b.name)}</b></a></td><td>${statusPill(b)}</td><td class="hint">${esc(fmtDate(b.status.until))}</td>`) : `<p class="hint">Yaqin kunlarda tugaydigan obuna yo'q</p>`}</div>
      <div class="card"><h2>💳 Oxirgi to'lovlar</h2>${orders.length ? miniTable(orders.slice(0, 8), (o) => `<td>${byId[o.userId] ? `<a href="/admin/businesses/${esc(o.userId)}">${esc(byId[o.userId].businessName || byId[o.userId].email)}</a>` : `<span class="hint">o'chirilgan</span>`}</td><td><b>${esc(money(o.amount))}</b></td><td>${orderPill(o)}</td>`) : `<p class="hint">Hali to'lov yo'q</p>`}</div>
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("Boshqaruv", body, { active: "dashboard", flash, flashKind: kind }));
});

function miniTable(rows, cells) {
  return `<div class="tw"><table><tbody>${rows.map((r) => `<tr>${cells(r)}</tr>`).join("")}</tbody></table></div>`;
}

function orderPill(o) {
  if (o.status === "paid") return `<span class="pill ok">To'langan</span>`;
  if (o.status === "cancelled") return `<span class="pill bad">Bekor</span>`;
  return `<span class="pill warn">Kutilmoqda</span>`;
}

// ================= Bizneslar =================

const SORTS = {
  new: (a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0),
  active: (a, b) => b.lastAt - a.lastAt,
  messages: (a, b) => b.msg7 - a.msg7,
  contacts: (a, b) => b.contacts - a.contacts,
  expires: (a, b) => (Date.parse(a.expiresAt) || Infinity) - (Date.parse(b.expiresAt) || Infinity),
  name: (a, b) => a.name.localeCompare(b.name),
};

function filterBusinesses(list, q) {
  const text = String(q.q || "").trim().toLowerCase();
  return list
    .filter((b) => !text || b.name.toLowerCase().includes(text) || b.email.toLowerCase().includes(text) || b.id.startsWith(text))
    .filter((b) => {
      const st = String(q.status || "");
      if (!st) return true;
      if (st === "blocked") return b.blocked;
      if (st === "free") return b.tier === "free";
      return b.status.kind === st;
    })
    .filter((b) => !q.channel || (q.channel === "none" ? b.channelCount === 0 : b.channels[q.channel]))
    .sort(SORTS[q.sort] || SORTS.new);
}

adminRouter.get("/admin/businesses", async (req, res) => {
  const users = await listUsers();
  const all = users.map((u) => businessSummary(u));
  const list = filterBusinesses(all, req.query);
  const per = 50;
  const pageNo = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pages = Math.max(1, Math.ceil(list.length / per));
  const rows = list.slice((pageNo - 1) * per, pageNo * per);
  const qs = (extra) => new URLSearchParams({ ...Object.fromEntries(Object.entries(req.query).filter(([, v]) => v)), ...extra }).toString();
  const opt = (name, value, label) => `<option value="${value}" ${String(req.query[name] || "") === value ? "selected" : ""}>${label}</option>`;

  const body = `
    <form class="card row" method="get" action="/admin/businesses" style="padding:14px">
      <input class="grow" name="q" value="${esc(req.query.q || "")}" placeholder="Nomi, email yoki ID bo'yicha qidirish" style="margin:0">
      <select name="status" style="margin:0; width:auto">${opt("status", "", "Barcha holatlar")}${opt("status", "active", "Faol obuna")}${opt("status", "trial", "Sinovda")}${opt("status", "expired", "Tugagan")}${opt("status", "free", "Bepul tarif")}${opt("status", "blocked", "Bloklangan")}</select>
      <select name="channel" style="margin:0; width:auto">${opt("channel", "", "Barcha kanallar")}${opt("channel", "ig", "Instagram")}${opt("channel", "tg", "Telegram")}${opt("channel", "wa", "WhatsApp")}${opt("channel", "fb", "Messenger")}${opt("channel", "none", "Ulanmagan")}</select>
      <select name="sort" style="margin:0; width:auto">${opt("sort", "", "Yangilari")}${opt("sort", "active", "Oxirgi faollik")}${opt("sort", "messages", "Xabarlar (7 kun)")}${opt("sort", "contacts", "Mijozlar")}${opt("sort", "expires", "Tugash sanasi")}${opt("sort", "name", "Nomi")}</select>
      <button class="btn">Qidirish</button>
      <a class="btn sec" href="/admin/businesses.csv?${qs({})}">⬇️ CSV</a>
    </form>
    <div class="card">
      <h2>Bizneslar <span class="pill mute">${list.length} / ${all.length}</span></h2>
      <div class="tw"><table>
        <thead><tr><th>Biznes</th><th>Holat</th><th>Tarif</th><th>Kanallar</th><th>Mijozlar</th><th>Xabar (7 kun)</th><th>AI (oy)</th><th>Oxirgi faollik</th><th>Ro'yxatdan</th></tr></thead>
        <tbody>${rows.map((b) => `<tr>
          <td><a href="/admin/businesses/${esc(b.id)}"><b>${esc(b.name)}</b></a><div class="hint">${esc(b.email)}</div></td>
          <td>${statusPill(b)}</td>
          <td>${esc(PLAN_DEFS[b.plan]?.name || b.plan)}${b.expiresAt ? `<div class="hint">${esc(fmtDate(b.expiresAt).slice(0, 10))} gacha</div>` : ""}</td>
          <td>${Object.entries(b.channels).map(([k, on]) => `<span class="pill ${on ? "ok" : "mute"}" style="margin:1px">${CHAN[k]}</span>`).join("")}</td>
          <td>${b.contacts}</td><td>${b.msg7}</td><td>${b.aiUsed}</td>
          <td class="hint">${b.lastAt ? esc(fmtDate(b.lastAt)) : "—"}</td>
          <td class="hint">${esc(fmtDate(b.createdAt).slice(0, 10))}</td>
        </tr>`).join("") || `<tr><td colspan="9" class="hint">Topilmadi</td></tr>`}</tbody>
      </table></div>
      ${pages > 1 ? `<div class="row" style="margin-top:12px">${Array.from({ length: pages }, (_, i) => i + 1).map((n) => `<a class="btn ${n === pageNo ? "" : "sec"} sm" href="/admin/businesses?${qs({ page: n })}">${n}</a>`).join("")}</div>` : ""}
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("Bizneslar", body, { active: "businesses", flash, flashKind: kind }));
});

adminRouter.get("/admin/businesses.csv", async (req, res) => {
  const list = filterBusinesses((await listUsers()).map((u) => businessSummary(u)), req.query);
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // formula injection himoyasi
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ["ID", "Biznes", "Email", "Holat", "Tarif", "Tugash", "Instagram", "Telegram", "WhatsApp", "Messenger", "Mijozlar", "Xabarlar jami", "Xabarlar 7 kun", "AI oy", "Flow'lar", "Bloklangan", "Ro'yxatdan"];
  const lines = list.map((b) => [b.id, b.name, b.email, b.status.label, b.plan, b.expiresAt, b.channels.ig, b.channels.tg, b.channels.wa, b.channels.fb, b.contacts, b.messages, b.msg7, b.aiUsed, b.flows, b.blocked, b.createdAt].map(cell).join(","));
  await audit(req, "export_csv", `${list.length} ta biznes`);
  res.setHeader("Content-Disposition", `attachment; filename="obunext-bizneslar-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type("text/csv").send("﻿" + [head.map(cell).join(","), ...lines].join("\n"));
});

adminRouter.get("/admin/businesses/:id", async (req, res) => {
  const u = await findUserById(req.params.id);
  if (!u) return go(res, "/admin/businesses", "err", "Biznes topilmadi");
  const b = businessSummary(u);
  const plans = await getPlans();
  const orders = (await listOrders({ limit: 3000 })).filter((o) => o.userId === u.id).slice(0, 20);
  const url = `/admin/businesses/${u.id}`;
  const tmp = req.query.tmp ? `<div class="flash warn">🔑 Vaqtinchalik parol: <code style="font-size:15px">${esc(req.query.tmp)}</code> — biznes egasiga yuboring, u kirgach o'zgartirsin. Bu parol qayta ko'rsatilmaydi.</div>` : "";
  const m = u.meta || {};
  const mask = (v) => (v ? `${String(v).slice(0, 6)}…${String(v).slice(-4)}` : "—");

  const body = `${tmp}
    <div class="row" style="margin-bottom:14px">
      <a class="btn sec sm" href="/admin/businesses">← Bizneslar</a>
      <span style="flex:1"></span>
      <form method="post" action="${url}/impersonate" style="margin:0" onsubmit="return confirm('Bu biznes kabinetiga kirasizmi? Amal jurnalga yoziladi.')"><button class="btn sm">👁️ Kabinetga kirish</button></form>
      <form method="post" action="${url}/block" style="margin:0" onsubmit="return confirm('${b.blocked ? "Blokdan chiqarilsinmi?" : "Biznes bloklansinmi? Bot to\\'xtaydi va kirish yopiladi."}')"><input type="hidden" name="on" value="${b.blocked ? "0" : "1"}"><button class="btn ${b.blocked ? "sec" : "danger"} sm">${b.blocked ? "✅ Blokdan chiqarish" : "⛔ Bloklash"}</button></form>
    </div>
    <div class="grid kpis">
      <div class="kpi"><div class="l">Holat</div><div class="v" style="font-size:16px; margin-top:8px">${statusPill(b)}</div><div class="s">${b.expiresAt ? `${esc(fmtDate(b.expiresAt))} gacha` : ""}</div></div>
      <div class="kpi"><div class="l">Mijozlar</div><div class="v">${b.contacts}</div></div>
      <div class="kpi"><div class="l">Xabarlar</div><div class="v">${b.messages.toLocaleString("ru-RU")}</div><div class="s">${b.msg7} — oxirgi 7 kun</div></div>
      <div class="kpi"><div class="l">AI (shu oy)</div><div class="v">${b.aiUsed}</div><div class="s">${b.aiLeft} qoldi</div></div>
      <div class="kpi"><div class="l">Flow'lar</div><div class="v">${b.flows}</div><div class="s">${b.activeFlows} faol</div></div>
      <div class="kpi"><div class="l">Buyurtmalar</div><div class="v">${b.orders}</div></div>
    </div>
    <div class="grid two">
      <div>
        <div class="card"><h2>🏢 Ma'lumot</h2>
          <div class="kv">
            <div>Nomi</div><div><b>${esc(b.name)}</b></div>
            <div>Email</div><div>${esc(b.email)}</div>
            <div>ID</div><div><code>${esc(u.id)}</code></div>
            <div>Ro'yxatdan o'tgan</div><div>${esc(fmtDate(b.createdAt))}</div>
            <div>Oxirgi faollik</div><div>${b.lastAt ? esc(fmtDate(b.lastAt)) : "—"}</div>
            <div>AI o'qitilgan</div><div>${b.trained ? `<span class="pill ok">Ha</span>` : `<span class="pill warn">Yo'q</span>`}</div>
            <div>Kanallar</div><div>${Object.entries(b.channels).map(([k, on]) => `<span class="pill ${on ? "ok" : "mute"}" style="margin:1px">${CHAN[k]}</span>`).join("")}${m.igUsername ? ` <a href="https://instagram.com/${esc(m.igUsername)}" target="_blank" rel="noopener">@${esc(m.igUsername)}</a>` : ""}</div>
            <div>Telegram bildirishnoma</div><div>${u.settings?.telegramChatId ? `<span class="pill ok">Ulangan</span>` : `<span class="pill mute">Yo'q</span>`}</div>
          </div>
        </div>
        <div class="card"><h2>💳 Obuna</h2>
          <form method="post" action="${url}/subscription" class="row" style="margin:0">
            <select name="plan" style="margin:0; width:auto">${Object.values(plans).map((p) => `<option value="${p.id}" ${u.subscription?.plan === p.id ? "selected" : ""}>${esc(p.name)} — ${esc(money(p.price))}</option>`).join("")}</select>
            <button class="btn sm" name="action" value="30">+30 kun</button>
            <button class="btn sec sm" name="action" value="90">+90 kun</button>
            <button class="btn sec sm" name="action" value="365">+365 kun</button>
            <button class="btn sec sm" name="action" value="plan">Faqat tarifni o'zgartirish</button>
          </form>
          <form method="post" action="${url}/subscription" class="row" style="margin:10px 0 0">
            <div class="grow"><label>Aniq tugash sanasi</label><input type="date" name="until" style="margin:0" required></div>
            <button class="btn sec sm" name="action" value="until" style="align-self:end">Belgilash</button>
            <button class="btn danger sm" name="action" value="off" formnovalidate style="align-self:end" onclick="return confirm('Obuna bekor qilinsinmi?')">Bekor qilish</button>
          </form>
        </div>
        <div class="card"><h2>🩺 Ulanishlar holati</h2>
          ${diagHtml(m.lastDiagnostics)}
          <form method="post" action="${url}/diagnose" style="margin:10px 0 0"><button class="btn sm">🩺 Ulanishlarni tekshirish</button></form>
        </div>
        <div class="card"><h2>🔌 Tokenlar va kalitlar</h2>
          <p class="hint" style="margin-top:0">Hozirgi qiymatlar yashirin. O'zgartirish uchun yangi qiymatni kiriting — bo'sh maydon o'zgarmaydi. "-" kiritilsa o'chiriladi.</p>
          <form method="post" action="${url}/meta" style="margin:0">
            <div class="grid half" style="gap:0 14px">
              ${[["igAccessToken", "Instagram token", m.igAccessToken], ["igUserId", "Instagram user ID", m.igUserId], ["pageAccessToken", "Facebook Page token", m.pageAccessToken], ["pageId", "Facebook Page ID", m.pageId], ["whatsappToken", "WhatsApp token", m.whatsappToken], ["whatsappPhoneNumberId", "WhatsApp Phone Number ID", m.whatsappPhoneNumberId], ["geminiApiKey", "Alohida Gemini kaliti", u.geminiApiKey]]
                .map(([k, l, v]) => `<div><label>${l} <span class="hint">(${esc(mask(v))})</span></label><input name="${k}" autocomplete="off" placeholder="o'zgarmaydi"></div>`).join("")}
            </div>
            <button class="btn sm">Saqlash</button>
          </form>
        </div>
      </div>
      <div>
        <div class="card"><h2>🧠 AI kreditlari</h2>
          <form method="post" action="${url}/credits" class="row" style="margin:0">
            <input class="grow" type="number" name="credits" placeholder="+500 yoki -100" required style="margin:0">
            <button class="btn sm">Qo'llash</button>
          </form>
          <p class="hint">Bonus kreditlar: <b>${u.aiUsage?.bonus || 0}</b> · Oylik kvota: ${AI_QUOTA[b.tier] ?? "—"}</p>
          <p class="hint">Shu oy AI xarajati: <b>${esc(money(Math.round(toSom(monthCost(u).usd, aiPricing()))))}</b> · ${monthCost(u).calls} ta chaqiruv · <a href="/admin/ai-cost">batafsil</a></p>
        </div>
        <div class="card"><h2>🔑 Kirish</h2>
          <form method="post" action="${url}/reset-password" style="margin:0" onsubmit="return confirm('Yangi vaqtinchalik parol yaratilsinmi? Biznesning barcha sessiyalari yopiladi.')">
            <button class="btn sec sm">Vaqtinchalik parol yaratish</button>
          </form>
          <form method="post" action="${url}/logout-all" style="margin:10px 0 0"><button class="btn sec sm">Barcha qurilmalardan chiqarish</button></form>
        </div>
        <div class="card"><h2>📝 Admin izohi</h2>
          <form method="post" action="${url}/note" style="margin:0">
            <textarea name="note" rows="3" maxlength="2000" placeholder="Faqat adminlar ko'radi">${esc(m.adminNote || "")}</textarea>
            <button class="btn sec sm">Saqlash</button>
          </form>
        </div>
        <div class="card"><h2>💵 To'lovlari</h2>
          ${orders.length ? miniTable(orders, (o) => `<td class="hint">${esc(fmtDate(o.createdAt))}</td><td>${esc(String(o.plan || "").startsWith(CREDIT_ORDER_PREFIX) ? "Kredit" : PLAN_DEFS[o.plan]?.name || o.plan)} ${o.days ? `· ${o.days} kun` : ""}</td><td><b>${esc(money(o.amount))}</b></td><td>${orderPill(o)}</td>`) : `<p class="hint">To'lov yo'q</p>`}
        </div>
        <div class="card" style="border-color:rgba(239,68,68,.35)"><h2 style="color:#fca5a5">⚠️ Xavfli hudud</h2>
          <form method="post" action="${url}/delete" style="margin:0" onsubmit="return confirm('Biznes va uning BARCHA ma\\'lumotlari butunlay o\\'chiriladi. Davom etasizmi?')">
            <label>Tasdiqlash uchun biznes emailini yozing</label>
            <input name="confirm" autocomplete="off" placeholder="${esc(b.email)}" required>
            <button class="btn danger sm">Butunlay o'chirish</button>
          </form>
        </div>
      </div>
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage(b.name, body, { active: "businesses", flash, flashKind: kind }));
});

const DIAG_PILL = { ok: ["ok", "✓"], warn: ["warn", "!"], bad: ["bad", "✕"], off: ["mute", "—"] };
function diagHtml(d) {
  if (!d?.results?.length) return `<p class="hint" style="margin:0">Hali tekshirilmagan. Tugma Instagram, Facebook, WhatsApp va Telegram API'lariga haqiqiy so'rov yuboradi.</p>`;
  return `<p class="hint" style="margin-top:0">Oxirgi tekshiruv: ${esc(fmtDate(d.at))}</p><div class="kv">${d.results
    .map((r) => `<div><span class="pill ${DIAG_PILL[r.status]?.[0] || "mute"}">${DIAG_PILL[r.status]?.[1] || ""} ${esc(r.channel)}</span></div><div><b>${esc(r.title)}</b>${r.detail ? `<div class="hint">${esc(r.detail)}</div>` : ""}</div>`)
    .join("")}</div>`;
}

const withBusiness = (handler) => async (req, res) => {
  const u = await findUserById(req.params.id);
  if (!u) return go(res, "/admin/businesses", "err", "Biznes topilmadi");
  return handler(req, res, u, `/admin/businesses/${u.id}`);
};

adminRouter.post("/admin/businesses/:id/subscription", withBusiness(async (req, res, u, url) => {
  const action = String(req.body?.action || "");
  const plan = PLAN_DEFS[req.body?.plan] ? req.body.plan : u.subscription?.plan;
  u.subscription ||= { plan: "start", status: "trial" };
  if (action === "off") {
    deactivate(u);
    await audit(req, "subscription_cancel", u.email);
    return go(res, url, "ok", "Obuna bekor qilindi");
  }
  if (action === "plan") {
    u.subscription.plan = plan;
    persist(u);
    await audit(req, "plan_change", u.email, plan);
    return go(res, url, "ok", "Tarif o'zgartirildi");
  }
  if (action === "until") {
    const t = Date.parse(String(req.body?.until || ""));
    if (!Number.isFinite(t) || t < Date.now()) return go(res, url, "err", "Kelajakdagi sanani tanlang");
    u.subscription.status = "active";
    u.subscription.expiresAt = new Date(t + 86399000).toISOString();
    u.subscription.plan = plan;
    persist(u);
    await audit(req, "subscription_until", u.email, `${plan} → ${req.body.until}`);
    return go(res, url, "ok", "Obuna muddati belgilandi");
  }
  const days = Number.parseInt(action, 10);
  if (!(days > 0 && days <= 3650)) return go(res, url, "err", "Noto'g'ri amal");
  activate(u, days, plan);
  await audit(req, "subscription_extend", u.email, `${plan} +${days} kun`);
  go(res, url, "ok", `Obuna ${days} kunga uzaytirildi`);
}));

adminRouter.post("/admin/businesses/:id/diagnose", withBusiness(async (req, res, u, url) => {
  const results = await diagnoseBusiness(u);
  u.meta ||= {};
  u.meta.lastDiagnostics = { at: new Date().toISOString(), results };
  await persist(u);
  await audit(req, "diagnose", u.email, results.map((r) => `${r.channel}:${r.status}`).join(" "));
  const bad = results.filter((r) => r.status === "bad").length;
  go(res, url, bad ? "err" : "ok", bad ? `${bad} ta ulanishda muammo topildi` : "Tekshiruv tugadi");
}));

adminRouter.post("/admin/businesses/:id/credits", withBusiness(async (req, res, u, url) => {
  const n = Math.trunc(Number(req.body?.credits) || 0);
  if (!n || Math.abs(n) > 1000000) return go(res, url, "err", "Kredit sonini kiriting");
  addCredits(u, n);
  await audit(req, "credits", u.email, String(n));
  go(res, url, "ok", `${n > 0 ? "+" : ""}${n} kredit qo'llandi`);
}));

adminRouter.post("/admin/businesses/:id/block", withBusiness(async (req, res, u, url) => {
  const on = req.body?.on === "1";
  await updateUser(u.id, { meta: { blocked: on } });
  u.meta = { ...(u.meta || {}), blocked: on };
  if (on) await deleteUserSessions(u.id);
  await audit(req, on ? "block" : "unblock", u.email);
  go(res, url, "ok", on ? "Biznes bloklandi — bot to'xtatildi, sessiyalar yopildi" : "Blokdan chiqarildi");
}));

adminRouter.post("/admin/businesses/:id/impersonate", withBusiness(async (req, res, u) => {
  const token = await createSession(u.id);
  await audit(req, "impersonate", u.email);
  const secure = req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${2 * 3600}${secure}`);
  res.redirect("/dashboard");
}));

adminRouter.post("/admin/businesses/:id/reset-password", withBusiness(async (req, res, u, url) => {
  const tmp = crypto.randomBytes(6).toString("base64url");
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.scryptSync(tmp, salt, 64).toString("hex");
  await updateUser(u.id, { salt, passwordHash });
  Object.assign(u, { salt, passwordHash });
  await deleteUserSessions(u.id);
  await audit(req, "reset_password", u.email);
  res.redirect(`${url}?tmp=${encodeURIComponent(tmp)}`);
}));

adminRouter.post("/admin/businesses/:id/logout-all", withBusiness(async (req, res, u, url) => {
  await deleteUserSessions(u.id);
  await audit(req, "logout_all", u.email);
  go(res, url, "ok", "Barcha sessiyalar yopildi");
}));

adminRouter.post("/admin/businesses/:id/note", withBusiness(async (req, res, u, url) => {
  const note = String(req.body?.note || "").slice(0, 2000);
  await updateUser(u.id, { meta: { adminNote: note } });
  u.meta = { ...(u.meta || {}), adminNote: note };
  go(res, url, "ok", "Izoh saqlandi");
}));

adminRouter.post("/admin/businesses/:id/meta", withBusiness(async (req, res, u, url) => {
  const meta = {};
  const changed = [];
  for (const k of ["igAccessToken", "igUserId", "pageAccessToken", "pageId", "whatsappToken", "whatsappPhoneNumberId"]) {
    const v = String(req.body?.[k] || "").trim();
    if (!v) continue;
    meta[k] = v === "-" ? "" : v.slice(0, 2000);
    changed.push(k);
  }
  const patch = Object.keys(meta).length ? { meta } : {};
  const gk = String(req.body?.geminiApiKey || "").trim();
  if (gk) { patch.geminiApiKey = gk === "-" ? "" : gk.slice(0, 200); changed.push("geminiApiKey"); }
  if (!changed.length) return go(res, url, "err", "Hech narsa o'zgartirilmadi");
  await updateUser(u.id, patch);
  await audit(req, "tokens_update", u.email, changed.join(", "));
  go(res, url, "ok", `Yangilandi: ${changed.join(", ")}`);
}));

adminRouter.post("/admin/businesses/:id/delete", withBusiness(async (req, res, u, url) => {
  if (String(req.body?.confirm || "").trim().toLowerCase() !== String(u.email || "").toLowerCase()) return go(res, url, "err", "Email mos kelmadi — o'chirilmadi");
  await deleteUser(u.id);
  await deleteHistory(u.id).catch((err) => console.error("[Arxiv] o'chirishda xato:", err.message));
  await audit(req, "delete_business", u.email, u.businessName || "");
  go(res, "/admin/businesses", "ok", `${u.businessName || u.email} o'chirildi`);
}));

// ================= To'lovlar =================

adminRouter.get("/admin/payments", async (req, res) => {
  const [orders, users, txs] = await Promise.all([listOrders({ limit: 3000 }), listUsers(), listPaymeTx({}).catch(() => [])]);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const st = String(req.query.status || "");
  const list = orders.filter((o) => !st || o.status === st);
  const paid = orders.filter((o) => o.status === "paid");
  const sum = (arr) => arr.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const month = new Date().toISOString().slice(0, 7);
  const body = `
    <div class="grid kpis">
      <div class="kpi"><div class="l">Jami tushum</div><div class="v">${esc(money(sum(paid)))}</div><div class="s">${paid.length} ta to'lov</div></div>
      <div class="kpi"><div class="l">Shu oy</div><div class="v">${esc(money(sum(paid.filter((o) => new Date(o.createdAt).toISOString().slice(0, 7) === month))))}</div></div>
      <div class="kpi"><div class="l">Kutilayotgan</div><div class="v">${orders.filter((o) => o.status === "pending").length}</div><div class="s">yaratilgan, to'lanmagan</div></div>
      <div class="kpi"><div class="l">Payme tranzaksiyalar</div><div class="v">${txs.length}</div><div class="s">${paymeReady ? "Payme ulangan" : "Payme sozlanmagan"}</div></div>
    </div>
    <div class="card">
      <div class="tabs">${[["", "Barchasi"], ["paid", "To'langan"], ["pending", "Kutilmoqda"], ["cancelled", "Bekor"]].map(([k, l]) => `<a class="btn ${st === k ? "" : "sec"} sm" href="/admin/payments${k ? `?status=${k}` : ""}">${l}</a>`).join("")}</div>
      <div class="tw"><table>
        <thead><tr><th>Sana</th><th>Biznes</th><th>Nima uchun</th><th>Summa</th><th>Holat</th><th></th></tr></thead>
        <tbody>${list.slice(0, 300).map((o) => {
          const u = byId[o.userId];
          const what = String(o.plan || "").startsWith(CREDIT_ORDER_PREFIX)
            ? `🧠 ${CREDIT_PACKS[o.plan.slice(CREDIT_ORDER_PREFIX.length)]?.credits || ""} kredit`
            : `${PLAN_DEFS[o.plan]?.name || o.plan} · ${o.days || 0} kun`;
          return `<tr><td class="hint">${esc(fmtDate(o.createdAt))}</td>
            <td>${u ? `<a href="/admin/businesses/${esc(u.id)}">${esc(u.businessName || u.email)}</a>` : `<span class="hint">o'chirilgan</span>`}</td>
            <td>${esc(what)}</td><td><b>${esc(money(o.amount))}</b></td><td>${orderPill(o)}</td>
            <td>${o.status === "pending" && u ? `<form method="post" action="/admin/payments/${esc(o.id)}/confirm" style="margin:0" onsubmit="return confirm('To\\'lov qo\\'lda tasdiqlansinmi? Obuna/kredit darhol faollashadi.')"><button class="btn sec sm">✓ Qo'lda tasdiqlash</button></form>` : ""}</td></tr>`;
        }).join("") || `<tr><td colspan="6" class="hint">To'lov yo'q</td></tr>`}</tbody>
      </table></div>
      <p class="hint">Payme orqali to'lov avtomatik tasdiqlanadi. "Qo'lda tasdiqlash" — pul boshqa yo'l bilan (naqd, o'tkazma) kelganda yoki Payme javobi yetib kelmaganda.</p>
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("To'lovlar", body, { active: "payments", flash, flashKind: kind }));
});

adminRouter.post("/admin/payments/:id/confirm", async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order || order.status === "paid") return go(res, "/admin/payments", "err", "Buyurtma topilmadi yoki allaqachon to'langan");
  const user = await findUserById(order.userId);
  if (!user) return go(res, "/admin/payments", "err", "Biznes topilmadi");
  await updateOrder(order.id, { status: "paid" });
  if (String(order.plan || "").startsWith(CREDIT_ORDER_PREFIX)) {
    const pack = CREDIT_PACKS[order.plan.slice(CREDIT_ORDER_PREFIX.length)];
    if (pack) addCredits(user, pack.credits);
  } else activate(user, order.days, order.plan);
  await audit(req, "payment_confirm", user.email, `${order.id} · ${order.amount}`);
  go(res, "/admin/payments", "ok", "To'lov tasdiqlandi va faollashtirildi");
});

// ================= Tariflar va kreditlar =================

adminRouter.get("/admin/plans", async (req, res) => {
  const plans = await getPlans();
  const packs = await getCreditPacks();
  const ps = platformSettings();
  const body = `
    <form method="post" action="/admin/plans" class="card">
      <h2>💵 Oylik tarif narxlari</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        ${Object.values(plans).map((p) => `<div><label>${esc(p.name)} <span class="hint">(standart ${esc(money(p.defaultPrice))})</span></label><input type="number" min="0" step="1000" name="price_${p.id}" value="${p.price}"></div>`).join("")}
      </div>
      <h2 style="margin-top:10px">🧠 AI kredit paketlari</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        ${packs.map((p) => `<div><label>+${p.credits} kredit</label><input type="number" min="0" step="1000" name="credits_${p.id}" value="${p.price}"></div>`).join("")}
      </div>
      <h2 style="margin-top:10px">🆓 Bepul tarif</h2>
      <label style="display:flex; gap:8px; align-items:center; font-size:13.5px"><input type="checkbox" name="freePlan" ${ps.freePlan ? "checked" : ""} style="width:auto; margin:0"> Sinov/obuna tugagach bot bepul tarifda ishlashda davom etsin (${AI_QUOTA.free} AI javob/oy)</label>
      <div style="max-width:260px"><label>Bepul tarifda faol flow'lar soni</label><input type="number" min="0" max="50" name="freeFlowLimit" value="${ps.freeFlowLimit || 3}"></div>
      <div class="hint" style="margin-bottom:10px">Oylik AI kvotalari: ${Object.entries(AI_QUOTA).map(([k, v]) => `${k} — ${v}`).join(" · ")}</div>
      <button class="btn">💾 Saqlash</button>
    </form>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("Tariflar va kreditlar", body, { active: "plans", flash, flashKind: kind }));
});

adminRouter.post("/admin/plans", async (req, res) => {
  const prices = {};
  for (const id of Object.keys(PLAN_DEFS)) {
    const v = Number(req.body?.[`price_${id}`]);
    if (Number.isFinite(v) && v > 0) prices[id] = Math.round(v);
  }
  for (const id of Object.keys(CREDIT_PACKS)) {
    const v = Number(req.body?.[`credits_${id}`]);
    if (Number.isFinite(v) && v > 0) prices[`credits_${id}`] = Math.round(v);
  }
  await setPlanPrices(prices);
  await savePlatformSettings({ freePlan: req.body?.freePlan === "on", freeFlowLimit: Math.min(50, Math.max(0, Number.parseInt(req.body?.freeFlowLimit, 10) || 0)) });
  await audit(req, "plans_update", "", JSON.stringify(prices).slice(0, 280));
  go(res, "/admin/plans", "ok", "Narxlar va sozlamalar saqlandi");
});

// ================= AI va kalitlar =================

adminRouter.get("/admin/ai", async (req, res) => {
  const key = await getPlatformGeminiKey();
  const body = `
    <form method="post" action="/admin/ai" class="card">
      <h2>🔑 Platforma Gemini kaliti</h2>
      <p class="hint" style="margin-top:0">Barcha bizneslar uchun umumiy AI kaliti (biznesda alohida kalit bo'lmasa ishlatiladi). Joriy: <code>${key ? esc(`${key.slice(0, 8)}…${key.slice(-4)}`) : "o'rnatilmagan"}</code></p>
      <input name="geminiApiKey" autocomplete="off" placeholder="AIza… (yangi kalit)" style="font-family:monospace">
      <div class="row"><button class="btn">💾 Saqlash</button><button class="btn sec" formaction="/admin/ai/test">🧪 Kalitni tekshirish</button></div>
    </form>
    <div class="card"><h2>ℹ️ Holat</h2>
      <div class="kv">
        <div>Gemini</div><div>${key || process.env.GEMINI_API_KEY ? `<span class="pill ok">Sozlangan</span>` : `<span class="pill bad">Yo'q</span>`}</div>
        <div>Anthropic (zaxira)</div><div>${process.env.ANTHROPIC_API_KEY ? `<span class="pill ok">Sozlangan</span>` : `<span class="pill mute">Yo'q</span>`}</div>
        <div>Oylik kvotalar</div><div>${Object.entries(AI_QUOTA).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ")}</div>
      </div>
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("AI va kalitlar", body, { active: "ai", flash, flashKind: kind }));
});

adminRouter.post("/admin/ai", async (req, res) => {
  const key = String(req.body?.geminiApiKey || "").trim();
  if (!key) return go(res, "/admin/ai", "err", "Kalitni kiriting");
  if (!/^[\w-]{20,200}$/.test(key)) return go(res, "/admin/ai", "err", "Kalit formati noto'g'ri");
  await setPlatformGeminiKey(key);
  await audit(req, "gemini_key_update", `${key.slice(0, 6)}…`);
  go(res, "/admin/ai", "ok", "Kalit saqlandi");
});

adminRouter.post("/admin/ai/test", async (req, res) => {
  const key = String(req.body?.geminiApiKey || "").trim() || (await getPlatformGeminiKey()) || process.env.GEMINI_API_KEY || "";
  if (!key) return go(res, "/admin/ai", "err", "Kalit yo'q");
  try {
    const { askGemini } = await import("../ai.js");
    const out = await askGemini(key, "Reply with the single word OK.", [], "ping", [], { maxOutputTokens: 5, timeoutMs: 15000 });
    go(res, "/admin/ai", out ? "ok" : "err", out ? `Kalit ishlayapti ✅ (javob: ${String(out).slice(0, 20)})` : "Kalit javob bermadi");
  } catch (err) {
    go(res, "/admin/ai", "err", `Kalit ishlamadi: ${err.message}`);
  }
});

// ================= E'lonlar =================

adminRouter.get("/admin/announce", async (req, res) => {
  const a = platformSettings().announcement || {};
  const body = `
    <form method="post" action="/admin/announce" class="card">
      <h2>📣 Barcha biznes panellarida e'lon</h2>
      <p class="hint" style="margin-top:0">Yangilik, texnik ishlar yoki aksiya haqida — har bir biznes panelining yuqorisida ko'rinadi.</p>
      <label style="display:flex; gap:8px; align-items:center; font-size:13.5px"><input type="checkbox" name="enabled" ${a.enabled ? "checked" : ""} style="width:auto; margin:0"> E'lon ko'rsatilsin</label>
      <label>Matn</label><textarea name="text" rows="3" maxlength="500">${esc(a.text || "")}</textarea>
      <div class="row">
        <div class="grow"><label>Turi</label><select name="level"><option value="info" ${a.level === "info" ? "selected" : ""}>ℹ️ Ma'lumot</option><option value="warn" ${a.level === "warn" ? "selected" : ""}>⚠️ Ogohlantirish</option><option value="ok" ${a.level === "ok" ? "selected" : ""}>🎉 Yangilik / aksiya</option></select></div>
        <div class="grow"><label>Havola (ixtiyoriy)</label><input name="link" value="${esc(a.link || "")}" placeholder="/billing yoki https://..."></div>
        <div class="grow"><label>Qachongacha (ixtiyoriy)</label><input type="date" name="until" value="${esc(a.until || "")}"></div>
      </div>
      <button class="btn">💾 Saqlash</button>
    </form>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("E'lonlar", body, { active: "announce", flash, flashKind: kind }));
});

adminRouter.post("/admin/announce", async (req, res) => {
  const link = String(req.body?.link || "").trim();
  const announcement = {
    enabled: req.body?.enabled === "on",
    text: String(req.body?.text || "").trim().slice(0, 500),
    level: ["info", "warn", "ok"].includes(req.body?.level) ? req.body.level : "info",
    link: /^(\/[\w\-/?=&#]*|https:\/\/\S+)$/.test(link) ? link : "",
    until: /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.until || "")) ? req.body.until : "",
  };
  await savePlatformSettings({ announcement });
  await audit(req, "announcement", announcement.enabled ? "on" : "off", announcement.text.slice(0, 120));
  go(res, "/admin/announce", "ok", "E'lon saqlandi");
});

// ================= AI xarajati =================
registerAiCostRoutes(adminRouter);

// ================= Sayt va murojaatlar =================

adminRouter.get("/admin/site", async (req, res) => {
  const c = siteSettings();
  const msgs = await contactMessages();
  const unread = msgs.filter((m) => !m.read).length;
  const body = `
    <div class="grid two">
      <form method="post" action="/admin/site" class="card" style="margin:0">
        <h2>🌐 Publik sayt</h2>
        <p class="hint" style="margin-top:0">Saytdagi aloqa ma'lumotlari, huquqiy sahifalar va footer shu yerdan olinadi.</p>
        <label>Email</label><input name="email" type="email" value="${esc(c.email)}" placeholder="info@obunext.uz">
        <div class="row">
          <div class="grow"><label>Telegram (username)</label><input name="telegram" value="${esc(c.telegram)}" placeholder="obunext"></div>
          <div class="grow"><label>Telefon</label><input name="phone" value="${esc(c.phone)}" placeholder="+998 ..."></div>
        </div>
        <h3 style="margin:18px 0 6px">⭐ Ishonch qatori (bosh sahifa)</h3>
        <label style="display:flex; gap:8px; align-items:center; font-size:13.5px"><input type="checkbox" name="showBusinessCount" ${c.showBusinessCount ? "checked" : ""} style="width:auto; margin:0"> Haqiqiy bizneslar sonini ko'rsatish</label>
        <div class="row">
          <div class="grow"><label>Kamida nechta bo'lsa ko'rsatilsin</label><input name="minBusinessCount" type="number" min="1" value="${esc(c.minBusinessCount)}"></div>
          <div class="grow"><label>Reyting (ixtiyoriy, 1–5)</label><input name="rating" value="${esc(c.rating)}" placeholder="bo'sh — ko'rsatilmaydi"></div>
        </div>
        <label>O'z matningiz (ixtiyoriy — son o'rniga)</label><input name="trustText" value="${esc(c.trustText)}" maxlength="120" placeholder="masalan: Toshkentdagi 40 dan ortiq do'kon ishonadi">
        <p class="hint">Reyting va raqamlarni faqat haqiqiy manba bo'lsa kiriting — o'ylab topilgan ko'rsatkichlar iste'molchilarni chalg'itadi va reklama qonunchiligini buzadi.</p>
        <h3 style="margin:18px 0 6px">💬 Mijozlar fikri</h3>
        <label>Har qatorda bitta: <code>fikr | ism | kasbi/biznesi</code> (bo'sh — bo'lim ko'rsatilmaydi)</label>
        <textarea name="testimonials" rows="5" maxlength="6000" placeholder="Endi Direct'ga kechasi ham javob beriladi | Dilnoza | Kiyim do'koni">${esc(c.testimonials.map((t) => [t.quote, t.name, t.role].join(" | ")).join("\n"))}</textarea>
        <p class="hint">Faqat mijoz ruxsati bilan olingan haqiqiy fikrlar.</p>
        <button class="btn">💾 Saqlash</button>
      </form>
      <div class="card" style="margin:0"><h2>📩 Saytdan murojaatlar ${unread ? `<span class="pill warn">${unread} yangi</span>` : ""}</h2>
        ${msgs.length ? msgs.slice(0, 100).map((m) => `<div style="border-top:1px solid var(--line); padding:10px 0; ${m.read ? "opacity:.65" : ""}">
            <div class="row" style="justify-content:space-between; margin:0"><b>${esc(m.name || "—")}</b><span class="hint">${esc(fmtDate(m.at))}</span></div>
            <div class="hint">${[m.email && `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>`, m.phone && `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>`, m.lang && esc(m.lang.toUpperCase())].filter(Boolean).join(" · ")}</div>
            <div style="white-space:pre-wrap; margin:6px 0">${esc(m.message)}</div>
            <form method="post" action="/admin/site/messages/${esc(m.id)}" class="row" style="margin:0; gap:6px">
              ${m.read ? "" : `<button class="btn sec sm" name="action" value="read">✓ O'qildi</button>`}
              <button class="btn danger sm" name="action" value="delete" onclick="return confirm('O\'chirilsinmi?')">O'chirish</button>
            </form>
          </div>`).join("") : `<p class="hint">Hali murojaat yo'q. Sayt → "Bog'lanish" formasi orqali keladi${process.env.ADMIN_TELEGRAM_CHAT_ID ? " (Telegram'ga ham yuboriladi)" : ". Telegram'da ham olish uchun .env'da ADMIN_TELEGRAM_CHAT_ID ni kiriting"}.</p>`}
      </div>
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("Sayt va murojaatlar", body, { active: "site", flash, flashKind: kind }));
});

adminRouter.post("/admin/site", async (req, res) => {
  const r = await saveSiteSettings(req.body || {});
  if (!r.ok) return go(res, "/admin/site", "err", r.error);
  await audit(req, "site_settings", "", `email=${req.body?.email || ""} tg=${req.body?.telegram || ""}`);
  go(res, "/admin/site", "ok", "Sayt sozlamalari saqlandi");
});

adminRouter.post("/admin/site/messages/:id", async (req, res) => {
  const id = String(req.params.id);
  const action = req.body?.action;
  await updateContactMessages((list) => (action === "delete" ? list.filter((m) => m.id !== id) : list.map((m) => (m.id === id ? { ...m, read: true } : m))));
  go(res, "/admin/site", "ok", action === "delete" ? "O'chirildi" : "Belgilandi");
});

// ================= Audit =================

const ACTION_LABELS = {
  login: "Kirish", login_failed: "❌ Muvaffaqiyatsiz kirish", subscription_extend: "Obuna uzaytirildi", subscription_until: "Obuna sanasi",
  subscription_cancel: "Obuna bekor", plan_change: "Tarif o'zgardi", credits: "Kredit", block: "Bloklandi", unblock: "Blokdan chiqarildi",
  impersonate: "Kabinetga kirildi", reset_password: "Parol tiklandi", logout_all: "Sessiyalar yopildi", tokens_update: "Tokenlar",
  delete_business: "Biznes o'chirildi", payment_confirm: "To'lov tasdiqlandi", plans_update: "Narxlar", gemini_key_update: "AI kaliti",
  announcement: "E'lon", export_csv: "CSV eksport", password_change: "Admin paroli",
};

adminRouter.get("/admin/audit", async (req, res) => {
  const log = await auditLog();
  const body = `<div class="card"><h2>🧾 Admin amallari <span class="pill mute">${log.length}</span></h2>
    <div class="tw"><table><thead><tr><th>Vaqt</th><th>Amal</th><th>Obyekt</th><th>Tafsilot</th><th>IP</th></tr></thead>
    <tbody>${log.map((l) => `<tr><td class="hint">${esc(fmtDate(l.at))}</td><td>${esc(ACTION_LABELS[l.action] || l.action)}</td><td>${esc(l.target)}</td><td class="hint">${esc(l.details)}</td><td class="hint">${esc(l.ip)}</td></tr>`).join("") || `<tr><td colspan="5" class="hint">Bo'sh</td></tr>`}</tbody></table></div></div>`;
  res.send(adminPage("Audit jurnali", body, { active: "audit" }));
});

// ================= Tizim =================

adminRouter.get("/admin/system", async (req, res) => {
  const users = await listUsers();
  const mem = process.memoryUsage();
  const up = process.uptime();
  const check = (ok, label, hint = "") => `<div>${label}</div><div>${ok ? `<span class="pill ok">✓ Tayyor</span>` : `<span class="pill warn">Sozlanmagan</span>`} ${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  const body = `
    <div class="grid half">
      <div class="card"><h2>🖥️ Server</h2><div class="kv">
        <div>Ishlash vaqti</div><div>${Math.floor(up / 86400)} kun ${Math.floor((up % 86400) / 3600)} soat ${Math.floor((up % 3600) / 60)} daq</div>
        <div>Node.js</div><div>${esc(process.version)}</div>
        <div>Xotira (RSS)</div><div>${Math.round(mem.rss / 1048576)} MB · heap ${Math.round(mem.heapUsed / 1048576)} / ${Math.round(mem.heapTotal / 1048576)} MB</div>
        <div>Ma'lumotlar bazasi</div><div>${isPgReady() ? `<span class="pill ok">PostgreSQL</span>` : dbStatus().fallback ? `<span class="pill bad">JSON fayl (PostgreSQL ulanmadi!)</span> <span class="hint">${esc(dbStatus().error)}</span>` : `<span class="pill warn">JSON fayl</span>`}</div>
        <div>Bizneslar</div><div>${users.length}</div>
        <div>Server vaqti</div><div>${esc(fmtDate(Date.now()))} (Toshkent)</div>
      </div></div>
      <div class="card"><h2>⚙️ Sozlamalar</h2><div class="kv">
        ${check(config.baseUrl, "BASE_URL", esc(config.baseUrl || "havola kuzatuvi va media uchun kerak"))}
        ${check(config.appSecret, "APP_SECRET", "webhook imzosi")}
        ${check(config.verifyToken, "VERIFY_TOKEN", "Meta webhook")}
        ${check(paymeReady, "Payme")}
        ${check(process.env.TELEGRAM_BOT_TOKEN, "Telegram bildirishnoma bot")}
        ${check((await getPlatformGeminiKey()) || process.env.GEMINI_API_KEY, "Gemini AI")}
        ${check(config.googleClientId, "Google orqali kirish")}
        ${check(process.env.FREE_MODE !== "true", "Pullik rejim", process.env.FREE_MODE === "true" ? "FREE_MODE=true — hamma bepul" : "")}
      </div></div>
    </div>
    <div class="card"><h2>🔗 Meta webhook</h2>
      <div class="kv"><div>Callback URL</div><div><code>${esc((config.baseUrl || "https://obunext.uz") + "/webhook")}</code></div><div>Verify token</div><div><code>${config.verifyToken ? "••••" + esc(String(config.verifyToken).slice(-4)) : "—"}</code></div></div>
    </div>`;
  res.send(adminPage("Tizim holati", body, { active: "system" }));
});

// ================= Xavfsizlik =================

adminRouter.get("/admin/security", async (req, res) => {
  const def = await usingDefaultPassword();
  const body = `
    ${def ? `<div class="flash warn">Dastlabki parol ishlatilmoqda. Xavfsizlik uchun uni hozir almashtiring.</div>` : ""}
    <form method="post" action="/admin/security" class="card" style="max-width:520px" autocomplete="off">
      <h2>🔐 Admin login va parol</h2>
      <label>Login (telefon raqam)</label><input name="login" value="+${esc(await adminLogin())}" inputmode="tel">
      <label>Joriy parol</label><input type="password" name="current" autocomplete="current-password" required>
      <label>Yangi parol</label><input type="password" name="next" autocomplete="new-password" required minlength="10">
      <label>Yangi parol (takror)</label><input type="password" name="next2" autocomplete="new-password" required minlength="10">
      <p class="hint">Kamida 10 belgi, harf va raqam. O'zgartirgach barcha admin sessiyalari yopiladi va qayta kirasiz.</p>
      <button class="btn">Saqlash</button>
    </form>
    <div class="card" style="max-width:520px"><h2>🛡️ Himoya</h2>
      <ul class="hint" style="margin:0; padding-left:18px; line-height:1.9">
        <li>5 ta noto'g'ri urinishdan so'ng IP 15 daqiqaga bloklanadi</li>
        <li>Sessiya 12 soat amal qiladi, cookie faqat /admin uchun (HttpOnly, SameSite=Strict)</li>
        <li>Parol faqat shifrlangan (scrypt) ko'rinishda saqlanadi</li>
        <li>Barcha amallar <a href="/admin/audit">audit jurnalida</a></li>
      </ul>
    </div>`;
  const [flash, kind] = flashOf(req);
  res.send(adminPage("Xavfsizlik", body, { active: "security", flash, flashKind: kind }));
});

adminRouter.post("/admin/security", async (req, res) => {
  if (String(req.body?.next || "") !== String(req.body?.next2 || "")) return go(res, "/admin/security", "err", "Yangi parollar mos emas");
  const r = await changeAdminPassword(req.body?.current, req.body?.next, req.body?.login);
  if (!r.ok) return go(res, "/admin/security", "err", r.error);
  await audit(req, "password_change", await adminLogin());
  res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
  res.redirect("/admin/login");
});
