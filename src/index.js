import express from "express";
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
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
import { sequencesRouter } from "./web/sequences_ui.js";
import { shopRouter } from "./web/shop_ui.js";
import { shopPaymentsRouter } from "./shopPayments.js";
import { growthToolsRouter } from "./web/growth_tools_ui.js";
import { pushRouter } from "./web/push_ui.js";
import { adminRouter } from "./admin/routes.js";
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
import { runAutoReels } from "./autoReels.js";
import { runDueFollowUps } from "./followups.js";
import { runDueBroadcasts } from "./broadcasts.js";
import { refreshTelegramWebhooks } from "./telegram.js";
import { listUsers, dbReady, dbStatus, findUserByPlatformId, persist } from "./db.js";
import { enqueueWebhook, finishWebhook, pendingWebhooks, acquireSchedulerLock } from "./pgdb.js";
import { loadSeenEvents, flushSeenEvents } from "./dedup.js";
import { securityHeaders } from "./securityHeaders.js";
import { installProcessHandlers, installLogger, requestLogger, expressErrorHandler, alertAdmin } from "./monitor.js";
import { runIgTokenRefresh } from "./igToken.js";
import { runSubscriptionReminders } from "./lifecycle.js";
import { runDueBackup } from "./backup.js";
import { page } from "./web/layout.js";
import { purgeInternalKeys } from "./outbound.js";
import { linkRedirectHandler } from "./links.js";
import { runDueSequences } from "./sequences.js";
import { runDueShop } from "./shop.js";
import { handleInstagramEntry } from "./handlers/instagram.js";
import { handleFacebookEntry } from "./handlers/facebook.js";
import { handleWhatsAppEntry } from "./handlers/whatsapp.js";
import { handlePayme, checkPaymeAuth } from "./payme.js";
import { adminConfigured } from "./admin/auth.js";
import { csrfGuard } from "./csrf.js";
import { metaCallbacksRouter } from "./metaCallbacks.js";
import { encryptionEnabled } from "./secretBox.js";
import { isProduction } from "./env.js";

installLogger();
installProcessHandlers();

// Qayta ishlanayotgan webhook hodisalari — server to'xtatilganda (deploy) ular tugashini kutamiz
const inflight = new Set();
function track(promise) {
  inflight.add(promise);
  promise.finally(() => inflight.delete(promise));
  return promise;
}

// Admin panel faqat shu domenda ochiladi (masalan adm.obunext.uz). Bo'sh bo'lsa — cheklov yo'q.
const ADMIN_HOST = String(process.env.ADMIN_HOST || "").toLowerCase().trim();
// Asosiy (marketing/kabinet) domeni — /admin so'ralsa admin domeniga yo'naltiriladi
const MAIN_HOST = (() => {
  try {
    return new URL(config.baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
})();

const app = express();
app.disable("x-powered-by");
app.use(requestLogger);
app.use(securityHeaders);

// Server har doim reverse proxy (nginx/docker) orqasida ishlaydi (docker-compose:
// 127.0.0.1:PORT). Shuning uchun Express'ga bitta ishonchli proksi qatlami borligini
// aytamiz — shundagina req.ip proksi qo'shgan X-Forwarded-For'ning to'g'ri (chap
// tomondagi eng oxirgi ishonchli) qiymatini oladi, mijoz o'zi headerni soxtalab
// rate-limit'ni chetlab o'ta olmaydi. Kerak bo'lsa .env orqali sozlanadi.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));

// Imzo tekshiruvi uchun so'rovning xom (raw) tanasini saqlab qo'yamiz
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Admin panel alohida domenda (ADMIN_HOST, masalan adm.obunext.uz):
//  - admin domenining bosh sahifasi → /admin;
//  - asosiy domendan /admin so'ralsa → admin domeniga yo'naltiriladi;
//  - boshqa har qanday host (server IP'si, eski domenlar) orqali /admin — 404.
app.use((req, res, next) => {
  if (!ADMIN_HOST) return next();
  // req.hostname EMAS: "trust proxy" yoqilganda u mijoz yuborishi mumkin bo'lgan
  // X-Forwarded-Host'dan olinadi. Host sarlavhasini nginx o'zi qo'yadi ($host).
  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  const isAdminPath = req.path === "/admin" || req.path.startsWith("/admin/");
  if (host === ADMIN_HOST) {
    if (req.path === "/") return res.redirect("/admin");
    if (req.path === "/login") return res.redirect("/admin/login");
    if (req.path === "/logout") return res.redirect("/admin/logout");
    return next();
  }
  if (isAdminPath) {
    if (host === MAIN_HOST || host === `www.${MAIN_HOST}`) return res.redirect(301, `https://${ADMIN_HOST}${req.originalUrl}`);
    return res.status(404).send("Topilmadi");
  }
  next();
});

// Admin panel — alohida kirish tizimi (biznes sessiyasi va jamoa rollaridan mustaqil)
app.use(adminRouter);
// Meta deauthorize / data deletion callback'lari (imzolangan so'rov, sessiyasiz)
app.use(metaCallbacksRouter);
app.use(csrfGuard);
app.use(attachUser);
// Jamoa a'zosi egasining ish maydonida bo'lsa — req.user almashtiriladi va roli tekshiriladi
app.use(teamContext);

// SEO: Robots.txt & XML Sitemap for Google Search Indexing
app.get("/robots.txt", (_req, res) => {
  res.type("text/plain");
  const base = (config.baseUrl || "https://obunext.uz").replace(/\/$/, "");
  // Shaxsiy kabinet, admin va texnik yo'llar indekslanmasin
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /inbox\nDisallow: /reset-password\nDisallow: /l/\nDisallow: /g/\nSitemap: ${base}/sitemap.xml\n`);
});

app.get("/sitemap.xml", (_req, res) => {
  const base = (config.baseUrl || "https://obunext.uz").replace(/\/$/, "");
  const pages = [
    ["/", "1.0", "daily"], ["/features", "0.9", "weekly"], ["/pricing", "0.9", "weekly"], ["/faq", "0.8", "monthly"],
    ["/contact", "0.7", "monthly"], ["/register", "0.6", "monthly"], ["/login", "0.4", "monthly"],
    ["/offer", "0.3", "yearly"], ["/privacy-policy", "0.3", "yearly"], ["/terms", "0.3", "yearly"], ["/data-deletion", "0.2", "yearly"],
  ];
  const langs = ["uz", "ru", "en"];
  // Har bir til alohida URL (?lang=) + hreflang muqobillari — Google ru/en versiyalarni ham indekslasin
  const urls = pages.flatMap(([p, prio, freq]) => langs.map((l) => {
    // Sahifalardagi <link hreflang> bilan bir xil format (?lang=uz|ru|en)
    const loc = (lang) => `${base}${p}?lang=${lang}`;
    const alts = langs.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${loc(a)}"/>`).join("") + `<xhtml:link rel="alternate" hreflang="x-default" href="${base}${p}"/>`;
    return `  <url><loc>${loc(l)}</loc>${alts}<priority>${l === "uz" ? prio : (Number(prio) * 0.9).toFixed(1)}</priority><changefreq>${freq}</changefreq></url>`;
  }));
  res.type("application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`);
});

// Google Search Console Site Verification
app.get("/google954f397ce1b4faab.html", (_req, res) => {
  res.type("text/html");
  res.send("google-site-verification: google954f397ce1b4faab.html");
});

// Ijtimoiy tarmoqlarda havola ulashilganda ko'rinadigan rasm (og:image).
const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");
const ogImageBuffer = readFileSync(path.join(assetsDir, "og-image.png"));
const faviconBuffer = readFileSync(path.join(assetsDir, "favicon.png"));
const logoBuffer = existsSync(path.join(assetsDir, "logo.png")) ? readFileSync(path.join(assetsDir, "logo.png")) : faviconBuffer;
const readAsset = (name, fallback) => (existsSync(path.join(assetsDir, name)) ? readFileSync(path.join(assetsDir, name)) : fallback);
const logoWebp = readAsset("logo.webp", null);
const appleIcon = readAsset("apple-touch-icon.png", logoBuffer);

app.get("/og-image.png", (_req, res) => {
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(ogImageBuffer);
});

app.get("/favicon.png", (_req, res) => {
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(faviconBuffer);
});

app.get(["/logo.png", "/assets/logo.png"], (_req, res) => {
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(logoBuffer);
});

// Yengil logo (sahifalarda ko'rsatish uchun) va iOS bosh ekran belgisi
app.get("/logo.webp", (_req, res, next) => {
  if (!logoWebp) return next();
  res.type("image/webp");
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.send(logoWebp);
});
app.get("/apple-touch-icon.png", (_req, res) => {
  res.type("image/png");
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.send(appleIcon);
});

// Publik marketing sayti (ko'p tilli: /, /features, /pricing, /faq, /contact)
// PWA (manifest, service worker) va Web Push
app.use(pushRouter);

// Kuzatiladigan qisqa havolalar (tugmalardagi havolalar bosilishi)
app.get("/l/:tenantId/:linkId", linkRedirectHandler);

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
app.use(sequencesRouter);
app.use(shopRouter);
app.use(shopPaymentsRouter);
app.use(growthToolsRouter);
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
  const db = dbStatus();
  // PostgreSQL sozlangan-u ulanmagan bo'lsa monitoring buni "degraded" deb ko'rsin
  res.status(db.fallback ? 503 : 200).json({ status: db.fallback ? "degraded" : "ok", db: db.mode, dbFallback: db.fallback, time: new Date().toISOString() });
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

  // Avval hodisani bazaga yozamiz: 200 qaytgandan keyin server to'xtasa ham yo'qolmaydi
  // (keyingi ishga tushishda replayPendingWebhooks davom ettiradi).
  let inboxId = null;
  try {
    inboxId = await enqueueWebhook(req.body);
  } catch (err) {
    console.error("[Webhook] navbatga yozib bo'lmadi:", err.message);
  }

  // Meta 20 soniya ichida 200 kutadi — avval javob beramiz, keyin ishlaymiz
  res.sendStatus(200);
  track(runWebhook(inboxId, req.body));
});

/** Webhookni qayta ishlaydi va navbatdagi yozuvni yakunlaydi. */
async function runWebhook(inboxId, body) {
  const errors = await processWebhookBody(body);
  await finishWebhook(inboxId, errors.join("; ")).catch((err) => console.error("[Webhook] navbat holati:", err.message));
}

/** Bitta webhook tanasini qayta ishlaydi. Qaytaradi: xatolar ro'yxati. */
async function processWebhookBody(body) {
  const { object, entry = [] } = body || {};
  const jobs = [];
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

    const handler =
      object === "instagram" ? handleInstagramEntry : object === "page" ? handleFacebookEntry : handleWhatsAppEntry;
    jobs.push(
      Promise.resolve()
        .then(() => handler(tenant, item))
        .then(
          () => "",
          (err) => {
            console.error("Hodisani qayta ishlashda xato:", err);
            alertAdmin("webhook", `${object}: ${err?.message || err}`);
            return String(err?.message || err);
          }
        )
    );
  }
  return (await Promise.all(jobs)).filter(Boolean);
}

/**
 * Oldingi server jarayoni davrida kelib, qayta ishlanmay qolgan webhooklar
 * (deploy/yiqilish). Takroriy javob bo'lmaydi: handlerlar xabar ID'si bo'yicha
 * dedup qiladi (dedup.js), ya'ni allaqachon javob berilganlari o'tkazib yuboriladi.
 */
async function replayPendingWebhooks(before) {
  const rows = await pendingWebhooks({ before });
  if (!rows.length) return;
  console.log(`[Webhook] ${rows.length} ta tugallanmagan hodisa qayta ishlanmoqda`);
  for (const r of rows) await track(runWebhook(r.id, r.body));
}

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

app.use(expressErrorHandler);

// Ishga tushishdan oldin muhim sozlamalarni tekshiramiz
async function checkConfig() {
  const warn = [];
  if (!config.verifyToken) warn.push("VERIFY_TOKEN o'rnatilmagan — webhook tasdiqlanmaydi");
  if (!config.appSecret) warn.push("APP_SECRET yo'q — barcha webhooklar rad etiladi (imzoni tekshirib bo'lmaydi)");
  if (!(await adminConfigured())) warn.push("Admin hisobi yo'q — .env'ga ADMIN_LOGIN va ADMIN_PASSWORD kiriting, aks holda /admin'ga kirib bo'lmaydi");
  if (!encryptionEnabled()) warn.push("DATA_ENCRYPTION_KEY yo'q — Meta/Telegram tokenlari bazada ochiq saqlanadi, zaxira Telegram'ga yuborilmaydi");
  if (isProduction && !ADMIN_HOST) warn.push("ADMIN_HOST yo'q — admin panel istalgan domen/IP orqali ochiladi");
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY)
    warn.push("AI kaliti (GEMINI_API_KEY) yo'q — bot kalit so'z rejimida ishlaydi");
  if (!config.fbAppId || !config.baseUrl)
    warn.push("FB_APP_ID/BASE_URL yo'q — 'Facebook bilan ulash' o'chiq (tokenlar admin panelda qo'lda kiritiladi)");
  for (const w of warn) console.warn("⚠️  " + w);
}

// Baza (PostgreSQL yoki JSON) tayyor bo'lmaguncha so'rov qabul qilmaymiz — aks holda
// ilk webhooklar noto'g'ri bazaga yozilib qolardi.
await dbReady;
if (dbStatus().fallback) {
  // PostgreSQL sozlangan-u ulanmadi. JSON faylga yozishni boshlash "ikki bazali" holatga
  // olib keladi: Postgres qaytgach shu oraliqdagi ma'lumotlar yo'qoladi. Shuning uchun
  // to'xtaymiz — Docker (restart: unless-stopped) bir necha soniyadan so'ng qayta urinadi.
  const msg = `PostgreSQL'ga ulanib bo'lmadi: ${dbStatus().error}`;
  if (process.env.PG_ALLOW_JSON_FALLBACK !== "true") {
    console.error(`❌ ${msg} — server to'xtatildi (vaqtincha JSON bilan ishlash uchun PG_ALLOW_JSON_FALLBACK=true)`);
    await Promise.race([alertAdmin("database", `${msg} — server qayta ishga tushirilmoqda`), new Promise((r) => setTimeout(r, 5000))]);
    process.exit(1);
  }
  alertAdmin("database", `${msg} — PG_ALLOW_JSON_FALLBACK=true, JSON faylga yozilmoqda`);
}
await loadSeenEvents();
const startedAt = Date.now();

const server = app.listen(config.port, async () => {
  await checkConfig().catch((err) => console.error("[Sozlamalar]", err.message));
  console.log(`Server ${config.port}-portda ishga tushdi 🚀`);
  console.log(`Webhook manzil: ${config.baseUrl || `http://localhost:${config.port}`}/webhook`);

  // Oldingi jarayon davrida kelib tugallanmagan webhooklar
  replayPendingWebhooks(startedAt).catch((err) => console.error("[Webhook] qayta ishlash:", err.message));

  // Fon vazifalari (ommaviy xabar, follow-up, zaxira...) faqat BITTA jarayonda ishlashi
  // kerak — aks holda mijozlarga xabar ikki marta ketadi. PostgreSQL advisory lock bilan
  // ta'minlanadi; qulf band bo'lsa (boshqa nusxa ishlayapti) bu jarayon faqat HTTP'ga xizmat qiladi.
  let schedulerOn = false;
  const tryStartScheduler = async () => {
    if (schedulerOn) return;
    try {
      if (!(await acquireSchedulerLock())) return console.warn("[Rejalashtiruvchi] boshqa server nusxasi ishlayapti — bu jarayonda fon vazifalari o'chiq");
    } catch (err) {
      return console.error("[Rejalashtiruvchi] qulf olinmadi:", err.message);
    }
    schedulerOn = true;
    startScheduler();
  };
  tryStartScheduler();
  setInterval(tryStartScheduler, 5 * 60 * 1000).unref();
});

function startScheduler() {
  if (reportsBotAvailable) {
    setupReportsBotWebhook().catch((err) => console.error("[ReportsBot] webhook o'rnatishda xato:", err.message));
    setInterval(() => {
      checkAndSendDailyReports().catch((err) => console.error("[ReportsBot] kunlik hisobot xatosi:", err.message));
    }, 20 * 60 * 1000);
  }

  loadPlatformSettings().catch((err) => console.error("[Platforma] sozlamalar:", err.message));

  // Eski (maxfiy kalitsiz) Telegram webhook'larini xavfsiz holatga o'tkazamiz
  setTimeout(() => {
    listUsers().then(refreshTelegramWebhooks).catch((err) => console.error("[Telegram] webhook yangilash:", err.message));
    // Eski versiyalar komment AI tarixini "ig:comment:<id>" kabi alohida "mijoz" qilib
    // saqlagan — Inbox/CRM'dan bir marta tozalaymiz
    listUsers()
      .then((users) => {
        for (const u of users) {
          const n = purgeInternalKeys(u);
          if (n) {
            persist(u);
            console.log(`[Tozalash] ${u.businessName || u.email}: ${n} ta ichki "comment:" yozuv o'chirildi`);
          }
        }
      })
      .catch((err) => console.error("[Tozalash] xato:", err.message));
  }, 5000);

  // Obuna eslatmalari va follow-up xabarlar — daqiqa aniqligida
  setInterval(() => {
    runDueFollowUps().catch((err) => console.error("[FollowUp] xato:", err.message));
    runDueBroadcasts().catch((err) => console.error("[Broadcast] xato:", err.message));
    runDueSequences().catch((err) => console.error("[Ketma-ketlik] xato:", err.message));
    runDueShop().catch((err) => console.error("[Do'kon] xato:", err.message));
  }, 60 * 1000);

  // Instagram tokenlarini yangilash (60 kunlik) — har 6 soatda, birinchisi 1 daqiqadan so'ng
  const igRefresh = () => runIgTokenRefresh().catch((err) => console.error("[IG token] xato:", err.message));
  setTimeout(igRefresh, 60 * 1000);
  setInterval(igRefresh, 6 * 60 * 60 * 1000);

  // Obuna tugashi eslatmalari va kunlik zaxira nusxa — har soatda tekshiriladi
  const hourly = () => {
    runSubscriptionReminders().catch((err) => console.error("[Obuna eslatma] xato:", err.message));
    runDueBackup().catch((err) => console.error("[Zaxira] xato:", err.message));
  };
  setTimeout(hourly, 5 * 60 * 1000);
  setInterval(hourly, 60 * 60 * 1000);

  // Rejalashtirilgan Instagram postlari — vaqtga aniq mos kelishi va Reels tez chiqishi uchun har daqiqada
  setInterval(() => {
    checkAndPublishScheduledPosts().catch((err) => console.error("[PostPublisher] xato:", err.message));
  }, 60 * 1000);

  // Avto-Reels: kuniga belgilangan vaqtlarda AI video yasab joylaydi
  setInterval(() => {
    runAutoReels().catch((err) => console.error("[Avto-Reels] xato:", err.message));
  }, 5 * 60 * 1000);
}

// Server to'xtatilganda bazani saqlab, tozalab chiqamiz
async function shutdown(signal) {
  console.log(`\n${signal} — yangi so'rovlar qabul qilinmaydi, jarayondagi xabarlar tugatilmoqda...`);
  server.close();
  // Deploy paytida qayta ishlanayotgan mijoz xabarlari yo'qolmasin (ko'pi bilan 15 soniya)
  const drain = Promise.allSettled([...inflight]);
  await Promise.race([drain, new Promise((r) => setTimeout(r, 15000))]);
  if (inflight.size) console.warn(`[Shutdown] ${inflight.size} ta hodisa tugatilmay qoldi`);
  try {
    await persist();
    flushSeenEvents();
    const { flushArchive } = await import("./chatStore.js");
    await flushArchive();
  } catch (err) {
    console.error("Saqlashda xato:", err.message);
  }
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
