import { Router } from "express";
import crypto from "node:crypto";
import multer from "multer";
import mammoth from "mammoth";
// pdf-parse'ning asosiy index.js fayli import qilinganda debug-rejim kodi ishga
// tushib, mavjud bo'lmagan test fayl bilan xato beradi (mashhur, hujjatlashtirilgan
// muammo) — shuning uchun ichki lib fayli to'g'ridan-to'g'ri import qilinadi.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  oauthAvailable,
  authUrl,
  connectInstagram,
  subscribeAccount,
} from "../oauth.js";
import {
  register,
  login,
  logout,
  parseSid,
  requireAuth,
  requireAdmin,
  isAdmin,
  changePassword,
  loginOrRegisterWithGoogle,
} from "../auth.js";
import { googleAuthAvailable, googleAuthUrl, fetchGoogleProfile } from "../googleAuth.js";
import { updateUser, listUsers, findUserById, persist, createOrder, setPlanPrices, getPlatformGeminiKey, setPlatformGeminiKey } from "../db.js";
import { config, paymeReady } from "../config.js";
import { getPlans, PLAN_DEFS, statusInfo, activate, deactivate, creditReferral } from "../subscription.js";
import { aiStatusLabel, aiSettings } from "../aiControl.js";
import { aiQuota, getCreditPacks, CREDIT_PACKS, CREDIT_ORDER_PREFIX, platformSettings, savePlatformSettings, addCredits, AI_QUOTA } from "../credits.js";
import { paymeCheckoutUrl } from "../payme.js";
import {
  statsSummary,
  pendingHandoffs,
  resolveHandoff,
  recentLeads,
} from "../engagement.js";
import { ttsAvailable } from "../tts.js";
import { telegramAvailable, sendTelegram } from "../notify.js";
import { page, esc } from "./layout.js";
import { brandIcon } from "./icons.js";
import { getBusinessDiscovery } from "../services/instagram.js";
import { authPage } from "./site.js";
import { pickLang } from "./i18n.js";
import { createRateLimiter } from "../rateLimit.js";

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Ketma-ket ko'p urinish qilindi. Xavfsizlik yuzasidan 15 daqiqadan so'ng qayta urinib ko'ring."
});

export const web = Router();

// Disable browser caching for all web routes so updates load live immediately
web.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// BASE_URL https bo'lsa (production) cookie faqat shifrlangan ulanish orqali yuboriladi
const cookieOpts =
  "HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000" +
  (config.baseUrl.startsWith("https") ? "; Secure" : "");

// Platformada AI kaliti sozlanganmi? (dasturchi .env orqali kiritadi)
const platformAiReady = Boolean(
  process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY
);

// ==== Bosh sahifa ====

web.get("/", (req, res) => {
  if (req.user) return res.redirect("/dashboard");
  const feature = (ico, title, text) =>
    `<div class="feature"><div class="ico">${ico}</div><div><b>${title}</b><span>${text}</span></div></div>`;

  res.send(
    page(
      "Bosh sahifa",
      `<div class="hero">
        <span class="eyebrow">🚀 14 kun bepul sinov</span>
        <h1>Biznesingizni <span class="gradient-text">AI'ga topshiring</span></h1>
        <p class="lede">Instagram, WhatsApp va Facebook'da mijozlaringizga 24/7 avtomatik javob beruvchi aqlli yordamchi. Siz faqat ro'yxatdan o'tib, biznesingizni o'rgatasiz — qolganini AI bajaradi.</p>
        <p><a href="/register" class="btn">Bepul boshlash →</a> &nbsp; <a href="/login" class="btn secondary">Kirish</a></p>
      </div>

          ${feature("💬", "Barchasi bir joyda", "Instagram, Facebook, WhatsApp — hamma kanal bitta paneldan boshqariladi.")}
          ${feature("🛡️", "Xavfsiz", "Rasmiy Meta Graph API — akkaunt blok bo'lish xavfi yo'q.")}
        </div>
        <p class="hint" style="margin-top:18px;text-align:center">Texnik sozlash (AI kaliti, ijtimoiy tarmoqlarni ulash) biz tomonimizdan bajariladi.</p>
      </div>`,
      { user: req.user }
    )
  );
});

// ==== Ro'yxatdan o'tish ====

web.get("/register", (req, res) =>
  res.send(authPage(pickLang(req), "register", { refCode: String(req.query.ref || "").trim() }))
);

web.post("/register", authRateLimiter, async (req, res) => {
  const { email, password, businessName, ref } = req.body || {};
  const result = await register(email, password, businessName);
  if (result.error)
    return res.send(authPage(pickLang(req), "register", { error: result.error, values: req.body, refCode: ref || "" }));

  // Referal: taklif qiluvchini ID prefiksi bo'yicha topib, sinov/obuna muddatini uzaytiradi
  await creditReferral(ref, result.user);

  res.setHeader("Set-Cookie", `sid=${result.token}; ${cookieOpts}`);
  res.redirect("/dashboard");
});

// ==== Kirish / chiqish ====

web.get("/login", (req, res) => res.send(authPage(pickLang(req), "login")));

web.post("/login", authRateLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const result = await login(email, password);
  if (result.error)
    return res.send(authPage(pickLang(req), "login", { error: result.error, values: { email } }));
  res.setHeader("Set-Cookie", `sid=${result.token}; ${cookieOpts}`);
  res.redirect("/dashboard");
});


web.get("/logout", async (req, res) => {
  await logout(parseSid(req));
  res.setHeader("Set-Cookie", ["sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0", "ws=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"]);
  res.redirect("/login");
});

// ==== "Google bilan kirish" (ro'yxatdan o'tish/login) ====

const googleOauthStates = new Map();

web.get("/auth/google", (req, res) => {
  if (!googleAuthAvailable) return res.redirect("/login");
  const state = crypto.randomBytes(16).toString("hex");
  googleOauthStates.set(state, { at: Date.now(), ref: String(req.query.ref || "").trim() });
  res.redirect(googleAuthUrl(state));
});

web.get("/auth/google/callback", async (req, res) => {
  const { code, state, error: googleError } = req.query;
  const entry = googleOauthStates.get(String(state));
  googleOauthStates.delete(String(state));

  if (googleError || !code || !entry || Date.now() - entry.at > 600000) {
    return res.send(authPage(pickLang(req), "login", { error: "Google orqali kirish bekor qilindi yoki muddati tugadi. Qaytadan urinib ko'ring." }));
  }

  const profile = await fetchGoogleProfile(String(code));
  if (profile.error) {
    return res.send(authPage(pickLang(req), "login", { error: profile.error }));
  }

  const result = await loginOrRegisterWithGoogle(profile);
  if (result.error) {
    return res.send(authPage(pickLang(req), "login", { error: result.error }));
  }

  if (entry.ref) await creditReferral(entry.ref, result.user);

  res.setHeader("Set-Cookie", `sid=${result.token}; ${cookieOpts}`);
  res.redirect("/dashboard");
});

// ==== Tadbirkor boshqaruv paneli — faqat AI o'qitish ====

const badge = (on) =>
  on ? `<span class="badge on">ulangan</span>` : `<span class="badge off">kutilmoqda</span>`;

web.get("/dashboard", requireAuth, (req, res) => {
  const u = req.user;
  const admin = isAdmin(u);
  const saved = req.query.saved;
  const channelsReady = Boolean(u.meta.igAccessToken || u.meta.pageAccessToken || u.meta.whatsappToken || u.settings?.telegramBotToken);
  const sub = statusInfo(u);
  const stats = statsSummary(u);
  const pending = pendingHandoffs(u);
  const leads = recentLeads(u);

  const aiLeft = aiQuota(u);
  const subBanner = !sub.active
    ? platformSettings().freePlan
      ? `<div class="info">🆓 ${esc(sub.label)} — bot <b>Bepul</b> tarifda ishlayapti (AI: ${aiLeft.left} javob qoldi). <a href="/billing">Tarifni oshirish</a></div>`
      : `<div class="error">${esc(sub.label)}. Bot faoliyati vaqtincha to'xtatilgan — davom ettirish uchun <a href="/billing">obunani rasmiylashtiring</a>.</div>`
    : aiLeft.left <= Math.max(10, aiLeft.quota * 0.1)
      ? `<div class="info">⚠️ AI javoblar deyarli tugadi: ${aiLeft.left} ta qoldi. <a href="/billing#credits">Kredit olish</a></div>`
      : "";

  // 7-kunlik grafik
  const maxDay = Math.max(1, ...stats.last7.map((d) => d.count));
  const bars = stats.last7
    .map(
      (d) =>
        `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px">
          <div style="height:100px; width:100%; display:flex; align-items:flex-end; background:#0f172a; border-radius:6px; padding:3px">
            <div style="width:100%; background:var(--grad-primary); border-radius:4px; height:${Math.max(8, Math.round((d.count / maxDay) * 100))}%" title="${d.count} xabar"></div>
          </div>
          <span style="font-size:11px; color:#64748b; font-weight:600">${esc(d.day)}</span>
        </div>`
    )
    .join("");

  const handoffList = pending.length
    ? pending
        .map(
          (h) =>
            `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:#0f172a; border-radius:8px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.05)">
              <div>
                <b style="color:#fff; font-size:13.5px">${esc(String(h?.channel || "chat").toUpperCase())}</b> · <code style="font-size:11.5px">${esc(String(h?.chatKey || ""))}</code>
                <div style="font-size:11px; color:#64748b">${h?.at ? new Date(h.at).toLocaleString("uz") : ""}</div>
              </div>
              <form method="post" action="/handoff/resolve" style="margin:0">
                <input type="hidden" name="id" value="${esc(String(h?.id || ""))}">
                <button type="submit" class="secondary" style="margin:0; padding:6px 12px; font-size:12px">Hal qilindi</button>
              </form>
            </div>`
        )
        .join("")
    : `<p class="hint" style="text-align:center; padding:14px">Kutayotgan murojaat yo'q — hammasi joyida ✨</p>`;

  const greet = new Date().getHours() < 12 ? "Xayrli tong" : new Date().getHours() < 18 ? "Xayrli kun" : "Xayrli kech";

  res.send(
    page(
      "Dashboard",
      `
      ${saved ? `<div class="ok">O'zgarishlar muvaffaqiyatli saqlandi! ✅</div>` : ""}
      ${req.query.connected ? `<div class="ok">Instagram/Facebook muvaffaqiyatli ulandi 🎉 Endi bot mijozlaringizga avtomatik javob beradi.</div>` : ""}
      ${subBanner}
      ${(() => {
        const st = aiStatusLabel(u);
        return `<div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; border:1px solid ${st.on ? "rgba(16,185,129,0.45)" : "rgba(100,116,139,0.6)"}">
          <div style="display:flex; gap:12px; align-items:center">
            <span style="width:12px; height:12px; border-radius:50%; background:${st.on ? (st.active ? "#10b981" : "#fbbf24") : "#64748b"}; box-shadow:0 0 0 4px ${st.on ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)"}"></span>
            <div><b style="font-size:16px">🧠 AI avtomatik javob</b><div class="hint" style="font-size:13px">${esc(st.label)}</div></div>
          </div>
          <div style="display:flex; gap:8px">
            <a class="btn secondary" href="/ai-settings" style="margin:0">⚙️ Sozlash</a>
            <form method="post" action="/ai/toggle" style="margin:0">
              <input type="hidden" name="enabled" value="${aiSettings(u).enabled ? "0" : "1"}">
              <input type="hidden" name="back" value="/dashboard">
              <button class="${aiSettings(u).enabled ? "secondary" : ""}" style="margin:0; ${aiSettings(u).enabled ? "color:#f87171" : ""}">${aiSettings(u).enabled ? "⏸️ O'chirish" : "▶️ Yoqish"}</button>
            </form>
          </div>
        </div>`;
      })()}

      <!-- Welcome Hero Banner -->
      <div class="card" style="background: linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(217,70,239,0.15) 100%); border: 1px solid rgba(139,92,246,0.3)">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px">
          <div>
            <h1 style="font-size:24px; margin:0">${esc(greet)}, ${esc(u.businessName || "Biznes egasi")}! 🚀</h1>
            <p class="hint" style="margin:4px 0 14px">Obunext barcha ijtimoiy tarmoqlardagi mijozlaringiz bilan avtomatik muloqot qilmoqda.</p>
            <div style="display:flex; gap:10px; flex-wrap:wrap">
              <span class="status-tag">${u.businessInfo ? "✓ AI O'rgatilgan" : "• AI Sozlanmagan"}</span>
              <span class="status-tag" style="background:rgba(59,130,246,0.15); color:#60a5fa; border-color:rgba(59,130,246,0.3)">${channelsReady ? "✓ Kanallar Faol" : "• Kanallar Yo'q"}</span>
              <span class="status-tag" style="background:rgba(234,179,8,0.15); color:#facc15; border-color:rgba(234,179,8,0.3)">${esc(sub.label)}</span>
            </div>
          </div>
          <div style="display:flex; gap:10px">
            <a href="/inbox" class="btn">💬 Live Inbox</a>
            <a href="/triggers" class="btn secondary">🎯 Triggers</a>
          </div>
        </div>
      </div>

      <!-- Quick Action Shortcuts -->
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <a href="/triggers" class="card card-link" style="margin:0; background:#1e293b">
          <div style="font-size:24px; margin-bottom:6px">⚡</div>
          <b style="font-size:15px; color:#fff">Visual Automations</b>
          <div class="hint" style="font-size:12px">Comment-to-DM, Story Mention</div>
        </a>
        <a href="/inbox" class="card card-link" style="margin:0; background:#1e293b">
          <div style="font-size:24px; margin-bottom:6px">💬</div>
          <b style="font-size:15px; color:#fff">Multi-Channel Inbox</b>
          <div class="hint" style="font-size:12px">Real-time chat & operator mode</div>
        </a>
        <a href="/scheduler" class="card card-link" style="margin:0; background:#1e293b">
          <div style="font-size:24px; margin-bottom:6px">📅</div>
          <b style="font-size:15px; color:#fff">Content Scheduler</b>
          <div class="hint" style="font-size:12px">Post & Reels rejalashtiruvchi</div>
        </a>
        <a href="/account" class="card card-link" style="margin:0; background:#1e293b">
          <div style="font-size:24px; margin-bottom:6px">🧠</div>
          <b style="font-size:15px; color:#fff">AI Knowledge Studio</b>
          <div class="hint" style="font-size:12px">AI simulator & o'rgatish</div>
        </a>
      </div>

      <!-- Statistics Chart -->
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px">
          <h2>📊 Muloqotlar Statistikasi</h2>
          <span class="hint">Oxirgi 7 kun</span>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px;">
          <div style="background:#0f172a; padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05)">
            <span class="hint">Jami Xabarlar</span>
            <div style="font-size:24px; font-weight:800; color:#fff; margin-top:2px">${stats.messages}</div>
          </div>
          <div style="background:#0f172a; padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05)">
            <span class="hint">Noyob Mijozlar (Leads)</span>
            <div style="font-size:24px; font-weight:800; color:#a78bfa; margin-top:2px">${stats.customers}</div>
          </div>
          <div style="background:#0f172a; padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.05)">
            <span class="hint">Buyurtma Niyatlari</span>
            <div style="font-size:24px; font-weight:800; color:#34d399; margin-top:2px">${stats.orders}</div>
          </div>
        </div>

        <div style="display:flex; gap:12px; height:120px; align-items:flex-end">${bars}</div>
      </div>

      <!-- Channels Hub Grid -->
      <div class="card">
        <h2>🔗 Kanallar Hubi (Channels Hub)</h2>
        <p class="hint">Barcha ijtimoiy tarmoqlaringizni ulang va bitta joydan boshqaring:</p>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top:16px">
          <!-- Instagram -->
          <div style="background:#0f172a; border:1px solid rgba(255,255,255,0.08); padding:16px; border-radius:12px; display:flex; gap:14px; align-items:center">
            ${brandIcon("instagram", { size: 32 })}
            <div style="flex:1">
              <b style="color:#fff; font-size:15px">Instagram Direct</b>
              <div class="hint" style="font-size:12px">${u.meta.igUsername || u.meta.igAccessToken ? `@${esc(u.meta.igUsername || "ulangan")} ✅` : "Akkaunt ulanmagan"}</div>
              <div style="margin-top:2px"><a href="https://www.instagram.com/accounts/manage_access/" target="_blank" style="font-size:11.5px; color:#a78bfa; text-decoration:underline">📌 Tester taklifini qabul qilish</a></div>
            </div>
            <div style="display:flex; gap:6px; flex-direction:column">
              ${oauthAvailable ? `<a href="/connect/instagram" class="btn secondary" style="padding:5px 10px; font-size:11.5px; margin:0">🔄 Ulash</a>` : ""}
              ${(u.meta.igAccessToken || u.meta.igUsername) ? `
                <form method="post" action="/connect/instagram/unlink" style="margin:0" onsubmit="return confirm('Instagram akkauntini uzmoqchimisiz?')">
                  <button type="submit" class="btn secondary" style="padding:5px 10px; font-size:11.5px; margin:0; color:#f87171; border-color:rgba(248,113,113,0.3)">🔴 Uzish</button>
                </form>
              ` : ""}
            </div>
          </div>

          <!-- Telegram -->
          <div style="background:#0f172a; border:1px solid rgba(255,255,255,0.08); padding:16px; border-radius:12px; display:flex; gap:14px; align-items:center">
            ${brandIcon("telegram", { size: 32 })}
            <div style="flex:1">
              <b style="color:#fff; font-size:15px">Telegram Bot</b>
              <div class="hint" style="font-size:12px">${u.settings?.telegramBotToken ? "Bot Ulangan ✅" : "Token kiritilmagan"}</div>
            </div>
            <div style="display:flex; gap:6px; flex-direction:column">
              <a href="/account" class="btn secondary" style="padding:5px 10px; font-size:11.5px; margin:0">⚙️ Sozlash</a>
              ${u.settings?.telegramBotToken ? `
                <form method="post" action="/connect/telegram/unlink" style="margin:0" onsubmit="return confirm('Telegram botni uzmoqchimisiz?')">
                  <button type="submit" class="btn secondary" style="padding:5px 10px; font-size:11.5px; margin:0; color:#f87171; border-color:rgba(248,113,113,0.3)">🔴 Uzish</button>
                </form>
              ` : ""}
            </div>
          </div>

          <!-- WhatsApp -->
          <div style="background:#0f172a; border:1px solid rgba(255,255,255,0.08); padding:16px; border-radius:12px; display:flex; gap:14px; align-items:center">
            ${brandIcon("whatsapp", { size: 32 })}
            <div style="flex:1">
              <b style="color:#fff; font-size:15px">WhatsApp Business</b>
              <div class="hint" style="font-size:12px">${u.meta.whatsappToken ? "Ulangan ✅" : "API Tayyor"}</div>
            </div>
            ${u.meta.whatsappToken ? `
              <form method="post" action="/connect/whatsapp/unlink" style="margin:0" onsubmit="return confirm('WhatsApp-ni uzmoqchimisiz?')">
                <button type="submit" class="btn secondary" style="padding:5px 10px; font-size:11.5px; margin:0; color:#f87171; border-color:rgba(248,113,113,0.3)">🔴 Uzish</button>
              </form>
            ` : ""}
          </div>

          <!-- Facebook -->
          <div style="background:#0f172a; border:1px solid rgba(255,255,255,0.08); padding:16px; border-radius:12px; display:flex; gap:14px; align-items:center">
            ${brandIcon("facebook", { size: 32 })}
            <div style="flex:1">
              <b style="color:#fff; font-size:15px">Facebook Messenger</b>
              <div class="hint" style="font-size:12px">${u.meta.pageId ? "Sahifa Ulangan ✅" : "Tayyor"}</div>
            </div>
            ${u.meta.pageId ? `
              <form method="post" action="/connect/facebook/unlink" style="margin:0" onsubmit="return confirm('Facebook sahifasini uzmoqchimisiz?')">
                <button type="submit" class="btn secondary" style="padding:5px 10px; font-size:11.5px; margin:0; color:#f87171; border-color:rgba(248,113,113,0.3)">🔴 Uzish</button>
              </form>
            ` : ""}
          </div>
        </div>
      </div>

      <!-- Recent Leads & Operator Calls -->
      <div class="grid cols-2" style="gap: 20px;">
        <div class="card" style="margin:0">
          <h2>🧑‍🤝‍🧑 So'nggi Mijozlar (Leads)</h2>
          ${
            leads.length
              ? leads
                  .map((l) => {
                    const ch = String(l?.channel || (l?.key ? l.key.split(":")[0] : "chat")).toUpperCase();
                    const keyStr = String(l?.chatKey || l?.key || l?.contact || "");
                    const text = String(l?.lastText || l?.contact || l?.name || "Muloqot");
                    const timeStr = l?.lastAt || l?.at
                      ? new Date(l.lastAt || l.at).toLocaleTimeString("uz", { hour: "2-digit", minute: "2-digit" })
                      : "";
                    return `<div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:13px">
                        <div>
                          <b style="color:#a78bfa">${esc(ch)}</b> · <code style="font-size:11px">${esc(keyStr.slice(0, 14))}</code>
                          <div style="color:#94a3b8; font-size:12px; margin-top:2px">${esc(text)}</div>
                        </div>
                        <div style="text-align:right; color:#64748b; font-size:11px">
                          ${timeStr}
                        </div>
                      </div>`;
                  })
                  .join("")
              : `<p class="hint">Hali mijozlar murojaat qilmagan.</p>`
          }
        </div>

        <div class="card" style="margin:0">
          <h2>👤 Operator Chaqiruvlari</h2>
          ${handoffList}
        </div>
      </div>
      `,
      { user: u, active: "dashboard" }
    )
  );
});

web.post("/settings/voice", requireAuth, async (req, res) => {
  const settings = { ...(req.user.settings || {}), voiceReplies: Boolean(req.body.voiceReplies) };
  await updateUser(req.user.id, { settings });
  res.redirect("/dashboard?saved=1");
});

web.post("/handoff/resolve", requireAuth, (req, res) => {
  resolveHandoff(req.user, String(req.body.id || ""));
  res.redirect("/dashboard");
});

web.post("/settings/telegram", requireAuth, async (req, res) => {
  const settings = {
    ...(req.user.settings || {}),
    telegramChatId: String(req.body.telegramChatId || "").trim(),
  };
  await updateUser(req.user.id, { settings });
  res.redirect("/dashboard?saved=1");
});

web.post("/settings/telegram/test", requireAuth, async (req, res) => {
  const ok = await sendTelegram(
    req.user.settings?.telegramChatId,
    `✅ Sinov xabari — "${req.user.businessName}" bildirishnomalari ishlayapti.`
  );
  res.redirect(ok ? "/dashboard?saved=1" : "/dashboard");
});

// ==== Obuna / to'lov sahifasi ====

web.get("/billing", requireAuth, async (req, res) => {
  const u = req.user;
  const sub = statusInfo(u);
  const plansArr = Object.values(await getPlans());

  const planCards = plansArr
    .map((p, i) => {
      const current = u.subscription.plan === p.id;
      const popular = i === 1; // Popular plan
      return `<div class="card" style="margin:0; position:relative; ${current ? "border:2px solid #8b5cf6" : popular ? "border:2px solid #ec4899" : ""}">
        ${popular && !current ? `<span class="status-tag" style="position:absolute; top:-12px; left:20px; background:var(--grad-primary); color:#fff; border:0">🔥 OMMABOP</span>` : ""}
        ${current ? `<span class="status-tag" style="position:absolute; top:-12px; left:20px">✓ JORIY TARIF</span>` : ""}
        <h2 style="margin-bottom:4px; font-size:22px">${esc(p.name)}</h2>
        <p class="hint" style="margin:0 0 10px">${esc(p.tagline || "")}</p>
        <div style="font-size:32px; font-weight:800; margin:10px 0; color:#fff">${p.price.toLocaleString("uz")} <span style="font-size:14px; color:#94a3b8; font-weight:500">so'm/oy</span></div>
        <div style="border-top:1px solid var(--border); padding-top:14px; margin-bottom:18px">
          ${[`${(AI_QUOTA[p.id] || 0).toLocaleString("ru-RU")} ta AI javob / oy`, "Cheksiz flow'lar va ommaviy xabarlar", ...p.features].map((f) => `<div style="display:flex; gap:10px; align-items:center; padding:6px 0; font-size:13.5px; color:#cbd5e1"><span style="color:#a78bfa; font-weight:800">✓</span> ${esc(f)}</div>`).join("")}
        </div>
        ${
          paymeReady
            ? `<form method="post" action="/billing/pay" style="margin:0">
                 <input type="hidden" name="plan" value="${esc(p.id)}">
                 <button class="${popular ? "" : "secondary"}" style="width:100%; margin:0">Payme orqali to'lash ➔</button>
               </form>`
            : `<div class="status-tag" style="width:100%; justify-content:center">To'lov tez orada</div>`
        }
      </div>`;
    })
    .join("");

  const ps = platformSettings();
  const statusCard = sub.active
    ? `<div class="ok">${esc(sub.label)}${sub.until ? ` — ${sub.until.toLocaleDateString("uz")}gacha` : ""}. Botingiz uzluksiz ishlayapti.</div>`
    : ps.freePlan
      ? `<div class="info">🆓 ${esc(sub.label)} — siz <b>Bepul</b> tarifdasiz: flow'lar (${ps.freeFlowLimit || 3} tagacha), qoidalar va oyiga ${AI_QUOTA.free} ta AI javob ishlaydi. Ommaviy xabarlar va to'liq AI uchun tarif tanlang.</div>`
      : `<div class="error">${esc(sub.label)}. Bot to'xtatilgan — to'lovdan so'ng avtomatik faollashadi.</div>`;
  const q = aiQuota(u);
  const packs = await getCreditPacks();
  const pct = q.quota ? Math.min(100, Math.round((q.used / q.quota) * 100)) : 100;
  const planLabel = { free: "🆓 Bepul", trial: "🧪 Sinov", start: "Start", pro: "Pro", business: "Business" }[q.plan] || q.plan;
  const creditsCard = `
    <div class="card" id="credits" style="margin-top:20px">
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center">
        <div>
          <h2 style="margin:0">🧠 AI javoblar</h2>
          <p class="hint" style="margin:4px 0 0">Tarif: <b>${esc(planLabel)}</b> · oylik limit ${q.quota.toLocaleString("ru-RU")} · ${esc(q.month)}</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:28px; font-weight:800">${q.left.toLocaleString("ru-RU")}</div>
          <div class="hint" style="font-size:12px">qolgan javob${q.bonus ? ` (shundan ${q.bonus.toLocaleString("ru-RU")} — sotib olingan kredit)` : ""}</div>
        </div>
      </div>
      <div style="height:8px; background:rgba(255,255,255,0.06); border-radius:99px; overflow:hidden; margin:14px 0 6px"><div style="height:100%; width:${pct}%; background:${pct >= 90 ? "#f87171" : "var(--grad-primary)"}"></div></div>
      <p class="hint" style="font-size:12.5px; margin:0">Bu oy ${q.used.toLocaleString("ru-RU")} / ${q.quota.toLocaleString("ru-RU")} ishlatildi. Limit tugasa, bot kalit so'z va flow'lar bilan ishlashda davom etadi. Sotib olingan kreditlar yonmaydi.</p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-top:16px">
        ${packs.map((p) => `<div class="card" style="margin:0; text-align:center">
            <div style="font-size:24px; font-weight:800">+${p.credits.toLocaleString("ru-RU")}</div>
            <div class="hint">AI javob</div>
            <div style="font-size:18px; font-weight:700; margin:8px 0">${p.price.toLocaleString("uz")} so'm</div>
            ${paymeReady
              ? `<form method="post" action="/billing/credits" style="margin:0"><input type="hidden" name="pack" value="${esc(p.id)}"><button class="secondary" style="width:100%; margin:0">Payme orqali olish</button></form>`
              : `<div class="status-tag" style="justify-content:center">To'lov tez orada</div>`}
          </div>`).join("")}
      </div>
    </div>`;

  res.send(
    page(
      "Obuna & Tariflar",
      `
      <div style="margin-bottom:20px">
        <h2>💳 Obuna va Tariflar</h2>
        <p class="hint">Biznesingiz hajmiga mos tarifni tanlang hamda Payme orqali xavfsiz to'lang.</p>
      </div>

      ${statusCard}

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-top:20px">
        ${planCards}
      </div>
      ${creditsCard}
      `,
      { user: u, active: "billing" }
    )
  );
});

// AI kredit paketini sotib olish (Payme)
web.post("/billing/credits", requireAuth, async (req, res) => {
  if (!paymeReady) return res.redirect("/billing#credits");
  const pack = (await getCreditPacks()).find((p) => p.id === String(req.body?.pack || ""));
  if (!pack) return res.redirect("/billing#credits");
  const order = await createOrder({ userId: req.user.id, plan: `${CREDIT_ORDER_PREFIX}${pack.id}`, days: 0, amount: pack.price });
  const returnUrl = config.baseUrl ? `${config.baseUrl}/billing?paid=1#credits` : "";
  res.redirect(paymeCheckoutUrl(order, { lang: "uz", returnUrl }));
});

// Payme to'lovini boshlash — buyurtma yaratib, checkout'ga yo'naltiradi
web.post("/billing/pay", requireAuth, async (req, res) => {
  if (!paymeReady) return res.redirect("/billing");
  const plan = (await getPlans())[String(req.body.plan || "")];
  if (!plan) return res.redirect("/billing");
  const order = await createOrder({
    userId: req.user.id,
    plan: plan.id,
    days: 30,
    amount: plan.price,
  });
  const returnUrl = config.baseUrl ? `${config.baseUrl}/billing?paid=1` : "";
  res.redirect(paymeCheckoutUrl(order, { lang: "uz", returnUrl }));
});

web.post("/settings/business", requireAuth, async (req, res) => {
  req.user.settings ||= {};
  req.user.settings.creativeReasoning = Boolean(req.body.creativeReasoning);
  // Avval xotiradagi req.user'ni yangilaymiz, SO'NG bitta persist(req.user) chaqiramiz —
  // aks holda (avval alohida updateUser() bilan bazaga yozib, keyin eskirgan
  // req.user'ni persist qilsak) persist() bazadagi yangi qiymatni eski qiymat bilan
  // qayta ustidan yozib, saqlangan ma'lumotni yo'qotib qo'yadi.
  req.user.businessName = String(req.body.businessName || "").slice(0, 200);
  req.user.businessInfo = String(req.body.businessInfo || "").slice(0, 50000);
  await persist(req.user);
  res.redirect("/account?saved=1");
});

// ==== Instagram bilan ulash (OAuth self-service) ====

// state -> { userId, at } — CSRF himoyasi (10 daqiqa amal qiladi)
const oauthStates = new Map();

web.get("/connect/instagram", requireAuth, (req, res) => {
  if (!oauthAvailable) return res.redirect("/dashboard");
  const state = crypto.randomBytes(16).toString("hex");
  oauthStates.set(state, { userId: req.user.id, at: Date.now() });
  res.redirect(authUrl(state));
});

web.get("/connect/instagram/callback", requireAuth, async (req, res) => {
  const { code, state, error_description: igError } = req.query;
  const entry = oauthStates.get(String(state));
  oauthStates.delete(String(state));

  if (igError || !code) {
    return res.send(connectResult(req.user, "Ulanish bekor qilindi yoki rad etildi."));
  }
  if (!entry || entry.userId !== req.user.id || Date.now() - entry.at > 600000) {
    return res.send(
      connectResult(req.user, "Xavfsizlik tekshiruvi muvaffaqiyatsiz — qaytadan urinib ko'ring.")
    );
  }

  const result = await connectInstagram(String(code));
  if (result.error) return res.send(connectResult(req.user, result.error));

  // Bitta Instagram akkaunt faqat bitta biznesga ulanishi mumkin. Aks holda
  // kiruvchi xabar qaysi biznesga tegishli ekani aniqlanmaydi — findUserByPlatformId
  // birinchi topilganini oladi va xabarlar noto'g'ri hisobga ketadi.
  const allUsers = await listUsers();
  const taken = allUsers.find(
    (u) => u.id !== req.user.id && u.meta?.igUserId === result.igUserId
  );
  if (taken) {
    return res.send(
      connectResult(
        req.user,
        `@${result.igUsername} allaqachon boshqa hisobga (${esc(taken.email)}) ulangan. ` +
          `Avval o'sha hisobga kirib "Ulanishni uzish" tugmasini bosing, keyin bu yerga qaytadan ulang.`
      )
    );
  }

  await updateUser(req.user.id, {
    meta: {
      ...(req.user.meta || {}),
      igAccessToken: result.igAccessToken,
      igUserId: result.igUserId,
      igUsername: result.igUsername,
    },
  });

  // Akkauntni webhooklarga ulaymiz — shundan keyin xabarlar kela boshlaydi.
  // Xato bo'lsa ham dashboardga qaytaramiz: token saqlangan, qayta urinish mumkin.
  const sub = await subscribeAccount(result.igAccessToken);
  if (!sub) {
    return res.send(
      connectResult(
        req.user,
        `@${result.igUsername} ulandi, lekin xabarlarga obuna bo'lishda xatolik bo'ldi. ` +
          `Qaytadan ulashga urinib ko'ring yoki biz bilan bog'laning.`
      )
    );
  }

  res.redirect("/dashboard?connected=1");
});

web.post("/connect/disconnect", requireAuth, async (req, res) => {
  await updateUser(req.user.id, {
    meta: { ...(req.user.meta || {}), igAccessToken: "", igUserId: "", igUsername: "", pageAccessToken: "", pageId: "" },
  });
  res.redirect("/dashboard?saved=1");
});

function connectResult(user, error) {
  return page(
    "Ulanish",
    `<div class="card" style="max-width:580px; margin:30px auto">
      <h2>📷 Instagram Ulanish Natijasi</h2>
      <div class="error" style="margin:16px 0; font-size:14px; line-height:1.6">${esc(error)}</div>

      <div style="background:#0f172a; border:1px solid rgba(167,139,250,0.3); border-radius:10px; padding:16px; margin:20px 0">
        <b style="color:#a78bfa; font-size:14px">💡 Instagram Tester taklifini qabul qilish:</b>
        <p class="hint" style="margin:8px 0 14px; font-size:13px; color:#cbd5e1">
          Agar Meta Developer Console'da akkauntingiz Tester qilib qo'shilgan bo'lsa, quyidagi tugmani bosib Instagram'da taklifni qabul qiling va qaytadan ulanish tugmasini bosing:
        </p>
        <a href="https://www.instagram.com/accounts/manage_access/" target="_blank" class="btn" style="padding:8px 16px; font-size:13px; background:linear-gradient(135deg,#7c3aed,#db2777); text-decoration:none; display:inline-block">
          👉 Instagram Tester taklifini qabul qilish (manage_access)
        </a>
      </div>

      <div style="display:flex; gap:12px; margin-top:20px">
        <a href="/connect/instagram" class="btn secondary" style="margin:0">🔄 Qaytadan ulanish</a>
        <a href="/dashboard" class="btn ghost" style="margin:0">← Boshqaruvga qaytish</a>
      </div>
    </div>`,
    { user }
  );
}

import { setupTelegramWebhook } from "../telegram.js";
import { generateReply, askGemini } from "../ai.js";

// AI Test Sandbox Playground (AJAX)
web.post("/account/ai-test", requireAuth, async (req, res) => {
  const { testQuestion } = req.body || {};
  if (!testQuestion) return res.json({ reply: "Iltimos, sinov savolini yozing." });
  try {
    const reply = await generateReply(req.user, "sandbox_test", { text: testQuestion });
    res.json({ reply });
  } catch (err) {
    res.json({ reply: `Xato: ${err.message}` });
  }
});

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/**
 * Hujjat (.docx/.pdf/.txt/.md/.json/.csv) fayldan AI Bilimlar Bazasi uchun
 * HAQIQIY matn ajratib oladi. Ilgari brauzer bu fayllarni oddiy matn sifatida
 * o'qirdi — .docx/.pdf ikkalasi ham ZIP/binary formatlar bo'lgani uchun bu
 * asossiz belgilar (garbage) hosil qilardi, muvaffaqiyat xabari esa yolg'on edi.
 */
web.post("/account/upload-document", requireAuth, (req, res) => {
  docUpload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || "Fayl yuklashda xato" });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "Fayl topilmadi" });

    const name = file.originalname || "";
    const ext = name.split(".").pop()?.toLowerCase() || "";

    try {
      let text = "";
      if (ext === "docx") {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        text = result.value || "";
      } else if (ext === "pdf") {
        const result = await pdfParse(file.buffer);
        text = result.text || "";
      } else if (["txt", "md", "json", "csv"].includes(ext)) {
        text = file.buffer.toString("utf-8");
      } else {
        return res.status(400).json({
          ok: false,
          error: `".${ext}" formati qo'llab-quvvatlanmaydi. Faqat .docx, .pdf, .txt, .md, .json, .csv qabul qilinadi (eski .doc formati emas).`,
        });
      }

      text = text.trim();
      if (!text) {
        return res.status(400).json({ ok: false, error: "Fayldan matn topilmadi — bo'sh yoki skanerlangan rasm-PDF bo'lishi mumkin." });
      }

      res.json({ ok: true, text, filename: name });
    } catch (parseErr) {
      console.error("Hujjat parslashda xato:", parseErr.message);
      res.status(500).json({ ok: false, error: "Faylni o'qib bo'lmadi: " + parseErr.message });
    }
  });
});

// Telegram Bot Token saqlash va Webhook o'rnatish
web.post("/settings/telegram-bot", requireAuth, async (req, res) => {
  const token = String(req.body.telegramBotToken || "").trim();
  const u = req.user;
  u.settings ||= {};
  u.settings.telegramBotToken = token;
  await updateUser(u.id, { settings: u.settings });

  const ok = token ? await setupTelegramWebhook(u) : false;
  res.redirect(ok ? "/account?saved=1&tg=ok" : token ? "/account?tg=err" : "/account?saved=1");
});

// Telegram Business: avtomatik javobni yoqish/o'chirish
web.post("/settings/telegram-business", requireAuth, async (req, res) => {
  const u = req.user;
  u.tgBusiness ||= {};
  u.tgBusiness.autoReply = req.body?.autoReply === "on";
  persist(u);
  res.redirect("/account?saved=1#tg-business");
});

// WhatsApp Business API sozlamalarini saqlash
web.post("/settings/whatsapp", requireAuth, async (req, res) => {
  const { whatsappPhoneId, whatsappToken, whatsappBusinessId } = req.body || {};
  await updateUser(req.user.id, {
    meta: {
      ...(req.user.meta || {}),
      whatsappPhoneNumberId: String(whatsappPhoneId || "").trim(),
      whatsappPhoneId: String(whatsappPhoneId || "").trim(),
      whatsappToken: String(whatsappToken || "").trim(),
      whatsappBusinessId: String(whatsappBusinessId || "").trim(),
    },
  });
  res.redirect("/account?saved=1&wa=ok");
});

// Facebook Messenger Page Access Token saqlash
web.post("/settings/facebook", requireAuth, async (req, res) => {
  const { pageId, pageAccessToken } = req.body || {};
  await updateUser(req.user.id, {
    meta: {
      ...(req.user.meta || {}),
      pageId: String(pageId || "").trim(),
      pageAccessToken: String(pageAccessToken || "").trim(),
    },
  });
  res.redirect("/account?saved=1&fb=ok");
});

// ==== Akkaunt sahifasi (AI O'rgatish + Telegram Bot + WhatsApp + FB Messenger + Parol) ====

web.get("/account", requireAuth, (req, res) => {
  res.send(accountPage(req.user, req.query));
});

web.post("/account/password", requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const result = await changePassword(req.user, oldPassword, newPassword, parseSid(req));
  if (result.error) return res.send(accountPage(req.user, { error: result.error }));
  res.send(accountPage(req.user, { ok: "Parol yangilandi ✅" }));
});

function accountPage(u, query = {}) {
  const initial = (u.businessName || u.email || "?").trim().charAt(0).toUpperCase();
  const saved = query.saved;
  const tgOk = query.tg === "ok";
  const tgErr = query.tg === "err";
  const error = query.error || "";
  const okMsg = query.ok || "";

  const templates = {
    shop: `📌 BIZNES HAQIDA MA'LUMOT:
Biz "Online Shop" kiyim-kechak do'konimiz. 
📍 Manzil: Toshkent sh., Chilonzor 5-daha, 12-uy. Mo'ljal: Metro Chilonzor.
⏰ Ish vaqti: Har kuni 09:00 dan 21:00 gacha.
📞 Telefon: +998 90 123 45 67

👕 MAHSULOTLAR VA NARXLAR:
- Xuddi (Hoodie): 250,000 so'm (Qora, Oq, Kulrang / S, M, L, XL)
- Futbolka: 120,000 so'm (100% paxta)
- Djinsi shim: 280,000 so'm

🚚 YETKAZIB BERISH VA TO'LOV:
- Toshkent bo'ylab yetkazib berish: 25,000 so'm (1 kun).
- Viloyatlarga BTS pochta orqali: 30,000 so'm (2-3 kun).
- To'lov usullari: Click, Payme yoki Naqd.`,
    restaurant: `📌 RESTORAN HAQIDA MA'LUMOT:
Biz "Gourmet House" milliy va yevropa taomlari restoranimiz.
📍 Manzil: Toshkent sh., Amir Temur shoh ko'chasi 45.
⏰ Ish vaqti: 10:00 dan 23:00 gacha.
📞 Stollar band qilish: +998 71 200 00 00

🍲 MENYU VA NARXLAR:
- Osh (Toy oshi): 45,000 so'm
- Choyxona Palov: 50,000 so'm
- Shashlik (Mol go'shti): 22,000 so'm / sih
- Pizza Margherita: 75,000 so'm

🛵 YETKAZIB BERISH:
- Express yetkazib berish: 45 daqiqa ichida.
- Minimal buyurtma: 80,000 so'm.`,
    clinic: `📌 TIBBIY MARKAZ / XIZMATLAR:
Biz "Smile Dental" zamonaviy stomatologiya klinikasi va tibbiy markazmiz.
📍 Manzil: Toshkent sh., Yunusobod 11-daha. Mo'ljal: Shaxriston metro.
⏰ Ish vaqti: Dushanba-Shanba 09:00 - 19:00.
📞 Qabulga yozilish: +998 97 777 00 11

🩺 XIZMATLAR VA NARXLAR:
- Shifokor konsultatsiyasi: Bepul
- Tishlarni tozalash va gigiyena: 200,000 so'm
- Tish davolash (plomba): 180,000 so'mdan
- Tish implantatsiyasi: 2,500,000 so'mdan

💡 QABULGA YOZILISH TARTIBI:
Mijozdan ismi va telefon raqamini so'rab, operatorga xabar bering.`,
    education: `📌 O'QUV MARKAZ HAQIDA:
Biz "Future Academy" zamonaviy IT va Xorijiy tillar akademiyasimiz.
📍 Manzil: Toshkent sh., Novza metro binosi 3-qavat.
⏰ Ish vaqti: 09:00 - 20:00.
📞 Aloqa: +998 93 555 11 22

🎓 KURSLAR VA NARXLAR:
- Frontend / React Dasturlash: 800,000 so'm/oy (6 oy)
- Python / AI Dasturlash: 900,000 so'm/oy (5 oy)
- Ingliz tili (IELTS 7.5+): 650,000 so'm/oy (4 oy)

🎁 AKSIONER:
Birinchi sinov darsi — BEPUL! Sinov darsiga yozilish uchun "DARS" so'zini yuboring.`,
    electronics: `📌 ELEKTRONIKA VA TELEFONLAR DO'KONI:
Biz "TechZone" gadjetlar va maishiy texnika do'konimiz.
📍 Manzil: Toshkent sh., Malika savdo majmuasi, A-15 do'kon.
⏰ Ish vaqti: 10:00 - 20:00.
📞 Aloqa: +998 90 999 88 77

📱 TAVSIF VA NARXLAR:
- iPhone 15 Pro Max 256GB: 1,180 $ (yoki so'mda amaldagi kurs bo'yicha)
- Samsung Galaxy S24 Ultra: 1,050 $
- AirPods Pro 2: 240 $

💳 NASIYA SAVDO VA KAFOLAT:
- 1 yillik rasmiy kafolat.
- Uzum Nasiya / Anorbank orqali 12 oyga bo'lib to'lash imkoniyati.`,
    construction: `📌 QURILISH VA USTA XIZMATLARI:
Biz "MasterBuild" qurilish, ta'mirlash va dizayn xizmatlarimiz.
📍 Manzil/Ofis: Toshkent sh., Sergeli 4-daha.
⏰ Ish vaqti: Har kuni 08:00 - 20:00.
📞 Usta chaqirish / Smeta: +998 91 111 22 33

🏗️ XIZMATLAR VA SMETA NARXLARI:
- Uylarni kalit topshirishgacha qurish: 1 kv.m — 180 $ dan
- Kvartira remont/dizayn: 1 kv.m — 45 $ dan
- Elektrik / Santexnik xizmati: Chaqiruv — 50,000 so'm

💡 USTA CHAQIRISH TARTIBI:
Mijozdan ob'ekt manzili va telefon raqamini so'rab, ustaga xabar bering.`,
    blogger: `📌 BLOGER / SHAXSIY EKSPERT PROFILI:
Men Alisher Fayz — Biznes va AI bo'yicha ekspert va blogerman.
📩 Hamkorlik va Reklama uchun aloqa: @assistant_bot yoki +998 90 000 11 22

🌟 REKLAMA VA HIZMATLAR NARXI:
- Instagram Story reklama: 2,000,000 so'm
- Post / Reels integratsiya: 5,000,000 so'm
- Shaxsiy 1-ga-1 konsultatsiya: 1,500,000 so'm (1 soat)`,
    organization: `📌 TASHKILOT / DAVLAT IDORASI/ XIZMATLAR:
Biz "Fuqarolar Murojaat Markazi" jamoat tashkilotimiz.
📍 Manzil: Toshkent sh., Navoiy ko'chasi 18-uy.
⏰ Qabul soatlari: Dushanba-Juma 09:00 - 18:00.
📞 Ishonch telefoni: 1055 yoki +998 71 200 10 55

📄 HIZMATLAR VA MUROJAAT TARTIBI:
- Hujjatlarni topshirish, ruxsatnomalar va maslahat bepul.
- Murojaat qoldirish uchun ism-familiyangiz va masalangizni yozing.`
  };

  return page(
    "Akkaunt & AI Studio",
    `
    ${saved ? `<div class="ok">O'zgarishlar muvaffaqiyatli saqlandi! ✅</div>` : ""}
    ${tgOk ? `<div class="ok">Telegram Bot Webhook muvaffaqiyatli ulandi! 🚀 Endi Telegram mijozlariga ham bot javob beradi.</div>` : ""}
    ${tgErr ? `<div class="error">Telegram Bot Token noto'g'ri yoki Webhook o'rnatib bo'lmadi. Tokenni tekshiring.</div>` : ""}
    ${okMsg ? `<div class="ok">${esc(okMsg)}</div>` : ""}
    ${error ? `<div class="error">${esc(error)}</div>` : ""}

    <script>
      window.templates = ${JSON.stringify(templates)};
      window.applyTemplate = function(key) {
        if (!key || !window.templates || !window.templates[key]) return;
        const el = document.getElementById('bizInfo');
        if (!el) return;
        if (el.value.trim() && !confirm("Joriy bilimlar bazasi namuna matn bilan ALMASHTIRILADI. Davom etilsinmi?")) return;
        el.value = window.templates[key];
      };

      window.clearKnowledgeBase = function() {
        const btn = document.getElementById('btnClearKb');
        if (btn) {
          btn.style.background = '#7f1d1d';
          setTimeout(() => btn.style.background = '', 500);
        }
        if (confirm("Rostdan ham barcha kiritilgan bilimlar bazasini o'chirmoqchimisiz?")) {
          const el = document.getElementById('bizInfo');
          if (el) el.value = '';
          const statusEl = document.getElementById('fileUploadStatus');
          if (statusEl) {
            statusEl.style.color = '#f87171';
            statusEl.innerText = "⚠️ Bilimlar bazasi tozalandi. 'Saqlash' tugmasini bosing.";
          }
        }
      };

      window.appendKnowledgeSection = function() {
        const btn = document.getElementById('btnAddSection');
        if (btn) {
          btn.style.background = '#4c1d95';
          setTimeout(() => btn.style.background = '', 500);
        }
        const title = prompt("Yangi bo'lim yoki hujjat sarlavhasini kiriting:", "📌 YANGI BO'LIM:");
        if (title) {
          const textarea = document.getElementById('bizInfo');
          if (textarea) {
            const header = (textarea.value.trim() ? "\n\n" : "") + "--- " + title.trim() + " ---\n";
            textarea.value = (textarea.value.trim() + header).trim();
            textarea.focus();
          }
        }
      };

      window.togglePreviewKnowledge = function() {
        const btn = document.getElementById('btnPreviewKb');
        if (btn) {
          btn.style.background = '#1e3a8a';
          setTimeout(() => btn.style.background = '', 500);
        }
        const txtEl = document.getElementById('bizInfo');
        const pBox = document.getElementById('knowledgePreviewBox');
        if (!txtEl || !pBox) return;
        const txt = txtEl.value;
        if (pBox.style.display === 'none') {
          pBox.style.display = 'block';
          pBox.innerHTML = '<b style="color:#a78bfa">👁️ Bilimlar Bazasi Ko\'rinishi:</b><pre style="white-space:pre-wrap; margin-top:8px; color:#cbd5e1; font-family:sans-serif; font-size:13px; background:#0f172a; padding:14px; border-radius:8px; border:1px solid rgba(255,255,255,0.08)">' + (txt.replace(/</g, "&lt;").replace(/>/g, "&gt;") || "Hali bilimlar kiritilmagan.") + '</pre>';
        } else {
          pBox.style.display = 'none';
        }
      };

      window.currentAuditFullText = "";

      window.startInlineIgAudit = function() {
        const input = document.getElementById('igHandleInputField');
        const btn = document.getElementById('btnScanIg');
        let handle = input ? input.value.trim() : '';
        if (!handle || handle === '@') {
          alert("Iltimos, Instagram username yoki profil havolasini kiriting!");
          if (input) input.focus();
          return;
        }

        const cleanHandle = handle.replace(/https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '').replace(/^@/, '');
        
        // Button visual active state change
        if (btn) {
          btn.dataset.origHtml = btn.innerHTML;
          btn.style.background = "linear-gradient(135deg, #7c3aed, #4f46e5)";
          btn.style.opacity = "0.9";
          btn.style.pointerEvents = "none";
          btn.innerHTML = "⏳ Skanerlanmoqda... (0%)";
        }

        const inlineBox = document.getElementById('inlineAuditStatusBox');
        const inlineProgress = document.getElementById('inlineProgressArea');
        const inlineReport = document.getElementById('inlineReportArea');
        const inlineBar = document.getElementById('inlineProgressBar');
        const inlinePercent = document.getElementById('inlinePercentText');
        const inlineStatus = document.getElementById('inlineStatusText');

        if (inlineBox) inlineBox.style.display = 'block';
        if (inlineProgress) inlineProgress.style.display = 'block';
        if (inlineReport) inlineReport.style.display = 'none';

        let current = 0;
        const steps = [
          { p: 25, t: "🔍 @" + cleanHandle + " Instagram profiliga ulanmoqda..." },
          { p: 50, t: "📄 Bio, kontakt va profil ma'lumotlari ajratib olinmoqda..." },
          { p: 75, t: "🧠 Obunext kamchilik va sotuv muammolarini tahlil qilmoqda..." },
          { p: 90, t: "🚀 Sotuvni oshirish bo'yicha tavsiyalar tayyorlanmoqda..." },
        ];

        let stepIdx = 0;
        const interval = setInterval(() => {
          if (stepIdx < steps.length) {
            current = steps[stepIdx].p;
            if (inlineBar) inlineBar.style.width = current + "%";
            if (inlinePercent) inlinePercent.innerText = current + "%";
            if (inlineStatus) inlineStatus.innerText = steps[stepIdx].t;
            if (btn) btn.innerHTML = "⏳ Skanerlanmoqda... (" + current + "%)";
            stepIdx++;
          } else {
            clearInterval(interval);
            fetch('/account/scan-instagram-audit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ instagramHandle: cleanHandle })
            })
            .then(res => res.json())
            .then(data => {
              if (data && data.ok === false) throw new Error(data.error || "Tahlil qilib bo'lmadi");

              if (inlineBar) inlineBar.style.width = "100%";
              if (inlinePercent) inlinePercent.innerText = "100%";
              if (inlineStatus) inlineStatus.innerText = "✅ Tahlil muvaffaqiyatli yakunlandi!";

              if (btn) {
                btn.style.background = "linear-gradient(135deg, #059669, #10b981)";
                btn.innerHTML = "✅ Tahlil Yakunlandi!";
                setTimeout(() => {
                  btn.style.background = "linear-gradient(135deg, #f472b6, #db2777)";
                  btn.style.opacity = "1";
                  btn.style.pointerEvents = "auto";
                  btn.innerHTML = btn.dataset.origHtml || "🚀 Skanerlash va AI Bazasini Yaratish";
                }, 3000);
              }

              setTimeout(() => {
                if (inlineProgress) inlineProgress.style.display = 'none';
                if (inlineReport) inlineReport.style.display = 'block';
                window.renderAuditResults(data);
              }, 300);
            })
            .catch(err => {
              alert("Tahlilda xatolik yuz berdi: " + err.message);
              if (btn) {
                btn.style.background = "linear-gradient(135deg, #f472b6, #db2777)";
                btn.style.opacity = "1";
                btn.style.pointerEvents = "auto";
                btn.innerHTML = btn.dataset.origHtml || "🚀 Skanerlash va AI Bazasini Yaratish";
              }
            });
          }
        }, 400);
      };

      window.renderAuditResults = function(data) {
        window.currentAuditFullText = data.fullText || "";

        const b2 = document.getElementById('inlineScoreBadge');
        if (b2) {
          if (data.competitor) {
            b2.innerText = "🔍 Raqobatchi tahlili";
            b2.style.background = "#7c3aed";
          } else {
            b2.innerText = "AI Tayyorgarlik: " + data.score + "%";
            b2.style.background = "#10b981";
          }
        }

        const gapsLabel = data.competitor ? "🔍 Kuzatuvlar:" : "⚠️ Kamchilik va Muammolar:";
        const recsLabel = data.competitor ? "💡 Sizning biznesingiz uchun maslahatlar:" : "💡 Sotuv Tavsiyalari:";
        const inlineContent = document.getElementById('inlineAuditReportContent');
        if (inlineContent) {
          inlineContent.innerHTML = "<b>" + (data.competitor ? "🔍 Tahlil qilingan akkaunt:" : "📷 Profil:") + "</b> @" + data.handle + "<br><br><b>" + gapsLabel + "</b><br>" + data.gaps + "<br><br><b>" + recsLabel + "</b><br>" + data.recs;
        }

        // Raqobatchi tahlili SIZNING mijozlarga ko'rinadigan AI Bilimlar Bazangizga
        // aralashib qolmasligi kerak (mijoz bilan suhbatda raqobatchi haqida gapirib
        // yubormasligi uchun) — shu sabab "Bazaga saqlash" tugmasi faqat o'z profilingiz
        // tahlil qilinganda ko'rsatiladi.
        const btnApply = document.getElementById('btnApplyAudit');
        if (btnApply) btnApply.style.display = data.competitor ? "none" : "block";
      };

      window.applyInlineAuditToTextarea = function() {
        if (window.currentAuditFullText) {
          const textarea = document.getElementById('bizInfo');
          if (textarea) {
            textarea.value = (textarea.value.trim() + window.currentAuditFullText).trim();
            const form = textarea.closest('form');
            if (form) form.submit();
          }
        }
      };
    </script>

    <!-- Profil Card -->
    <div class="card">
      <div style="display:flex;align-items:center;gap:18px">
        <div class="av" style="width:60px;height:60px;font-size:24px;border-radius:12px;background:var(--brand-grad);display:grid;place-items:center;color:#fff;font-weight:800">${esc(initial)}</div>
        <div>
          <h1 style="margin:0;font-size:24px">${esc(u.businessName || "Biznesim")}</h1>
          <p class="hint" style="margin:4px 0 0">${esc(u.email)}</p>
        </div>
      </div>
    </div>

    <!-- Mukammal AI O'rgatish Qo'llanmasi Banner (Universal All Roles) -->
    <div class="card" style="background: linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(14,165,233,0.12) 100%); border:1px solid rgba(124,58,237,0.3)">
      <div style="display:flex; justify-content:space-between; align-items:center">
        <div>
          <b style="color:#a78bfa; font-size:16px">📘 Sun'iy Intellektni Mukammal O'rgatish Qo'llanmasi (Barcha Sohalar Uchun)</b>
          <p class="hint" style="margin:4px 0 0; font-size:13px; color:#cbd5e1">
            Shifokor, Usta, O'quv markaz, Bloger, Tashkilot va Savdo egalari uchun 4 oltin qoida:
          </p>
        </div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top:14px">
        <div style="background:#0f172a; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); font-size:12.5px">
          <b style="color:#fff">1. Xizmatlar & Narxlar:</b><br><span style="color:#94a3b8">Konsultatsiya, darslar, smeta yoki xizmat narxlarini yozing.</span>
        </div>
        <div style="background:#0f172a; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); font-size:12.5px">
          <b style="color:#fff">2. Manzil, Qabul & Vaqt:</b><br><span style="color:#94a3b8">Ish soatlari, uchrashuv/qabul tartibi hamda manzil.</span>
        </div>
        <div style="background:#0f172a; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); font-size:12.5px">
          <b style="color:#fff">3. Aloqa & Shartlar:</b><br><span style="color:#94a3b8">Telefon, Telegram yoki to'lov/nasiya shartlari.</span>
        </div>
        <div style="background:#0f172a; padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); font-size:12.5px">
          <b style="color:#fff">4. Operator / Tirik Muloqot:</b><br><span style="color:#94a3b8">Mijoz "operator" desa yoki murakkab savolda inson uladi.</span>
        </div>
      </div>
    </div>

    <!-- AI Business Training Studio -->
    <div class="card" id="ai-train" style="border: 2px solid #7c3aed">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px">
        <div>
          <h2 style="margin:0; font-size:22px">🧠 AI Biznes O'rgatish Studiyasi (AI Knowledge Studio)</h2>
          <p class="hint">Sun'iy Intellekt mijozlar bilan muloqotda ushbu ma'lumotlarga tayanadi.</p>
        </div>
        <span class="status-tag">✨ Obunext</span>
      </div>

      <!-- Instagram AI Profile Scanner Box -->
      <div style="background:#0f172a; padding:16px; border-radius:12px; border:1px solid rgba(244,114,182,0.3); margin-bottom:18px">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px">
          <div>
            <b style="color:#f472b6; font-size:15px">🔍 Instagram Sahifasini AI Tahlil Qilish & Bilimlar Bazasini Avto-Yaratish</b>
            <p class="hint" style="margin:2px 0 0; font-size:12.5px; color:#cbd5e1">
              O'z akkauntingizni tahlil qilib, kamchilik va sotuv tavsiyalarini AI Bilimlar Bazasiga qo'shing — YOKI istalgan boshqa ochiq biznes akkaunt (masalan raqobatchi) nomini kiritib, undan nima o'rganish mumkinligini bilib oling. Ishlashi uchun avval o'z Instagram akkauntingiz ulangan bo'lishi kerak.
            </p>
          </div>
          <span class="status-tag" style="background:rgba(244,114,182,0.2); color:#f472b6; border-color:rgba(244,114,182,0.4)">✨ AI Avto-Skaner</span>
        </div>

        <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap">
          <input type="text" id="igHandleInputField" placeholder="O'zingiz yoki raqobatchi: @nur_fashion yoki https://instagram.com/nur_fashion" value="${esc(u.meta?.igUsername ? '@' + u.meta.igUsername : '')}" style="flex:1; min-width:240px; margin:0; background:#1e293b; border:1px solid rgba(255,255,255,0.15); font-size:13.5px">
          <span id="btnScanIg" onclick="event.preventDefault(); window.startInlineIgAudit(); return false;" class="btn" style="padding:8px 20px; font-size:13px; margin:0; cursor:pointer; background:linear-gradient(135deg,#f472b6,#db2777)">
            🚀 Skanerlash va AI Bazasini Yaratish
          </span>
        </div>

        <!-- INLINE PROGRESS AND AUDIT REPORT BOX (100% VISIBLE ALWAYS) -->
        <div id="inlineAuditStatusBox" style="display:none; margin-top:16px; background:#1e293b; padding:16px; border-radius:10px; border:1px solid rgba(124,58,237,0.4)">
          <div id="inlineProgressArea">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
              <span id="inlineStatusText" style="font-weight:700; color:#fff; font-size:13.5px">⏳ Skanerlash boshlanmoqda...</span>
              <b id="inlinePercentText" style="color:#a78bfa; font-size:15px">0%</b>
            </div>
            <div style="background:#0f172a; border-radius:20px; height:12px; overflow:hidden; border:1px solid rgba(255,255,255,0.1)">
              <div id="inlineProgressBar" style="width:0%; height:100%; background:linear-gradient(90deg,#7c3aed,#f472b6,#34d399); transition:width 0.3s ease; border-radius:20px"></div>
            </div>
          </div>

          <div id="inlineReportArea" style="display:none; margin-top:14px">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
              <b style="color:#34d399; font-size:15px">✅ AI Tahlil Hisoboti Tayyor!</b>
              <span id="inlineScoreBadge" style="background:#10b981; color:#fff; padding:3px 10px; border-radius:15px; font-size:12px; font-weight:800">AI Tayyorgarlik: 85%</span>
            </div>
            <div id="inlineAuditReportContent" style="background:#0f172a; padding:12px; border-radius:8px; font-size:13px; color:#cbd5e1; white-space:pre-wrap; border:1px solid rgba(255,255,255,0.08); max-height:280px; overflow-y:auto"></div>
            
            <span id="btnApplyAudit" onclick="event.preventDefault(); window.applyInlineAuditToTextarea(); return false;" class="btn" style="margin-top:12px; width:100%; padding:10px; font-size:13.5px; cursor:pointer; background:linear-gradient(135deg,#7c3aed,#db2777); display:block; text-align:center">
              💾 Ushbu Tahlil va Tavsiyalarni AI Bilimlar Bazasiga Qo'shish & Saqlash
            </span>
          </div>
        </div>
      </div>

      <form method="post" action="/settings/business">
        <label>Biznesingiz nomi</label>
        <input name="businessName" value="${esc(u.businessName || "")}" placeholder="Masalan: Nur Fashion Store" required>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; flex-wrap:wrap; gap:8px">
          <label style="margin:0">📚 Bilimlar Bazasi Hujjatlari & Ma'lumotlar (${(u.businessInfo || "").length} ta belgi)</label>
          <div style="display:flex; gap:6px; flex-wrap:wrap">
            <select onchange="if(this.value){window.applyTemplate(this.value); this.value='';}" style="padding:4px 10px; font-size:11.5px; margin:0; width:auto; height:auto; background:#1e293b; border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; cursor:pointer">
              <option value="">📋 Namunadan boshlash...</option>
              <option value="shop">🛍️ Do'kon / Kiyim-kechak</option>
              <option value="restaurant">🍽️ Restoran / Kafe</option>
              <option value="clinic">🩺 Tibbiyot / Klinika</option>
              <option value="education">🎓 O'quv markazi</option>
              <option value="electronics">📱 Elektronika do'koni</option>
              <option value="construction">🏗️ Qurilish / Usta</option>
              <option value="blogger">📸 Bloger / Ekspert</option>
              <option value="organization">🏢 Tashkilot</option>
            </select>
            <a href="/ai-learn" class="btn" style="padding:4px 10px; font-size:11.5px; margin:0">🧠 Instagram'dan o'rgatish</a>
            <span id="btnPreviewKb" class="btn secondary" onclick="event.preventDefault(); window.togglePreviewKnowledge(); return false;" style="padding:4px 10px; font-size:11.5px; margin:0; cursor:pointer">👁️ Ko'rish (Preview)</span>
            <span id="btnAddSection" class="btn secondary" onclick="event.preventDefault(); window.appendKnowledgeSection(); return false;" style="padding:4px 10px; font-size:11.5px; margin:0; cursor:pointer">➕ Bo'lim Qo'shish</span>
            <span id="btnClearKb" class="btn secondary" onclick="event.preventDefault(); window.clearKnowledgeBase(); return false;" style="padding:4px 10px; font-size:11.5px; margin:0; color:#f87171; cursor:pointer">🗑️ Barchasini O'chirish</span>
          </div>
        </div>

        <div id="knowledgePreviewBox" style="display:none; margin-top:10px"></div>

        <textarea name="businessInfo" id="bizInfo" rows="12" style="margin-top:8px; font-family:monospace; font-size:13.5px" placeholder="Bu yerga mahsulotlaringiz, narxlar, manzil, yetkazib berish va tez-tez beriladigan savollarga javoblarni kiriting...">${esc(u.businessInfo || "")}</textarea>

        <!-- Obunext Reasoning Mode Toggle -->
        <div style="background:#0f172a; padding:14px 16px; border-radius:10px; border:1px solid rgba(124,58,237,0.3); margin-top:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px">
          <div>
            <b style="color:#a78bfa; font-size:14.5px">🧠 Obunext Erkin Fikrlash & Intellekt Rejimi</b>
            <p class="hint" style="margin:2px 0 0; font-size:12px; color:#94a3b8">
              <b>Yoqilgan (ON)</b>: AI o'z intellekti bilan mantiqiy fikrlaydi va mijozga aql bilan maslahat beradi.<br>
              <b>O'chirilgan (OFF - Qat'iy Rejim)</b>: AI faqat va faqat kiritilgan bilimlar bazasi doirasida cheklanib javob beradi.
            </p>
          </div>
          <label style="display:inline-flex; align-items:center; cursor:pointer; margin:0">
            <input type="checkbox" name="creativeReasoning" value="1" ${u.settings?.creativeReasoning !== false ? "checked" : ""} style="width:20px; height:20px; accent-color:#7c3aed">
            <span style="margin-left:8px; font-weight:700; color:#fff">Yoqilgan</span>
          </label>
        </div>

        <!-- Document File Upload Training Dropzone -->
        <div style="background:#0f172a; border:2px dashed rgba(124,58,237,0.4); padding:18px; border-radius:12px; margin-top:16px; text-align:center" ondragover="event.preventDefault()" ondrop="event.preventDefault(); handleDocFileUpload(event.dataTransfer ? event.dataTransfer.files : null)">
          <div style="font-size:28px; margin-bottom:4px">📄</div>
          <b style="color:#fff; font-size:14.5px">Word, PDF, TXT Fayli Orqali AI Bilimlar Bazasini Boyitish</b>
          <p class="hint" style="margin:4px 0 12px; font-size:12.5px">
            Kataloglar, qo'llanmalar va narxnomalar (.docx, .pdf, .txt) fayllaringizni shu yerga tashlang yoki tugmani bosing:
          </p>
          <input type="file" id="docFileInput" accept=".txt,.pdf,.docx,.md,.json,.csv" style="display:none" onchange="handleDocFileUpload(this.files)">
          <button type="button" onclick="document.getElementById('docFileInput').click()" class="btn secondary" style="padding:8px 20px; font-size:13px; margin:0">
            📁 Hujjat Faylini Tanlash (Word, PDF, TXT)
          </button>
          <div id="fileUploadStatus" style="margin-top:8px; font-size:12.5px; font-weight:700"></div>
        </div>

        <button type="submit" class="btn" style="margin-top:16px; width:100%; padding:12px; font-size:15px; background:linear-gradient(135deg,#7c3aed,#db2777)">
          💾 AI Bilimlar Bazasini Saqlash
        </button>
      </form>

      <!-- Live AI Sandbox / Test Simulator -->
      <div style="margin-top:28px; padding-top:20px; border-top:1px solid #334155">
        <h3>🧪 Real-Time AI Sinov Poligoni (AI Simulator)</h3>
        <p class="hint">O'rgatilgan AI mijozlarga qanday javob berishini hozirning o'zida sinab ko'ring:</p>

        <div style="display:flex; gap:10px; margin-top:12px">
          <input type="text" id="simQuestion" placeholder="Masalan: Narxlar qancha? Manzilingiz qayerda?" autocomplete="off" onkeypress="if(event.key==='Enter'){runAiSimulation();}">
          <button type="button" onclick="runAiSimulation()" class="btn secondary" style="margin:0; padding:10px 20px">Sinash ➔</button>
        </div>

        <div id="simResult" style="display:none; margin-top:14px; padding:14px; border-radius:10px; background:#0f172a; border:1px solid #7c3aed">
          <b style="color:#a78bfa; font-size:12px">🤖 AI JAVOBI:</b>
          <div id="simReplyText" style="margin-top:6px; font-size:14.5px; color:#fff"></div>
        </div>
      </div>
    </div>

    <!-- Telegram Bot Channel Integration -->
    <div class="card" style="border:1px solid #229ED9">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px">
        <div style="display:flex; align-items:center; gap:12px">
          ${brandIcon("telegram", { size: 30 })}
          <div>
            <h2 style="margin:0">Telegram Bot Kanalini Ulash (Telegram Channel)</h2>
            <p class="hint">O'zingizning shaxsiy Telegram botingizni ulashingiz va Telegram mijozlariga ham bot orqali javob berishingiz mumkin.</p>
          </div>
        </div>
        ${u.settings?.telegramBotToken ? `<span class="status-tag">✅ Telegram Ulangan</span>` : `<span class="badge-warn">Kutilmoqda</span>`}
      </div>

      <form method="post" action="/settings/telegram-bot">
        <label>Telegram Bot Token (@BotFather'dan olingan)</label>
        <input name="telegramBotToken" value="${esc(u.settings?.telegramBotToken || "")}" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ">

        <button type="submit" class="btn" style="margin-top:14px; background:linear-gradient(135deg, #229ED9 0%, #0088cc 100%)">
          ⚡ Webhookni O'rnatish & Saqlash
        </button>
      </form>
    </div>

    <!-- Telegram Business (egasining shaxsiy akkauntidan AI javob) -->
    <div class="card" id="tg-business" style="border:1px solid rgba(34,158,217,0.5)">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap">
        <div>
          <h2 style="margin:0">💼 Telegram Business — shaxsiy akkauntingizdan AI javob</h2>
          <p class="hint" style="margin:4px 0 0">Mijozlar sizning shaxsiy Telegram'ingizga yozadi, AI esa sizning nomingizdan javob beradi. Siz o'zingiz yozsangiz, bot shu chatda 2 soat jim turadi.</p>
        </div>
        ${u.tgBusiness?.enabled
          ? `<span class="status-tag">✅ Ulangan${u.tgBusiness.ownerName ? `: ${esc(u.tgBusiness.ownerName)}` : ""}</span>`
          : `<span class="badge-warn">Ulanmagan</span>`}
      </div>
      ${u.tgBusiness?.enabled && !u.tgBusiness.canReply ? `<div class="error" style="margin-top:10px">Botga "Xabarlarga javob berish" ruxsati berilmagan — Telegram → Business → Chatbots'da yoqing.</div>` : ""}
      <ol class="hint" style="font-size:13px; line-height:1.8; padding-left:18px; margin:12px 0">
        <li>Yuqorida Telegram botingizni ulang (webhook o'rnatilgan bo'lishi kerak).</li>
        <li>Telegram → <b>Sozlamalar → Telegram Business → Chatbotlar</b> (Telegram Premium talab qilinadi).</li>
        <li>Bot username'ini kiriting${u.settings?.telegramBotUsername ? `: <b>@${esc(u.settings.telegramBotUsername)}</b>` : ""} va <b>"Xabarlarga javob berish"</b> ruxsatini yoqing.</li>
        <li>Qaysi chatlarga javob berishini tanlang (hammasi yoki tanlanganlar) — shu sahifada holat "Ulangan" bo'ladi.</li>
      </ol>
      <form method="post" action="/settings/telegram-business" style="margin:0">
        <label style="display:flex; gap:8px; align-items:center; cursor:pointer; text-transform:none; letter-spacing:0; font-size:14px; font-weight:600">
          <input type="checkbox" name="autoReply" ${u.tgBusiness?.autoReply !== false ? "checked" : ""} style="width:auto; margin:0"> AI avtomatik javob bersin
        </label>
        <button class="btn" style="margin-top:10px">💾 Saqlash</button>
      </form>
    </div>

    <!-- Telegram Admin Bildirishnomalar Bot (Lead & Handoff Alerts) -->
    <div class="card" style="border:1px solid #a855f7; background:linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(34,158,217,0.08) 100%)">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <div>
          <h2 style="margin:0; color:#fff">🔔 Telegram Admin Bildirishnomalar Boti (Hot Leads & Handoff)</h2>
          <p class="hint">Haridorlar (Hot Leads) va operator chaqiruvlari haqida shaxsiy Telegram'ingizga soniyalarda tezkor xabarnoma olish.</p>
        </div>
        ${u.settings?.telegramChatId ? `<span class="status-tag">✅ Bildirishnomalar Yoqilgan</span>` : `<span class="badge-warn">Kutilmoqda</span>`}
      </div>

      <form method="post" action="/settings/telegram-admin">
        <label>Sizning Shaxsiy Telegram Chat ID'ingiz (Masalan: 123456789)</label>
        <input name="telegramChatId" value="${esc(u.settings?.telegramChatId || "")}" placeholder="Masalan: 987654321">
        <p class="hint" style="font-size:12px; margin-top:4px">
          Chat ID ni bilish uchun Telegram'da <a href="https://t.me/userinfobot" target="_blank" style="color:#38bdf8; text-decoration:underline">@userinfobot</a> ga kiring va berilgan ID raqamni nusxalab shu yerga kriting.
        </p>

        <button type="submit" class="btn" style="margin-top:12px; background:linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)">
          🔔 Telegram Bildirishnomalarni Saqlash
        </button>
      </form>
    </div>

    <!-- WhatsApp Business API Integration -->
    <div class="card" style="border:1px solid #25D366">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px">
        <div style="display:flex; align-items:center; gap:12px">
          ${brandIcon("whatsapp", { size: 30 })}
          <div>
            <h2 style="margin:0">WhatsApp Business Cloud API Ulash</h2>
            <p class="hint">Meta WhatsApp Business Cloud API orqali mijozlar bilan rasmiy WhatsApp botini ishga tushirish.</p>
          </div>
        </div>
        ${u.meta?.whatsappToken ? `<span class="status-tag" style="background:rgba(37,211,102,0.15); color:#4ade80; border-color:rgba(37,211,102,0.3)">✅ WhatsApp Ulangan</span>` : `<span class="badge-warn">Kutilmoqda</span>`}
      </div>

      <form method="post" action="/settings/whatsapp">
        <div class="grid cols-2" style="gap:12px; margin-bottom:0">
          <div>
            <label>Phone Number ID</label>
            <input name="whatsappPhoneId" value="${esc(u.meta?.whatsappPhoneId || "")}" placeholder="Masalan: 105948372619485">
          </div>
          <div>
            <label>WABA ID (WhatsApp Business Account ID)</label>
            <input name="whatsappBusinessId" value="${esc(u.meta?.whatsappBusinessId || "")}" placeholder="Masalan: 987654321012345">
          </div>
        </div>
        <label style="margin-top:10px">Permanent Access Token (Meta Developer Console)</label>
        <input name="whatsappToken" type="password" value="${esc(u.meta?.whatsappToken || "")}" placeholder="EAAX...">

        <button type="submit" class="btn" style="margin-top:14px; background:linear-gradient(135deg, #25D366 0%, #128C7E 100%)">
          WhatsApp Sozlamalarini Saqlash
        </button>
      </form>
    </div>

    <!-- Facebook Messenger Integration -->
    <div class="card" style="border:1px solid #0084FF">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <div style="display:flex; align-items:center; gap:12px">
          ${brandIcon("facebook", { size: 30 })}
          <div>
            <h2 style="margin:0">Facebook Messenger Sahifasini Ulash</h2>
            <p class="hint">Facebook Page Messenger orqali keladigan barcha chatlarni AI va operatorga avtomatik biriktiring.</p>
          </div>
        </div>
        ${u.meta?.pageAccessToken ? `<span class="status-tag" style="background:rgba(0,132,255,0.15); color:#60a5fa; border-color:rgba(0,132,255,0.3)">✅ Facebook Ulangan</span>` : `<span class="badge-warn">Kutilmoqda</span>`}
      </div>

      <form method="post" action="/settings/facebook">
        <label>Facebook Page ID</label>
        <input name="pageId" value="${esc(u.meta?.pageId || "")}" placeholder="Masalan: 109283746501928">
        <label style="margin-top:10px">Page Access Token</label>
        <input name="pageAccessToken" type="password" value="${esc(u.meta?.pageAccessToken || "")}" placeholder="EAAX...">

        <button type="submit" class="btn" style="margin-top:14px; background:linear-gradient(135deg, #0084FF 0%, #00C6FF 100%)">
          Facebook Sozlamalarini Saqlash
        </button>
      </form>
    </div>

    <!-- Parol o'zgartirish -->
    <div class="card">
      <h2>🔒 Parolni o'zgartirish</h2>
      <form method="post" action="/account/password">
        <label>Joriy parol</label>
        <input name="oldPassword" type="password" required placeholder="••••••••">
        <label>Yangi parol (kamida 6 belgi)</label>
        <input name="newPassword" type="password" required minlength="6" placeholder="••••••••">
        <button class="secondary" style="margin-top:14px">O'zgartirish</button>
      </form>
    </div>

    <script>
      async function handleDocFileUpload(files) {
        if (!files || !files.length) return;
        const file = files[0];
        const statusEl = document.getElementById('fileUploadStatus');
        statusEl.style.color = "";
        statusEl.innerText = "⏳ Fayl o'qilmoqda: " + file.name;

        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch('/account/upload-document', { method: 'POST', body: formData });
          const data = await res.json();

          if (!data.ok) {
            statusEl.style.color = "#f87171";
            statusEl.innerText = "❌ " + (data.error || "Faylni o'qib bo'lmadi.");
            return;
          }

          const textarea = document.getElementById('bizInfo');
          const header = "\n\n--- 📄 [HUJJAT: " + data.filename + "] ---\n";
          textarea.value = (textarea.value.trim() + header + data.text.replace(/\r\n/g, "\n")).trim();

          statusEl.style.color = "#34d399";
          statusEl.innerText = '✅ "' + data.filename + '" fayli matni bilimlar bazasiga muvaffaqiyatli qo\'shildi! Pastdagi "Saqlash" tugmasini bosing.';
        } catch (err) {
          statusEl.style.color = "#f87171";
          statusEl.innerText = "Faylni yuklashda xato yuz berdi: " + err.message;
        }
      }

      async function runAiSimulation() {
        const q = document.getElementById('simQuestion').value.trim();
        if (!q) return;

        const resBox = document.getElementById('simResult');
        const txtBox = document.getElementById('simReplyText');
        resBox.style.display = 'block';
        txtBox.innerText = "⏳ AI javob o'ylamoqda...";

        try {
          const res = await fetch('/account/ai-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testQuestion: q })
          });
          const data = await res.json();
          txtBox.innerText = data.reply || "Javob olib bo'lmadi";
        } catch(err) {
          txtBox.innerText = "Xato yuz berdi: " + err.message;
        }
      }
    </script>
    `,
    { user: u, active: "account" }
  );
}

// ==== Admin panel (dasturchi) — barcha bizneslarni sozlash ====

// Kanallarni uzish (Unlink / Disconnect handlers)
web.post("/connect/instagram/unlink", requireAuth, async (req, res) => {
  await updateUser(req.user.id, {
    meta: { ...(req.user.meta || {}), igAccessToken: "", igUserId: "", igUsername: "", pageAccessToken: "", pageId: "" },
  });
  res.redirect("/dashboard?okMsg=" + encodeURIComponent("Instagram Direct akkaunti uzildi!"));
});

web.post("/connect/telegram/unlink", requireAuth, async (req, res) => {
  const settings = { ...(req.user.settings || {}), telegramBotToken: "", telegramWebhookSet: false };
  await updateUser(req.user.id, { settings });
  res.redirect("/dashboard?okMsg=" + encodeURIComponent("Telegram bot uzildi!"));
});

web.post("/connect/whatsapp/unlink", requireAuth, async (req, res) => {
  await updateUser(req.user.id, {
    meta: { ...(req.user.meta || {}), whatsappToken: "", whatsappPhoneId: "", whatsappBusinessId: "", whatsappPhoneNumberId: "" },
  });
  res.redirect("/dashboard?okMsg=" + encodeURIComponent("WhatsApp akkaunti uzildi!"));
});

web.post("/connect/facebook/unlink", requireAuth, async (req, res) => {
  await updateUser(req.user.id, {
    meta: { ...(req.user.meta || {}), pageAccessToken: "", pageId: "" },
  });
  res.redirect("/dashboard?okMsg=" + encodeURIComponent("Facebook sahifasi uzildi!"));
});

// Instagram AI Audit & Score Engine Endpoint
web.post("/account/scan-instagram-audit", requireAuth, async (req, res) => {
  const u = req.user;
  const token = u.meta?.igAccessToken || u.meta?.pageAccessToken;
  const igUserId = u.meta?.igUserId || u.meta?.pageId;

  // Meta Graph API hech qanday tokensiz ishlamaydi — demak ulanmagan akkaunt uchun
  // "tahlil" fabrikatsiya qilib bo'lmaydi. Halol xato qaytaramiz.
  if (!token || !igUserId) {
    return res.json({
      ok: false,
      error: "Haqiqiy tahlil uchun avval Instagram akkauntingizni ulashingiz kerak (\"🔵 Instagram bilan ulash\" tugmasi).",
    });
  }

  // Kiritilgan handle'ni tozalaymiz (@ yoki to'liq instagram.com havolasi bo'lishi mumkin)
  const rawInput = String(req.body?.instagramHandle || "").trim();
  const cleanedInput = rawInput.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "").trim();
  const ownHandle = (u.meta?.igUsername || "").toLowerCase();
  const isCompetitor = Boolean(cleanedInput) && cleanedInput.toLowerCase() !== ownHandle;

  let profile;
  let handle;

  if (isCompetitor) {
    // Business Discovery — ULANGAN akkaunt orqali BOSHQA (masalan raqobatchi)
    // ochiq biznes akkauntining haqiqiy ommaviy ma'lumotini o'qiydi.
    const bd = await getBusinessDiscovery(u, cleanedInput);
    if (bd.error) {
      return res.json({ ok: false, error: "@" + cleanedInput + ": " + (bd.error.message || "ma'lumot topilmadi") });
    }
    profile = bd;
    handle = bd.username || cleanedInput;
  } else {
    // Ulangan akkauntning HAQIQIY profil ma'lumotini Meta Graph API'dan olamiz
    try {
      const url = `https://graph.facebook.com/v21.0/${igUserId}?fields=id,username,name,biography,website,followers_count,media_count&access_token=${token}`;
      const r = await fetch(url);
      profile = await r.json();
      if (!profile || profile.error || !(profile.username || profile.name)) {
        throw new Error(profile?.error?.message || "Profil ma'lumoti topilmadi");
      }
    } catch (err) {
      return res.json({ ok: false, error: "Instagram profil ma'lumotini olib bo'lmadi: " + err.message });
    }
    handle = profile.username || u.meta?.igUsername || "";
  }

  const bioText = `📍 Akkaunt: @${handle}\n📝 Bio: ${profile.biography || "(kiritilmagan)"}\n🌐 Veb-sayt: ${profile.website || "(yo'q)"}\n👥 Obunachilar: ${profile.followers_count ?? "?"} ta\n📸 Postlar: ${profile.media_count ?? "?"} ta`;

  let score, gapsArr, recsArr;

  // Iloji bo'lsa — HAQIQIY AI (Gemini) tahlili, olingan real ma'lumotlarga asoslanib
  const platformKey = await getPlatformGeminiKey();
  const geminiKey = u.geminiApiKey || platformKey || process.env.GEMINI_API_KEY;

  if (geminiKey) {
    try {
      const auditPrompt = isCompetitor
        ? `Instagram profil ma'lumotlari (haqiqiy, Meta Graph API "Business Discovery" orqali hozir olingan — bu SO'ROVCHI TADBIRKORNING EMAS, boshqa/raqobatchi akkauntning ommaviy ma'lumoti):
${bioText}

So'rovchi tadbirkorning o'z biznes ma'lumoti:
${u.businessInfo || "(hali kiritilmagan)"}

Vazifa: yuqoridagi akkauntning HAQIQIY ommaviy ma'lumotlariga tayanib, nima e'tiborga loyiqligini kuzatib, so'rovchi tadbirkor buni o'z biznesida qanday qo'llashi mumkinligi haqida amaliy maslahat ber. Aynan quyidagi formatda javob ber (boshqa hech narsa qo'shma):
INSIGHTS:
- <kuzatuv 1>
- <kuzatuv 2>
RECS:
- <maslahat 1>
- <maslahat 2>`
        : `Instagram profil ma'lumotlari (haqiqiy, Meta Graph API orqali hozir olingan):
${bioText}

AI Bilimlar Bazasi (tadbirkorning o'zi kiritgan ma'lumoti):
${u.businessInfo || "(hali kiritilmagan)"}

Vazifa: yuqoridagi HAQIQIY ma'lumotlarga tayanib, ushbu Instagram biznes profilini AI-avtomatlashtirish uchun qanchalik tayyorligini baholab, aynan quyidagi formatda javob ber (boshqa hech narsa qo'shma, izoh yozma):
SCORE: <0 dan 100 gacha son>
GAPS:
- <kamchilik 1>
- <kamchilik 2>
RECS:
- <tavsiya 1>
- <tavsiya 2>`;

      const aiText = await askGemini(
        geminiKey,
        "Sen tajribali Instagram va sotuv auditchisisan. Faqat berilgan haqiqiy ma'lumotlarga tayanib javob ber, hech narsani o'ylab topma yoki fabrikatsiya qilma.",
        [],
        auditPrompt,
        []
      );

      const scoreMatch = aiText.match(/SCORE:\s*(\d{1,3})/i);
      const gapsMatch = aiText.match(/(?:GAPS|INSIGHTS):\s*([\s\S]*?)(?:RECS:|$)/i);
      const recsMatch = aiText.match(/RECS:\s*([\s\S]*)/i);

      if (isCompetitor ? gapsMatch : scoreMatch) {
        if (scoreMatch) score = Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10)));
        gapsArr = (gapsMatch?.[1] || "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-")).map((l) => "• " + l.slice(1).trim());
        recsArr = (recsMatch?.[1] || "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-")).map((l) => "• " + l.slice(1).trim());
      }
    } catch (err) {
      console.error("IG audit AI xatosi:", err.message);
    }
  }

  // AI ishlamagan yoki javobni ajratib bo'lmagan bo'lsa — faqat HAQIQIY signallarga
  // asoslangan qoidaviy baho (hech qanday o'ylab topilgan da'vo yo'q)
  if (!gapsArr || !recsArr) {
    gapsArr = [];
    recsArr = [];
    if (isCompetitor) {
      // Raqobatchi haqida "kamchilik" o'ylab topib bo'lmaydi — faqat real, ochiq
      // ma'lumotlarga asoslangan halol kuzatuv beramiz (AI ishlamasa).
      gapsArr.push(`• @${handle}: ${profile.followers_count ?? "?"} obunachi, ${profile.media_count ?? "?"} post (ochiq ma'lumot).`);
      if (profile.website) gapsArr.push("• Profilda veb-sayt havolasi bor.");
      recsArr.push("• Chuqurroq tahlil uchun AI kalitini (Gemini) sozlang — hozircha faqat asosiy statistikaga asoslangan xulosa.");
    } else {
      score = 50;
      if (!u.businessInfo || u.businessInfo.length < 50) {
        gapsArr.push("• Bilimlar bazasida mahsulot/xizmat va narxlar to'liq yozilmagan.");
        recsArr.push("• Har bir xizmat va mahsulot narxlarini AI Bilimlar Bazasiga kiriting.");
      } else {
        score += 20;
      }
      if (!profile.biography) {
        gapsArr.push("• Instagram bio (profil tavsifi) to'ldirilmagan.");
      } else {
        score += 10;
      }
      if (!profile.website) {
        gapsArr.push("• Profilda veb-sayt/havola ko'rsatilmagan.");
      } else {
        score += 5;
      }
      if (!u.settings?.telegramAdminChatId) {
        gapsArr.push("• Telegram Hot-Lead bildirishnomalar ulanmagan.");
        recsArr.push("• Telegram Chat ID-ingizni ulab, xaridorlar kelganda tezkor bildirishnoma oling.");
      } else {
        score += 5;
      }
      if (gapsArr.length === 0) gapsArr.push("• Profil va bilimlar bazasida jiddiy muammo topilmadi.");
      if (recsArr.length === 0) recsArr.push("• Obunext Erkin Fikrlash rejimini yoqilgan holatda saqlang.");
      score = Math.min(100, score);
    }
  }

  const sectionLabel = isCompetitor ? "KUZATUVLAR" : "KAMCHILIK VA MUAMMOLAR";
  const titleLabel = isCompetitor ? "RAQOBATCHI TAHLILI" : "INSTAGRAM TAHLIL & AI TAVSIYALARI";
  const generatedText = isCompetitor
    ? `\n\n--- 🔍 [${titleLabel}: @${handle}] ---\n${bioText}\n\n📌 ${sectionLabel}:\n${gapsArr.join("\n")}\n\n💡 SIZNING BIZNESINGIZ UCHUN MASLAHATLAR:\n${recsArr.join("\n")}\n`
    : `\n\n--- 📷 [${titleLabel}: @${handle}] ---\n${bioText}\n\n📌 ${sectionLabel}:\n${gapsArr.join("\n")}\n\n💡 SOTUV TAVSIYALARI:\n${recsArr.join("\n")}\n`;

  res.json({
    ok: true,
    competitor: isCompetitor,
    score: isCompetitor ? null : score,
    handle,
    bioText,
    gaps: gapsArr.join("<br>"),
    recs: recsArr.join("<br>"),
    fullText: generatedText,
  });
});

// Telegram Admin Chat ID sozlamasi
web.post("/settings/telegram-admin", requireAuth, async (req, res) => {
  const chatId = String(req.body.telegramChatId || "").trim();
  const u = req.user;
  u.settings ||= {};
  u.settings.telegramAdminChatId = chatId;
  u.settings.telegramChatId = chatId;
  await updateUser(u.id, { settings: u.settings });
  res.redirect("/account?saved=1");
});

