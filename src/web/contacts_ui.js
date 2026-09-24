/**
 * ADM AI style Kontaktlar (CRM / Clients) Module (/clients and /contacts)
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { brandIcon } from "./icons.js";

export const contactsRouter = Router();

/** Foydalanuvchining chats+leads ma'lumotlaridan birlashtirilgan kontaktlar ro'yxatini quradi (sahifa va CSV eksport ikkalasida ham ishlatiladi). */
function buildContactsList(user, { filterChan = "all", searchQ = "" } = {}) {
  user.chats ||= {};
  user.leads ||= [];

  const contactsMap = new Map();

  // MUHIM: user.leads massivida ikki xil obyekt shakli aralash turadi — engagement.js
  // har bir suhbat uchun {chatKey,...} yozadi, respond.js esa "hot lead" (telefon/email
  // qoldirgan) hodisalari uchun {key, contact,...} yozadi (reportsBot.js buni allaqachon
  // .contact maydoni orqali ajratadi). chatKey'siz yozuvni shu yerda ishlatish
  // `l.chatKey.split(...)` da TypeError bilan butun sahifani (va CSV eksportni) qulatardi
  // — tegishli suhbat baribir pastdagi user.chats siklida qamrab olinadi.
  user.leads.forEach((l) => {
    if (!l.chatKey) return;
    contactsMap.set(l.chatKey, {
      id: l.chatKey,
      chatKey: l.chatKey,
      name: l.name || l.chatKey.split(":")[1] || l.chatKey,
      account: l.chatKey.split(":")[1] || l.chatKey,
      channel: l.channel || "ig",
      createdAt: l.firstAt || l.lastAt || new Date().toISOString(),
      active: true,
      lastMsg: l.lastText || "",
    });
  });

  Object.entries(user.chats).forEach(([key, rawChat]) => {
    if (!contactsMap.has(key)) {
      const parts = key.split(":");
      const chan = parts.length >= 2 ? parts[0] : "ig";
      const acc = parts.length >= 2 ? parts.slice(1).join(":") : key;
      const msgs = Array.isArray(rawChat) ? rawChat : rawChat.messages || [];
      const firstMsg = msgs[0] || {};
      const lastMsg = msgs[msgs.length - 1] || {};

      contactsMap.set(key, {
        id: key,
        chatKey: key,
        name: acc,
        account: acc,
        channel: chan,
        createdAt: firstMsg.at || new Date().toISOString(),
        active: true,
        lastMsg: lastMsg.text || "",
      });
    }
  });

  let contacts = Array.from(contactsMap.values());
  contacts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (filterChan !== "all") {
    contacts = contacts.filter((c) => c.channel.toLowerCase() === filterChan.toLowerCase());
  }
  if (searchQ) {
    const q = searchQ.toLowerCase().trim();
    contacts = contacts.filter((c) => c.name.toLowerCase().includes(q) || c.account.toLowerCase().includes(q));
  }

  return { contacts, total: contactsMap.size };
}

/** CSV maydonini xavfsiz qamrab oladi (vergul/qo'shtirnoq/yangi qator bo'lsa). */
function csvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

contactsRouter.get(["/clients/export.csv", "/contacts/export.csv"], requireAuth, (req, res) => {
  const { contacts } = buildContactsList(req.user, {
    filterChan: req.query.channel || "all",
    searchQ: req.query.q || "",
  });

  const header = ["Ism", "Akkaunt", "Kanal", "Yaratilgan sana", "Oxirgi xabar"];
  const rows = contacts.map((c) => [c.name, c.account, c.channel, c.createdAt, c.lastMsg]);
  const csv = [header, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kontaktlar-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + csv); // BOM — Excel'da o'zbekcha harflar to'g'ri ko'rinishi uchun
});

contactsRouter.get(["/clients", "/contacts"], requireAuth, (req, res) => {
  const user = req.user;
  const filterChan = req.query.channel || "all";
  const searchQ = (req.query.q || "").toLowerCase().trim();

  const { contacts, total: totalContacts } = buildContactsList(user, { filterChan, searchQ });

  const rowsHtml = contacts.length
    ? contacts
        .map((c) => {
          const chanBadge =
            c.channel === "tg" || c.channel === "telegram"
              ? `<span style="display:inline-flex; align-items:center; gap:5px; color:#38bdf8; font-weight:600">${brandIcon("telegram", { size: 16 })} @${esc(c.account)}</span>`
              : c.channel === "wa" || c.channel === "whatsapp"
                ? `<span style="display:inline-flex; align-items:center; gap:5px; color:#4ade80; font-weight:600">${brandIcon("whatsapp", { size: 16 })} ${esc(c.account)}</span>`
                : c.channel === "fb" || c.channel === "facebook"
                  ? `<span style="display:inline-flex; align-items:center; gap:5px; color:#60a5fa; font-weight:600">${brandIcon("facebook", { size: 16 })} ${esc(c.account)}</span>`
                  : `<span style="display:inline-flex; align-items:center; gap:5px; color:#f472b6; font-weight:600">${brandIcon("instagram", { size: 16 })} @${esc(c.account)}</span>`;

          const initial = c.name.charAt(0).toUpperCase();

          return `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition:0.15s">
            <td style="padding:14px">
              <div style="display:flex; align-items:center; gap:12px">
                <div style="width:36px; height:36px; border-radius:50%; background:var(--grad-primary); display:grid; place-items:center; color:#fff; font-weight:800; font-size:14px">
                  ${esc(initial)}
                </div>
                <b>${esc(c.name)}</b>
              </div>
            </td>
            <td style="padding:14px">${chanBadge}</td>
            <td style="padding:14px; color:#94a3b8; font-size:13px">${new Date(c.createdAt).toLocaleString("uz")}</td>
            <td style="padding:14px; text-align:right">
              <a href="/inbox?chat=${encodeURIComponent(c.chatKey)}" class="btn secondary" style="padding:5px 12px; font-size:12px; margin:0">💬 Muloqot</a>
            </td>
          </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="4" style="text-align:center; padding:40px; color:#64748b">Kontaktlar topilmadi.</td></tr>`;

  res.send(
    page(
      "Kontaktlar & CRM",
      `
      <!-- Top Title & Export/Import -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px">
        <div>
          <h2>👥 Barcha kontaktlar (${totalContacts})</h2>
          <p class="hint">Tizimga kelgan barcha ijtimoiy tarmoq mijozlari va muloqot egalari.</p>
        </div>
        <div style="display:flex; gap:10px">
          <a href="/clients/export.csv?channel=${esc(filterChan)}&q=${esc(searchQ)}" class="btn" style="padding:8px 16px; font-size:13px; background:#2563eb; text-decoration:none">
            📥 CSV Eksport
          </a>
        </div>
      </div>

      <!-- Free Quota Progress Bar -->
      <div class="card" style="background:#0f172a; border:1px solid rgba(255,255,255,0.08); padding:16px; margin-bottom:20px">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:13px">
          <span style="color:#a78bfa; font-weight:700">🎁 Bepul tarif sig'imi:</span>
          <b style="color:#fff">${totalContacts} / 500 kontakt ishlatildi</b>
        </div>
        <div style="height:8px; background:#1e293b; border-radius:999px; overflow:hidden">
          <div style="height:100%; width:${Math.min(100, Math.round((totalContacts / 500) * 100))}%; background:linear-gradient(90deg, #7c3aed, #ec4899); border-radius:999px"></div>
        </div>
      </div>

      <!-- Search & Filters -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:12px">
        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <a href="/clients?channel=all" class="btn ${filterChan === "all" ? "" : "secondary"}" style="padding:7px 14px; font-size:12.5px; margin:0">Barcha kanallar</a>
          <a href="/clients?channel=ig" class="btn ${filterChan === "ig" ? "" : "secondary"}" style="padding:7px 14px; font-size:12.5px; margin:0">${brandIcon("instagram", { size: 15 })} Instagram</a>
          <a href="/clients?channel=tg" class="btn ${filterChan === "tg" ? "" : "secondary"}" style="padding:7px 14px; font-size:12.5px; margin:0">${brandIcon("telegram", { size: 15 })} Telegram</a>
          <a href="/clients?channel=wa" class="btn ${filterChan === "wa" ? "" : "secondary"}" style="padding:7px 14px; font-size:12.5px; margin:0">${brandIcon("whatsapp", { size: 15 })} WhatsApp</a>
          <a href="/clients?channel=fb" class="btn ${filterChan === "fb" ? "" : "secondary"}" style="padding:7px 14px; font-size:12.5px; margin:0">${brandIcon("facebook", { size: 15 })} Facebook</a>
        </div>

        <form method="get" action="/clients" style="margin:0">
          <input type="hidden" name="channel" value="${esc(filterChan)}">
          <input type="text" name="q" value="${esc(searchQ)}" placeholder="🔍 Ism yoki akkaunt..." style="padding:7px 12px; font-size:13px; width:220px; margin:0">
        </form>
      </div>

      <!-- Contacts Table -->
      <div class="card" style="padding:0; overflow-x:auto; -webkit-overflow-scrolling:touch">
        <table style="width:100%; min-width:560px; border-collapse:collapse; text-align:left; font-size:14px">
          <thead>
            <tr style="background:#0f172a; border-bottom:1px solid rgba(255,255,255,0.08); color:#94a3b8; font-size:12px; text-transform:uppercase">
              <th style="padding:14px">Ism</th>
              <th style="padding:14px">Akkaunt</th>
              <th style="padding:14px">Yaratilgan sana</th>
              <th style="padding:14px; text-align:right">Amal</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      `,
      { user, active: "contacts" }
    )
  );
});
