/**
 * Universal Sozlamalar & Qo'llab-quvvatlash Module (/settings)
 * Profil, Faoliyat sohasi, Login/Parol, Tun/Kun rejimi, Til, @nkmk_uz Telegram Yordam
 */
import { Router } from "express";
import { requireAuth } from "../auth.js";
import { page, esc } from "./layout.js";
import { brandIcon } from "./icons.js";
import { persist } from "../db.js";
import { changePassword } from "../auth.js";
import { reportsBotAvailable, getReportsBotUsername } from "../reportsBot.js";

export const settingsRouter = Router();

export const BUSINESS_TYPES = [
  { id: "retail", label: "🛍️ Savdo, Magazin va Do'konlar" },
  { id: "medical", label: "🩺 Tibbiyot, Shifokorlar va Klinikalar" },
  { id: "construction", label: "🏗️ Qurilish, Ta'mirlash va Ustalar" },
  { id: "education", label: "🎓 O'quv markazlari, Maktablar va Universitetlar" },
  { id: "blogger", label: "📸 Blogerlar, San'atkorlar va Ekspertlar" },
  { id: "organization", label: "🏢 Tashkilotlar va Davlat idoralari" },
  { id: "services", label: "💼 Xizmat ko'rsatish va Boshqa tadbirkorlik" },
];

settingsRouter.get("/settings", requireAuth, (req, res) => {
  const u = req.user;
  const saved = req.query.saved;
  const error = req.query.error;

  u.settings ||= {};
  const currentType = u.settings.businessType || "retail";
  const currentTheme = u.settings.theme || "dark";
  const currentLang = u.settings.lang || "uz";

  const typeOptionsHtml = BUSINESS_TYPES.map(
    (b) => `<option value="${b.id}" ${currentType === b.id ? "selected" : ""}>${esc(b.label)}</option>`
  ).join("");

  res.send(
    page(
      "Sozlamalar & Yordam",
      `
      ${saved ? `<div class="ok">Sozlamalar muvaffaqiyatli saqlandi! ✅</div>` : ""}
      ${error ? `<div class="error">${esc(error)}</div>` : ""}

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px">
        <div>
          <h2>⚙️ Akkaunt Sozlamalari va Texnik Yordam</h2>
          <p class="hint">Barcha soha va faoliyat turlari uchun moslashtirilgan umumiy platforma sozlamalari.</p>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 24px;">
        
        <!-- Profile & Business Type Settings -->
        <div class="card" style="margin:0; border:1px solid #7c3aed">
          <h3 style="margin-top:0; color:#fff">🏢 Profil va Faoliyat Sohasi</h3>
          <form method="post" action="/settings/profile">
            <label>Tashkilot / Biznes / Shaxs Nomi</label>
            <input type="text" name="businessName" value="${esc(u.businessName || "")}" placeholder="Masalan: Dr. Alimov / Smile Dental / Nur Store" required>

            <label>Faoliyat Sohasi (Yo'nalishingiz)</label>
            <select name="businessType">
              ${typeOptionsHtml}
            </select>
            <p class="hint" style="font-size:12px; margin-top:4px">Bu tanlov AI javoblarini sohaga moslashtiradi.</p>

            <button type="submit" class="btn" style="margin-top:16px; width:100%">💾 Saqlash</button>
          </form>
        </div>

        <!-- Preferences (Theme & Language) -->
        <div class="card" style="margin:0">
          <h3 style="margin-top:0; color:#fff">🎨 Rejim va Til Sozlamalari</h3>
          <form method="post" action="/settings/preferences">
            <label>Tizim Mavzusi (Theme)</label>
            <select name="theme">
              <option value="dark" ${currentTheme === "dark" ? "selected" : ""}>🌙 Tun Rejimi (Dark Mode)</option>
              <option value="light" ${currentTheme === "light" ? "selected" : ""}>☀️ Kun Rejimi (Light Mode)</option>
            </select>

            <label>Tizim Tili (Language)</label>
            <select name="lang">
              <option value="uz" ${currentLang === "uz" ? "selected" : ""}>🇺🇿 O'zbekcha</option>
              <option value="ru" ${currentLang === "ru" ? "selected" : ""}>🇷🇺 Русский</option>
              <option value="en" ${currentLang === "en" ? "selected" : ""}>🇬🇧 English</option>
            </select>

            <button type="submit" class="btn secondary" style="margin-top:16px; width:100%">💾 Saqlash</button>
          </form>
        </div>

        <!-- Password Change -->
        <div class="card" style="margin:0">
          <h3 style="margin-top:0; color:#fff">🔒 Kirish va Xavfsizlik</h3>
          <form method="post" action="/settings/password">
            <label>Login Email</label>
            <input type="email" value="${esc(u.email)}" disabled style="opacity:0.7">

            <label>Joriy parol</label>
            <input type="password" name="oldPassword" required placeholder="••••••••">

            <label>Yangi parol</label>
            <input type="password" name="newPassword" required minlength="6" placeholder="••••••••">

            <button type="submit" class="btn secondary" style="margin-top:16px; width:100%">🔒 Parolni Yangilash</button>
          </form>
        </div>

        <!-- Telegram Reports Bot -->
        ${reportsBotAvailable ? `
        <div class="card" style="margin:0; background: linear-gradient(135deg, rgba(52,211,153,0.1) 0%, rgba(124,58,237,0.1) 100%); border:1px solid rgba(52,211,153,0.35)">
          <h3 style="margin-top:0; color:#fff">📊 Telegram Boshqaruv Boti</h3>
          <p class="hint" style="color:#cbd5e1; font-size:13.5px; margin-bottom:14px">
            Telefon raqamingizni kiriting, so'ng botni oching va shu raqamni yuboring — bog'langach kunlik statistika (xabarlar, mijozlar, xarid so'rovlari) shu botga tushib turadi, va bot menyusi orqali to'g'ridan-to'g'ri Telegram'dan <b>AI'ni o'qitish</b> (bilimlar bazasiga matn qo'shish) va akkaunt <b>holatini</b> (obuna, ulangan kanallar) ko'rish mumkin bo'ladi.
          </p>
          <form method="post" action="/settings/reports-phone">
            <label>Telefon raqami</label>
            <input type="text" name="phone" value="${esc(u.settings.phone || "")}" placeholder="+998901234567">
            <button type="submit" class="btn" style="margin-top:16px; width:100%; background:linear-gradient(135deg,#059669,#10b981)">💾 Saqlash</button>
          </form>
          ${u.settings.reportsTelegramChatId
            ? `<div class="ok" style="margin-top:14px">✅ Bot bilan bog'langansiz — botda "🎓 AI'ni o'qitish" va "🏢 Holat" tugmalarini ham sinab ko'ring.</div>`
            : getReportsBotUsername()
              ? `<a href="https://t.me/${esc(getReportsBotUsername())}" target="_blank" class="btn secondary" style="width:100%; margin-top:14px; text-decoration:none">${brandIcon("telegram", { size: 16 })} Botni ochish</a>`
              : ""}
        </div>
        ` : ""}

        <!-- Direct Technical Support -->
        <div class="card" style="margin:0; background: linear-gradient(135deg, rgba(34,158,217,0.15) 0%, rgba(124,58,237,0.15) 100%); border:1px solid #229ED9">
          <h3 style="margin-top:0; color:#fff">💬 Texnik Qo'llab-quvvatlash</h3>
          <p class="hint" style="color:#cbd5e1; font-size:13.5px; margin-bottom:16px">
            Savollaringiz bormi yoki sozlashda yordam kerakmi? Rasmiy Telegram texnik yordamchimiz bilan bog'laning:
          </p>
          <div style="background:#0f172a; padding:14px; border-radius:10px; border:1px solid rgba(255,255,255,0.08); margin-bottom:16px">
            <span style="font-size:12px; color:#94a3b8">TELEGRAM USERNAME:</span>
            <div style="font-size:18px; font-weight:800; color:#38bdf8; margin-top:2px">@nkmk_uz</div>
          </div>
          <a href="https://t.me/nkmk_uz" target="_blank" class="btn" style="width:100%; background:linear-gradient(135deg,#229ED9,#0088cc); text-decoration:none">
            ${brandIcon("telegram", { size: 16 })} Telegram'da Yozish (@nkmk_uz) ➔
          </a>
        </div>

      </div>
      `,
      { user: u, active: "settings" }
    )
  );
});

settingsRouter.post("/settings/profile", requireAuth, (req, res) => {
  const { businessName, businessType } = req.body || {};
  req.user.businessName = String(businessName || "").slice(0, 200);
  req.user.settings ||= {};
  req.user.settings.businessType = String(businessType || "retail");
  persist(req.user);
  res.redirect("/settings?saved=1");
});

settingsRouter.post("/settings/preferences", requireAuth, (req, res) => {
  const { theme, lang } = req.body || {};
  req.user.settings ||= {};
  req.user.settings.theme = String(theme || "dark");
  req.user.settings.lang = String(lang || "uz");
  persist(req.user);
  res.redirect("/settings?saved=1");
});

settingsRouter.post("/settings/reports-phone", requireAuth, (req, res) => {
  const { phone } = req.body || {};
  req.user.settings ||= {};
  req.user.settings.phone = String(phone || "").trim().slice(0, 20);
  persist(req.user);
  res.redirect("/settings?saved=1");
});

settingsRouter.post("/settings/password", requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const resObj = changePassword(req.user, oldPassword, newPassword);
  if (resObj.error) return res.redirect(`/settings?error=${encodeURIComponent(resObj.error)}`);
  res.redirect("/settings?saved=1");
});
