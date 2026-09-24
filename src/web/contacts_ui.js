/**
 * Kontaktlar CRM (/clients) va mijoz kartochkasi (/clients/c/:key).
 *  - Filtrlar: kanal, teg, suhbat oynasi (ochiq/yopiq), qidiruv (ism, username, telefon, teg)
 *  - Tanlanganlarga ommaviy teg qo'shish/olib tashlash
 *  - Kartochka: 24 soatlik oyna holati, teglar, o'zgaruvchilar, eslatma, ballar,
 *    arizalar, faol flow, flow'ni qo'lda ishga tushirish, so'nggi xabarlar
 */
import { ensureSequences, subscriptionsOf, subscribe, unsubscribe } from "../sequences.js";
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { brandIcon } from "./icons.js";
import { persist } from "../db.js";
import { allContacts } from "../broadcasts.js";
import { getContactMeta, addTags, removeTag, setFields, displayName, allTags, windowStatus, lastInboundAt, normTag } from "../contacts.js";
import { ensureFlows, startFlow, activeFlowSession, findFlow } from "../flows.js";
import { splitKey } from "../outbound.js";
import * as game from "../gamification.js";
import { aiAllowed } from "../aiControl.js";
import { deleteHistory } from "../chatStore.js";

export const contactsRouter = Router();

const PAGE_SIZE = 50;
const CHAN = {
  ig: ["instagram", "Instagram"],
  tg: ["telegram", "Telegram"],
  wa: ["whatsapp", "WhatsApp"],
  fb: ["facebook", "Messenger"],
};

function lastActivity(tenant, key) {
  const msgs = tenant.chats?.[key] || [];
  const last = msgs[msgs.length - 1];
  return Math.max(Date.parse(last?.at || 0) || 0, lastInboundAt(tenant, key));
}

/** Kontaktlar ro'yxati (sahifa va CSV uchun umumiy). */
export function buildContacts(tenant, { channel = "all", tag = "", window = "", q = "" } = {}) {
  const needle = String(q || "").toLowerCase().trim();
  const wantTag = normTag(tag);
  const now = Date.now();
  return allContacts(tenant)
    .map((key) => {
      const meta = getContactMeta(tenant, key);
      const { chan, id } = splitKey(key);
      const profile = tenant.contactProfiles?.[id] || {};
      const msgs = tenant.chats?.[key] || [];
      return {
        key,
        chan,
        id,
        name: displayName(tenant, key),
        username: profile.username || "",
        pic: profile.profilePic || "",
        tags: meta.tags,
        fields: meta.fields,
        note: meta.note || "",
        lastText: msgs[msgs.length - 1]?.text || "",
        lastAt: lastActivity(tenant, key),
        win: windowStatus(tenant, key, now),
      };
    })
    .filter((c) => channel === "all" || c.chan === channel)
    .filter((c) => !wantTag || c.tags.includes(wantTag))
    .filter((c) => !window || (window === "open" ? c.win.open : !c.win.open))
    .filter((c) => {
      if (!needle) return true;
      const hay = [c.name, c.username, c.id, c.fields.phone, c.fields.email, ...c.tags].join(" ").toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}

function winBadge(win) {
  return win.open
    ? `<span title="${esc(win.label)}" style="color:#34d399; font-weight:700; font-size:12px; white-space:nowrap">✅ ${esc(win.msLeft === Infinity ? "ochiq" : win.label)}</span>`
    : `<span title="${esc(win.label)}" style="color:#f87171; font-weight:700; font-size:12px; white-space:nowrap">❌ ${esc(win.label)}</span>`;
}

const tagChip = (t) => `<span style="display:inline-block; background:rgba(251,191,36,0.12); color:#fbbf24; border:1px solid rgba(251,191,36,0.3); border-radius:6px; padding:1px 7px; font-size:11.5px; margin:1px">#${esc(t)}</span>`;

function avatar(pic, name, size = 36) {
  const initial = String(name || "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return pic
    ? `<img src="${esc(pic)}" alt="" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; flex:none" referrerpolicy="no-referrer">`
    : `<span style="width:${size}px; height:${size}px; border-radius:50%; background:var(--grad-primary); display:inline-grid; place-items:center; color:#fff; font-weight:800; flex:none">${esc(initial)}</span>`;
}

const cardUrl = (key) => `/clients/c/${encodeURIComponent(key)}`;

contactsRouter.get(["/clients", "/contacts"], requireAuth, (req, res) => {
  const u = req.user;
  const filters = {
    channel: CHAN[req.query.channel] ? req.query.channel : "all",
    tag: String(req.query.tag || ""),
    window: ["open", "closed"].includes(req.query.window) ? req.query.window : "",
    q: String(req.query.q || "").slice(0, 100),
  };
  const all = buildContacts(u, filters);
  const pageNo = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const list = all.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  const tags = allTags(u);
  const qs = (patch) => new URLSearchParams(Object.fromEntries(Object.entries({ ...filters, ...patch }).filter(([, v]) => v && v !== "all"))).toString();
  const total = allContacts(u).length;
  const openCount = all.filter((c) => c.win.open).length;

  const rows = list
    .map((c) => `<tr>
      <td style="width:30px"><input type="checkbox" name="keys" value="${esc(c.key)}" form="bulkForm" style="width:auto; margin:0"></td>
      <td>
        <a href="${cardUrl(c.key)}" style="display:flex; gap:10px; align-items:center; color:#fff">
          ${avatar(c.pic, c.name)}
          <span style="min-width:0">
            <b style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px">${esc(c.name)}</b>
            <span class="hint" style="font-size:11.5px; display:inline-flex; gap:4px; align-items:center">${brandIcon(CHAN[c.chan][0], { size: 13 })} ${esc(CHAN[c.chan][1])}${c.fields.phone ? ` · ${esc(c.fields.phone)}` : ""}</span>
          </span>
        </a>
      </td>
      <td>${c.tags.slice(0, 4).map(tagChip).join("")}${c.tags.length > 4 ? `<span class="hint"> +${c.tags.length - 4}</span>` : ""}</td>
      <td>${winBadge(c.win)}</td>
      <td class="hint" style="font-size:12.5px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(c.lastText)}</td>
      <td class="hint" style="font-size:12px; white-space:nowrap">${c.lastAt ? esc(new Date(c.lastAt).toLocaleString("ru-RU", { timeZone: u.settings?.timezone || "Asia/Tashkent", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })) : "—"}</td>
      <td><a class="btn secondary" href="/inbox?chat=${encodeURIComponent(c.key)}" style="margin:0; padding:4px 10px; font-size:12px">💬</a></td>
    </tr>`)
    .join("");

  res.send(
    page(
      "Kontaktlar CRM",
      `
      ${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:14px">
        <div class="card" style="margin:0"><div class="hint">Jami kontaktlar</div><b style="font-size:24px">${total}</b></div>
        <div class="card" style="margin:0"><div class="hint">Filtr bo'yicha</div><b style="font-size:24px">${all.length}</b></div>
        <div class="card" style="margin:0"><div class="hint">Oynasi ochiq</div><b style="font-size:24px; color:#34d399">${openCount}</b></div>
        <div class="card" style="margin:0"><div class="hint">Teglar</div><b style="font-size:24px">${tags.length}</b></div>
      </div>
      <form method="get" action="/clients" class="card" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:12px 14px">
        <input name="q" value="${esc(filters.q)}" placeholder="🔍 Ism, username, telefon, teg" style="margin:0; flex:2; min-width:200px">
        <select name="channel" style="margin:0; flex:1; min-width:130px">
          <option value="all">Barcha kanallar</option>
          ${Object.entries(CHAN).map(([k, [, l]]) => `<option value="${k}" ${filters.channel === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <select name="tag" style="margin:0; flex:1; min-width:130px">
          <option value="">Barcha teglar</option>
          ${tags.map(([t, n]) => `<option value="${esc(t)}" ${normTag(filters.tag) === t ? "selected" : ""}>#${esc(t)} (${n})</option>`).join("")}
        </select>
        <select name="window" style="margin:0; flex:1; min-width:130px">
          <option value="">Istalgan oyna</option>
          <option value="open" ${filters.window === "open" ? "selected" : ""}>✅ Oyna ochiq</option>
          <option value="closed" ${filters.window === "closed" ? "selected" : ""}>❌ Oyna yopiq</option>
        </select>
        <button class="btn" style="margin:0">Filtrlash</button>
        <a class="btn secondary" href="/clients/export.csv?${qs({})}" style="margin:0">⬇️ CSV</a>
      </form>

      <form method="post" action="/clients/bulk-tags" id="bulkForm" class="card" style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:10px 14px">
        <input type="hidden" name="back" value="/clients?${esc(qs({ page: String(pageNo) }))}">
        <label style="display:flex; gap:6px; align-items:center; margin:0; text-transform:none; letter-spacing:0; font-size:13px; cursor:pointer">
          <input type="checkbox" id="checkAll" style="width:auto; margin:0"> Hammasini tanlash
        </label>
        <input name="tag" list="allTags" required placeholder="teg" style="margin:0; width:160px">
        <datalist id="allTags">${tags.map(([t]) => `<option value="${esc(t)}">`).join("")}</datalist>
        <button name="op" value="add" class="secondary" style="margin:0">🏷️ Teg qo'shish</button>
        <button name="op" value="remove" class="secondary" style="margin:0">✕ Tegni olish</button>
        <span class="hint" style="font-size:12px">Tanlangan kontaktlarga</span>
      </form>

      <div class="card" style="overflow-x:auto; padding:0">
        <table style="width:100%; border-collapse:collapse; font-size:13.5px">
          <thead><tr style="text-align:left; color:var(--text-muted); font-size:11.5px"><th style="padding:10px 12px"></th><th>Kontakt</th><th>Teglar</th><th>Suhbat oynasi</th><th>Oxirgi xabar</th><th>Faollik</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="hint" style="text-align:center; padding:30px">Kontakt topilmadi</td></tr>`}</tbody>
        </table>
      </div>
      ${pages > 1 ? `<div style="display:flex; gap:6px; justify-content:center">${Array.from({ length: Math.min(pages, 20) }, (_, i) => i + 1).map((n) => `<a class="btn ${n === pageNo ? "" : "secondary"}" href="/clients?${qs({ page: String(n) })}" style="margin:0; padding:5px 11px">${n}</a>`).join("")}</div>` : ""}
      <style>table td, table th { padding:9px 12px; border-top:1px solid rgba(255,255,255,0.05) }</style>
      <script>
        document.getElementById("checkAll").addEventListener("change", function (e) {
          document.querySelectorAll('input[name="keys"]').forEach(function (c) { c.checked = e.target.checked; });
        });
      </script>`,
      { user: u, active: "contacts" }
    )
  );
});

const safeBack = (b, fallback) => (typeof b === "string" && /^\/(clients|inbox)(\/|\?|$)/.test(b) ? b : fallback);

contactsRouter.post("/clients/bulk-tags", requireAuth, (req, res) => {
  const u = req.user;
  const keys = [].concat(req.body?.keys || []).map(String);
  const valid = new Set(allContacts(u));
  const tag = normTag(req.body?.tag);
  if (tag) {
    for (const key of keys) {
      if (!valid.has(key)) continue;
      if (req.body?.op === "remove") removeTag(u, key, tag);
      else addTags(u, key, [tag]);
    }
    persist(u);
  }
  res.redirect(safeBack(req.body?.back, "/clients"));
});

contactsRouter.get(["/clients/export.csv", "/contacts/export.csv"], requireAuth, (req, res) => {
  const list = buildContacts(req.user, { channel: req.query.channel || "all", tag: req.query.tag, window: req.query.window, q: req.query.q });
  const fieldCols = [...new Set(list.flatMap((c) => Object.keys(c.fields)))].slice(0, 30);
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excel formula injection himoyasi
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [["Ism", "Kanal", "ID", "Username", "Teglar", "Oyna", "Oxirgi faollik", ...fieldCols, "Eslatma"].map(cell).join(",")];
  for (const c of list) {
    rows.push([c.name, CHAN[c.chan][1], c.id, c.username, c.tags.join(" "), c.win.open ? "ochiq" : "yopiq", c.lastAt ? new Date(c.lastAt).toISOString() : "", ...fieldCols.map((f) => c.fields[f] ?? ""), c.note].map(cell).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kontaktlar-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + rows.join("\r\n"));
});

// ==== Mijoz kartochkasi ====

function findContact(u, rawKey) {
  const key = String(rawKey || "");
  return allContacts(u).includes(key) ? key : null;
}

contactsRouter.get("/clients/c/:key", requireAuth, (req, res) => {
  const u = req.user;
  const key = findContact(u, req.params.key);
  if (!key) return res.redirect("/clients");
  const { chan, id } = splitKey(key);
  const meta = getContactMeta(u, key);
  const profile = u.contactProfiles?.[id] || {};
  const name = displayName(u, key);
  const win = windowStatus(u, key);
  const msgs = (u.chats?.[key] || []).slice(-12);
  const flows = ensureFlows(u).list;
  const session = activeFlowSession(u, key);
  const sessionFlow = session ? findFlow(u, session.flowId) : null;
  const participant = u.gamification?.participants?.[key];
  const subs = (u.forms?.submissions || []).filter((s) => s.key === key).slice(0, 10);
  const manual = u.manualChats?.[key] && u.manualChats[key] > Date.now();

  const fieldRows = Object.entries(meta.fields)
    .map(([k, v]) => `<tr>
      <td style="color:#c4b5fd; font-family:monospace">{${esc(k)}}</td>
      <td>
        <form method="post" action="${cardUrl(key)}/field" style="display:flex; gap:6px; margin:0">
          <input type="hidden" name="name" value="${esc(k)}">
          <input name="value" value="${esc(v)}" style="margin:0">
          <button class="secondary" style="margin:0; padding:4px 10px">💾</button>
          <button name="delete" value="1" class="secondary" style="margin:0; padding:4px 10px; color:#f87171">✕</button>
        </form>
      </td>
    </tr>`)
    .join("");

  res.send(
    page(
      name,
      `
      <p><a href="/clients">← Kontaktlar</a></p>
      ${req.query.saved ? `<div class="ok">Saqlandi ✅</div>` : ""}
      ${req.query.error ? `<div class="error">${esc(req.query.error)}</div>` : ""}
      <div class="grid split-form">
        <div>
          <div class="card" style="display:flex; gap:16px; align-items:center; flex-wrap:wrap">
            ${avatar(profile.profilePic, name, 64)}
            <div style="flex:1; min-width:200px">
              <h2 style="margin:0">${esc(name)}</h2>
              <div class="hint" style="display:flex; gap:6px; align-items:center; font-size:13px">
                ${brandIcon(CHAN[chan][0], { size: 15 })} ${esc(CHAN[chan][1])} · ID ${esc(id)}
                ${profile.username && chan === "ig" ? ` · <a href="https://instagram.com/${esc(profile.username)}" target="_blank" rel="noopener">@${esc(profile.username)} ↗</a>` : ""}
              </div>
              <div style="margin-top:6px">${winBadge(win)} ${manual ? `<span style="color:#f87171; font-weight:700; font-size:12px">· 👤 Operator rejimi</span>` : ""} ${meta.optOut ? `<span style="color:#fbbf24; font-weight:700; font-size:12px">· 🚫 Ommaviy xabarlardan chiqqan</span>` : ""}</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <form method="post" action="${cardUrl(key)}/ai" style="margin:0">
                <input type="hidden" name="on" value="${meta.aiOff ? "1" : "0"}">
                <button class="secondary" style="margin:0; ${meta.aiOff ? "color:#f87171" : "color:#34d399"}">${meta.aiOff ? "🧠 AI shu chatda o'chiq — yoqish" : "🧠 AI yoqilgan — o'chirish"}</button>
              </form>
              <form method="post" action="${cardUrl(key)}/optout" style="margin:0">
                <input type="hidden" name="out" value="${meta.optOut ? "0" : "1"}">
                <button class="secondary" style="margin:0" title="Ommaviy xabarlar va ketma-ketliklar">${meta.optOut ? "📣 Ommaviy xabarlarga qaytarish" : "🚫 Ommaviy xabarlardan chiqarish"}</button>
              </form>
              <a class="btn" href="/inbox?chat=${encodeURIComponent(key)}" style="margin:0">💬 Suhbatni ochish</a>
            </div>
          </div>

          <div class="card">
            <h3 style="margin-top:0">📅 Ketma-ketliklar</h3>
            ${subscriptionsOf(u, key).map((x) => `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border); font-size:13.5px">
                <span><b>${esc(x.seq.name)}</b> <span class="hint">· ${x.step + 1}/${x.seq.steps.length}-qadam · ${esc(new Date(x.nextAt).toLocaleString("uz-UZ", { timeZone: u.settings?.timezone || "Asia/Tashkent" }).slice(0, 17))}</span></span>
                <form method="post" action="${cardUrl(key)}/sequence" style="margin:0"><input type="hidden" name="remove" value="${esc(x.seq.id)}"><button class="secondary" style="margin:0; padding:3px 10px; font-size:12px; color:#f87171">Chiqarish</button></form>
              </div>`).join("") || `<p class="hint" style="margin:0 0 8px">Hech qaysi ketma-ketlikda emas</p>`}
            ${ensureSequences(u).list.length ? `<form method="post" action="${cardUrl(key)}/sequence" style="display:flex; gap:8px; margin:10px 0 0">
              <select name="add" style="margin:0">${ensureSequences(u).list.map((q) => `<option value="${esc(q.id)}">${esc(q.name)}${q.enabled ? "" : " (o'chiq)"}</option>`).join("")}</select>
              <button class="secondary" style="margin:0; white-space:nowrap">+ Qo'shish</button>
            </form>` : `<a href="/sequences" class="hint">Ketma-ketlik yaratish →</a>`}
          </div>

          <div class="card">
            <h3 style="margin-top:0">🏷️ Teglar</h3>
            <div style="display:flex; gap:6px; flex-wrap:wrap">
              ${meta.tags.map((t) => `<form method="post" action="${cardUrl(key)}/tags" style="margin:0"><input type="hidden" name="remove" value="${esc(t)}"><button class="secondary" style="margin:0; padding:3px 10px; font-size:12.5px">#${esc(t)} ✕</button></form>`).join("") || `<span class="hint">Teg yo'q</span>`}
            </div>
            <form method="post" action="${cardUrl(key)}/tags" style="display:flex; gap:6px; margin:10px 0 0">
              <input name="add" list="allTags" placeholder="yangi teg (vergul bilan bir nechta)" required style="margin:0">
              <datalist id="allTags">${allTags(u).map(([t]) => `<option value="${esc(t)}">`).join("")}</datalist>
              <button class="btn" style="margin:0">Qo'shish</button>
            </form>
          </div>

          <div class="card">
            <h3 style="margin-top:0">🔤 O'zgaruvchilar (maydonlar)</h3>
            <p class="hint" style="margin-top:0; font-size:12.5px">Flow "savol" bloklari va formalar yig'gan ma'lumotlar. Xabarlarda {nom} ko'rinishida ishlatiladi.</p>
            <table style="width:100%; border-collapse:collapse; font-size:13.5px">${fieldRows || `<tr><td class="hint">Hali maydon yo'q</td></tr>`}</table>
            <form method="post" action="${cardUrl(key)}/field" style="display:flex; gap:6px; margin:10px 0 0; flex-wrap:wrap">
              <input name="name" placeholder="nom (masalan: shahar)" required pattern="[A-Za-z0-9_]{1,40}" style="margin:0; flex:1; min-width:140px">
              <input name="value" placeholder="qiymat" required style="margin:0; flex:2; min-width:160px">
              <button class="btn" style="margin:0">Qo'shish</button>
            </form>
          </div>

          <div class="card">
            <h3 style="margin-top:0">💬 So'nggi xabarlar</h3>
            ${msgs.length ? msgs.map((m) => `<div style="display:flex; justify-content:${m.role === "user" ? "flex-start" : "flex-end"}; margin:6px 0">
              <div style="max-width:80%; background:${m.role === "user" ? "#1e293b" : "rgba(124,58,237,0.25)"}; border-radius:10px; padding:7px 11px; font-size:13.5px; white-space:pre-wrap">${esc(m.text)}
                <div class="hint" style="font-size:10.5px; text-align:right">${esc(String(m.at || "").slice(5, 16).replace("T", " "))}</div></div>
            </div>`).join("") : `<p class="hint">Xabar yo'q</p>`}
          </div>
        </div>

        <div>
          <div class="card">
            <h3 style="margin-top:0">🧩 Flow'ni ishga tushirish</h3>
            ${sessionFlow ? `<p style="font-size:13px">Hozir: <b>${esc(sessionFlow.name)}</b> <span class="hint">(${session.wait === "input" ? "javob kutilmoqda" : "tugma kutilmoqda"})</span></p>` : ""}
            ${win.open
              ? `<form method="post" action="${cardUrl(key)}/run-flow" style="margin:0">
                  <select name="flowId" required style="margin:0">${flows.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}${f.enabled ? "" : " (o'chiq)"}</option>`).join("")}</select>
                  <button class="btn" style="width:100%; margin-top:8px" ${flows.length ? "" : "disabled"}>▶ Yuborish</button>
                </form>`
              : `<p class="hint" style="font-size:13px">Suhbat oynasi yopiq — Meta qoidasiga ko'ra mijoz qayta yozmaguncha xabar yuborib bo'lmaydi.</p>`}
          </div>

          <div class="card">
            <h3 style="margin-top:0">📝 Eslatma</h3>
            <form method="post" action="${cardUrl(key)}/note" style="margin:0">
              <textarea name="note" rows="4" maxlength="2000" placeholder="Faqat jamoa ko'radi">${esc(meta.note || "")}</textarea>
              <button class="btn" style="width:100%; margin-top:8px">💾 Saqlash</button>
            </form>
          </div>

          ${participant ? `<div class="card">
            <h3 style="margin-top:0">🏆 Geymifikatsiya</h3>
            <p style="margin:0">Ball: <b style="font-size:20px">${participant.points}</b> · Taklif qilgan: ${participant.referrals || 0}</p>
            <form method="post" action="${cardUrl(key)}/points" style="display:flex; gap:6px; margin:10px 0 0">
              <input type="number" name="delta" placeholder="±ball" required style="margin:0">
              <button class="secondary" style="margin:0">OK</button>
            </form>
          </div>` : ""}

          ${subs.length ? `<div class="card">
            <h3 style="margin-top:0">📥 Arizalar</h3>
            ${subs.map((s) => `<div style="border-top:1px solid var(--border); padding:8px 0; font-size:13px"><b>${esc(s.formName)}</b> <span class="hint">${esc(String(s.at).slice(0, 10))}</span>
              ${Object.entries(s.answers || {}).map(([k, v]) => `<div><span class="hint">${esc(k)}:</span> ${esc(v)}</div>`).join("")}</div>`).join("")}
          </div>` : ""}

          <div class="card">
            <h3 style="margin-top:0; color:#f87171">🗑️ Ma'lumotlarni o'chirish</h3>
            <p class="hint" style="font-size:12.5px; margin-top:0">Suhbat tarixi, teglar, maydonlar va ballar o'chiriladi (mijoz so'rovi bo'yicha).</p>
            <form method="post" action="${cardUrl(key)}/delete" onsubmit="return confirm('Kontakt ma\\'lumotlari butunlay o\\'chirilsinmi?')" style="margin:0">
              <button class="secondary" style="margin:0; color:#f87171">O'chirish</button>
            </form>
          </div>
        </div>
      </div>`,
      { user: u, active: "contacts" }
    )
  );
});

function withContact(handler) {
  return (req, res) => {
    const key = findContact(req.user, req.params.key);
    if (!key) return res.redirect("/clients");
    return handler(req, res, key);
  };
}

const back = (req, key, extra = "saved=1") => safeBack(req.body?.back, `${cardUrl(key)}?${extra}`);

contactsRouter.post("/clients/c/:key/sequence", requireAuth, withContact((req, res, key) => {
  if (req.body?.remove) unsubscribe(req.user, key, String(req.body.remove));
  if (req.body?.add) subscribe(req.user, key, String(req.body.add));
  res.redirect(cardUrl(key));
}));

contactsRouter.post("/clients/c/:key/optout", requireAuth, withContact(async (req, res, key) => {
  const { setOptOut } = await import("../optout.js");
  setOptOut(req.user, key, req.body?.out === "1");
  res.redirect(cardUrl(key));
}));

contactsRouter.post("/clients/c/:key/tags", requireAuth, withContact((req, res, key) => {
  if (req.body?.remove) removeTag(req.user, key, req.body.remove);
  if (req.body?.add) addTags(req.user, key, String(req.body.add).split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10));
  persist(req.user);
  res.redirect(back(req, key));
}));

contactsRouter.post("/clients/c/:key/field", requireAuth, withContact((req, res, key) => {
  const name = String(req.body?.name || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(name)) return res.redirect(`${cardUrl(key)}?error=${encodeURIComponent("Maydon nomi: lotin harflari, raqam va _")}`);
  const meta = getContactMeta(req.user, key);
  if (req.body?.delete) delete meta.fields[name];
  else setFields(req.user, key, { [name]: String(req.body?.value || "").slice(0, 300) });
  persist(req.user);
  res.redirect(back(req, key));
}));

contactsRouter.post("/clients/c/:key/note", requireAuth, withContact((req, res, key) => {
  const meta = getContactMeta(req.user, key);
  meta.note = String(req.body?.note || "").slice(0, 2000);
  meta.updatedAt = new Date().toISOString();
  persist(req.user);
  res.redirect(back(req, key));
}));

contactsRouter.post("/clients/c/:key/points", requireAuth, withContact((req, res, key) => {
  const delta = Math.trunc(Number(req.body?.delta) || 0);
  if (delta) game.adjustPoints(req.user, key, delta, "Kartochka orqali");
  res.redirect(back(req, key));
}));

contactsRouter.post("/clients/c/:key/run-flow", requireAuth, withContact(async (req, res, key) => {
  const flow = findFlow(req.user, String(req.body?.flowId || ""));
  if (!flow?.start) return res.redirect(`${cardUrl(key)}?error=${encodeURIComponent("Flow topilmadi yoki bo'sh")}`);
  if (!windowStatus(req.user, key).open) return res.redirect(`${cardUrl(key)}?error=${encodeURIComponent("Suhbat oynasi yopiq")}`);
  await startFlow(req.user, key, flow, {});
  res.redirect(`${cardUrl(key)}?saved=1`);
}));

contactsRouter.post("/clients/c/:key/delete", requireAuth, withContact((req, res, key) => {
  const u = req.user;
  const { id } = splitKey(key);
  delete u.chats?.[key];
  delete u.contactMeta?.[key];
  delete u.stats?.customers?.[key];
  delete u.gamification?.participants?.[key];
  delete u.flows?.sessions?.[key];
  delete u.manualChats?.[key];
  delete u.contactProfiles?.[id];
  u.leads = (u.leads || []).filter((l) => l.chatKey !== key && l.key !== key);
  u.followUps = (u.followUps || []).filter((j) => j.key !== key);
  persist(u);
  deleteHistory(u.id, key).catch((err) => console.error("[Arxiv] o'chirishda xato:", err.message));
  res.redirect("/clients?saved=1");
}));
