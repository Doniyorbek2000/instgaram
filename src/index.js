import express from "express";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { attachUser } from "./auth.js";
import { site } from "./web/site.js";
import { web } from "./web/routes.js";
import { inboxRouter } from "./web/inbox.js";
import { rulesRouter } from "./web/rules_ui.js";
import { schedulerRouter } from "./web/scheduler_ui.js";
import { templatesRouter } from "./web/templates_ui.js";
import { contactsRouter } from "./web/contacts_ui.js";
import { broadcastsRouter } from "./web/broadcasts_ui.js";
import { growthRouter } from "./web/growth_ui.js";
import { settingsRouter } from "./web/settings_ui.js";
import { flowsRouter } from "./web/flows_ui.js";
import { teamRouter } from "./web/team_ui.js";
import { analyticsRouter } from "./web/analytics_ui.js";
import { gameRouter } from "./web/game_ui.js";
import { formsRouter } from "./web/forms_ui.js";
import { integrationsRouter } from "./web/integrations_ui.js";
import { contentRouter } from "./web/content_ui.js";
import { mediaRouter } from "./web/media_ui.js";
import { aiLearnRouter } from "./web/ai_learn_ui.js";
import { aiSettingsRouter } from "./web/ai_settings_ui.js";
import { mcpHandler } from "./mcp.js";
import { loadPlatformSettings } from "./credits.js";
import { teamContext } from "./team.js";
import { telegramRouter } from "./telegram.js";
import { reportsBotRouter, reportsBotAvailable, setupReportsBotWebhook, checkAndSendDailyReports } from "./reportsBot.js";
import { checkAndPublishScheduledPosts } from "./postPublisher.js";
import { runDueFollowUps } from "./followups.js";
import { runDueBroadcasts } from "./broadcasts.js";
import { refreshTelegramWebhooks } from "./telegram.js";
import { listUsers } from "./db.js";
import { page } from "./web/layout.js";
import { findUserByPlatformId, persist } from "./db.js";
import { handleInstagramEntry } from "./handlers/instagram.js";
import { handleFacebookEntry } from "./handlers/facebook.js";
import { handleWhatsAppEntry } from "./handlers/whatsapp.js";
import { handlePayme, checkPaymeAuth } from "./payme.js";

const app = express();

// Server har doim reverse proxy (nginx/docker) orqasida ishlaydi (docker-compose:
// 127.0.0.1:PORT). Shuning uchun Express'ga bitta ishonchli proksi qatlami borligini
// aytamiz — shundagina req.ip proksi qo'shgan X-Forwarded-For'ning to'g'ri (chap
// tomondagi eng oxirgi ishonchli) qiymatini oladi, mijoz o'zi headerni soxtalab
// rate-limit'ni chetlab o'ta olmaydi. Kerak bo'lsa .env orqali sozlanadi.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

// Imzo tekshiruvi uchun so'rovning xom (raw) tanasini saqlab qo'yamiz
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));
app.use(attachUser);
// Jamoa a'zosi egasining ish maydonida bo'lsa — req.user almashtiriladi va roli tekshiriladi
app.use(teamContext);

// SEO: Robots.txt & XML Sitemap for Google Search Indexing
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain");
  res.send("User-agent: *\nAllow: /\nSitemap: https://chat.voxo.uz/sitemap.xml\n");
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://chat.voxo.uz/</loc><priority>1.0</priority><changefreq>daily</changefreq></url>
  <url><loc>https://chat.voxo.uz/features</loc><priority>0.9</priority><changefreq>weekly</changefreq></url>
  <url><loc>https://chat.voxo.uz/pricing</loc><priority>0.9</priority><changefreq>weekly</changefreq></url>
  <url><loc>https://chat.voxo.uz/faq</loc><priority>0.8</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://chat.voxo.uz/contact</loc><priority>0.8</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://chat.voxo.uz/login</loc><priority>0.6</priority><changefreq>monthly</changefreq></url>
  <url><loc>https://chat.voxo.uz/register</loc><priority>0.6</priority><changefreq>monthly</changefreq></url>
</urlset>`);
});

// Google Search Console Site Verification
app.get("/google954f397ce1b4faab.html", (_req, res) => {
  res.type("text/html");
  res.send("google-site-verification: google954f397ce1b4faab.html");
});

// Ijtimoiy tarmoqlarda havola ulashilganda ko'rinadigan rasm (og:image).
// scripts/generate-og-image.mjs orqali oldindan generatsiya qilingan, statik
// fayl sifatida xotirada bir marta o'qib, keyingi so'rovlarga qayta beriladi.
const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const ogImageBuffer = readFileSync(path.join(assetsDir, "og-image.png"));
const faviconBuffer = readFileSync(path.join(assetsDir, "favicon.png"));

app.get("/og-image.png", (_req, res) => {
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(ogImageBuffer);
});

// Data: URI favicon'lar o'rniga — ko'p havola-preview bot va qidiruv
// tizimlari data: URI'ni o'qiy olmaydi, haqiqiy statik fayl kerak.
app.get("/favicon.png", (_req, res) => {
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(faviconBuffer);
});

// Publik marketing sayti (ko'p tilli: /, /features, /pricing, /faq, /contact)
app.use(site);

// Veb admin-panel (ro'yxat, kirish, sozlamalar)
app.use(web);
app.use(inboxRouter);
app.use(rulesRouter);
app.use(templatesRouter);
app.use(contactsRouter);
app.use(broadcastsRouter);
app.use(growthRouter);
app.use(settingsRouter);
app.use(schedulerRouter);
app.use(flowsRouter);
app.use(teamRouter);
app.use(analyticsRouter);
app.use(gameRouter);
app.use(formsRouter);
app.use(integrationsRouter);
app.use(contentRouter);
app.use(mediaRouter);
app.use(aiLearnRouter);
app.use(aiSettingsRouter);
app.use(telegramRouter);
app.use(reportsBotRouter);

/** Meta yuborgan X-Hub-Signature-256 imzosini tekshiradi. */
function isValidSignature(req) {
  const secrets = [config.appSecret, process.env.IG_APP_SECRET, process.env.APP_SECRET].filter(Boolean);
  // Hech qanday secret sozlanmagan bo'lsa — so'rovni RAD ETAMIZ (fail-closed).
  // checkConfig() serverni ishga tushirishda buni ogohlantiradi; imzosiz webhook
  // qabul qilish soxta so'rovlarga eshikni ochiq qoldiradi.
  if (!secrets.length) return false;
  const signature = req.get("x-hub-signature-256");
  if (!signature || !req.rawBody) return false;

  for (const secret of secrets) {
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", secret)
        .update(req.rawBody)
        .digest("hex");
    try {
      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        return true;
      }
    } catch {}
  }
  return false;
}


// MCP server (Claude va boshqa AI yordamchilar uchun) — token bilan kirish
app.post(["/mcp", "/mcp/:token"], (req, res) => {
  mcpHandler(req, res).catch((err) => {
    console.error("[MCP] xato:", err.message);
    res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } });
  });
});
app.get(["/mcp", "/mcp/:token"], (_req, res) => res.set("Allow", "POST").status(405).json({ error: "Use POST (MCP Streamable HTTP)" }));

// Server tirikligini tekshirish (monitoring/uptime uchun)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Payme Merchant API (JSON-RPC). Merchant kabinetda Endpoint = https://<domen>/payme
app.post("/payme", async (req, res) => {
  if (!checkPaymeAuth(req.get("authorization"))) {
    return res.json({
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32504,
        message: { ru: "Недостаточно привилегий", uz: "Ruxsat yo'q", en: "Insufficient privileges" },
      },
    });
  }
  // MUHIM: try/catch shart — try/catch bo'lmasa, handlePayme() ichida (masalan
  // Postgres so'rovida) kutilmagan xato chiqsa, bu Express 4'da tutilmagan
  // (unhandled) promise rad etishga aylanadi, Node esa bunday holatda BUTUN
  // serverni yiqitadi (barcha bizneslar uchun, faqat shu to'lov uchun emas).
  let result;
  try {
    result = await handlePayme(req.body);
  } catch (err) {
    console.error("[Payme] Kutilmagan xato:", err);
    result = {
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: { code: -32400, message: { ru: "Системная ошибка", uz: "Tizim xatosi", en: "System error" } },
    };
  }
  // To'lov muammolarini tekshirish uchun: qaysi metod, qaysi account maydoni keldi.
  // Kabinetdagi maydon nomi .env dagi PAYME_ACCOUNT_FIELD bilan mos kelmasa,
  // buyurtma topilmaydi — shuni shu log orqali darrov ko'ramiz.
  console.log(
    `[Payme] ${req.body?.method} | account: ${JSON.stringify(req.body?.params?.account || {})}` +
      ` | summa: ${req.body?.params?.amount ?? "-"}` +
      (result.error ? ` | XATO ${result.error.code}: ${result.error.message?.uz || ""}` : " | OK")
  );
  res.json(result);
});

// Webhook tekshiruvi (Meta Developer panelda "Verify" bosilganda keladi)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && config.verifyToken && token === config.verifyToken) {
    console.log("Webhook muvaffaqiyatli tasdiqlandi ✅");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Kiruvchi hodisa qaysi biznesga (foydalanuvchiga) tegishli ekanini aniqlaydi.
 * Instagram: entry.id = IG akkaunt ID; Page: entry.id = sahifa ID;
 * WhatsApp: metadata.phone_number_id.
 */
async function resolveTenant(object, entry) {
  if (object === "instagram") return await findUserByPlatformId("ig", entry.id);
  if (object === "page") return await findUserByPlatformId("page", entry.id);
  if (object === "whatsapp_business_account") {
    const phoneId = entry.changes?.[0]?.value?.metadata?.phone_number_id;
    return await findUserByPlatformId("whatsapp", phoneId);
  }
  return null;
}

// Barcha platformalardan keladigan hodisalar shu yerga tushadi
app.post("/webhook", async (req, res) => {
  if (!isValidSignature(req)) {
    console.warn("Noto'g'ri webhook imzosi — so'rov rad etildi");
    return res.sendStatus(403);
  }

  // Meta 20 soniya ichida 200 kutadi — avval javob beramiz, keyin ishlaymiz
  res.sendStatus(200);

  const { object, entry = [] } = req.body || {};
  for (const item of entry) {
    // Kiruvchi hodisaning turini qisqacha yozamiz — qaysi maydon kelgani ko'rinib
    // tursin, aks holda tanilmagan hodisa jimgina yo'qoladi va sababini topib
    // bo'lmaydi (Meta hodisa turlarini vaqti-vaqti bilan o'zgartiradi).
    console.log(
      `[Webhook] ${object} | id: ${item.id}` +
        (item.changes ? ` | changes: ${item.changes.map((c) => c.field).join(",")}` : "") +
        (item.messaging ? ` | messaging: ${item.messaging.map((m) => Object.keys(m).filter((k) => k !== "sender" && k !== "recipient" && k !== "timestamp").join("/")).join(",")}` : "")
    );
    const tenant = await resolveTenant(object, item);
    if (!tenant) {
      console.log(
        `Hodisa uchun biznes topilmadi (${object}, id: ${item.id}) — panelda ID'lar to'g'ri kiritilganini tekshiring`
      );
      continue;
    }

    const p =
      object === "instagram"
        ? handleInstagramEntry(tenant, item)
        : object === "page"
          ? handleFacebookEntry(tenant, item)
          : handleWhatsAppEntry(tenant, item);

    p.catch((err) => console.error("Hodisani qayta ishlashda xato:", err));
  }
});

// Topilmagan sahifalar
app.use((req, res) => {
  if (req.accepts("html")) {
    return res
      .status(404)
      .send(
        page(
          "Topilmadi",
          `<div class="card center">
            <h1>404</h1>
            <p>Bunday sahifa topilmadi.</p>
            <p><a href="/">← Bosh sahifa</a></p>
          </div>`,
          { user: req.user }
        )
      );
  }
  res.sendStatus(404);
});

// Ishga tushishdan oldin muhim sozlamalarni tekshiramiz
function checkConfig() {
  const warn = [];
  if (!config.verifyToken) warn.push("VERIFY_TOKEN o'rnatilmagan — webhook tasdiqlanmaydi");
  if (!config.appSecret) warn.push("APP_SECRET yo'q — webhook imzosi tekshirilmaydi (xavfsizlik uchun tavsiya etiladi)");
  if (!config.adminEmails.length) warn.push("ADMIN_EMAILS yo'q — hech kim admin panelga kira olmaydi");
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY)
    warn.push("AI kaliti (GEMINI_API_KEY) yo'q — bot kalit so'z rejimida ishlaydi");
  if (!config.fbAppId || !config.baseUrl)
    warn.push("FB_APP_ID/BASE_URL yo'q — 'Facebook bilan ulash' o'chiq (tokenlar admin panelda qo'lda kiritiladi)");
  for (const w of warn) console.warn("⚠️  " + w);
}

const server = app.listen(config.port, () => {
  checkConfig();
  console.log(`Server ${config.port}-portda ishga tushdi 🚀`);
  console.log(`Admin panel:    http://localhost:${config.port}/`);
  console.log(`Webhook manzil: http://localhost:${config.port}/webhook`);

  if (reportsBotAvailable) {
    setupReportsBotWebhook().catch((err) => console.error("[ReportsBot] webhook o'rnatishda xato:", err.message));
    setInterval(() => {
      checkAndSendDailyReports().catch((err) => console.error("[ReportsBot] kunlik hisobot xatosi:", err.message));
    }, 20 * 60 * 1000);
  }

  // Rejalashtirilgan Instagram postlarini nashr qilish — vaqtga aniqroq mos kelishi
  // kerak bo'lgani uchun kunlik hisobotdan tezroq (har 5 daqiqada) tekshiriladi
  loadPlatformSettings().catch((err) => console.error("[Platforma] sozlamalar:", err.message));

  // Eski (maxfiy kalitsiz) Telegram webhook'larini xavfsiz holatga o'tkazamiz
  setTimeout(() => {
    listUsers().then(refreshTelegramWebhooks).catch((err) => console.error("[Telegram] webhook yangilash:", err.message));
  }, 5000);

  // Obuna eslatmalari va follow-up xabarlar — daqiqa aniqligida
  setInterval(() => {
    runDueFollowUps().catch((err) => console.error("[FollowUp] xato:", err.message));
    runDueBroadcasts().catch((err) => console.error("[Broadcast] xato:", err.message));
  }, 60 * 1000);

  setInterval(() => {
    checkAndPublishScheduledPosts().catch((err) => console.error("[PostPublisher] xato:", err.message));
  }, 5 * 60 * 1000);
});

// Server to'xtatilganda bazani saqlab, tozalab chiqamiz
function shutdown(signal) {
  console.log(`\n${signal} — bazani saqlab, to'xtatilmoqda...`);
  try {
    persist();
  } catch (err) {
    console.error("Saqlashda xato:", err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
