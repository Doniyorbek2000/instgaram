/**
 * Xatolarni kuzatish: kutilmagan xatolar logga yoziladi va (sozlangan bo'lsa)
 * platforma egasiga Telegram orqali ogohlantirish yuboriladi.
 * .env: TELEGRAM_BOT_TOKEN + ADMIN_TELEGRAM_CHAT_ID.
 * Bir xil xato 30 daqiqada ko'pi bilan bir marta yuboriladi (spam bo'lmasin).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

const THROTTLE_MS = 30 * 60 * 1000;
const lastSent = new Map(); // kalit -> vaqt
const recent = []; // admin panel uchun oxirgi xatolar
const MAX_RECENT = 50;

export function recentErrors() {
  return recent.slice();
}

function remember(kind, text) {
  recent.unshift({ at: new Date().toISOString(), kind, text: String(text).slice(0, 500) });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
}

/** Adminga ogohlantirish (throttle bilan). Qaytaradi: yuborildimi. */
export async function alertAdmin(key, text, { fetchFn = fetch } = {}) {
  remember(key, text);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const sig = `${key}:${String(text).slice(0, 80)}`;
  const now = Date.now();
  if (now - (lastSent.get(sig) || 0) < THROTTLE_MS) return false;
  lastSent.set(sig, now);
  if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value);
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: `🚨 Obunext server\n[${key}] ${String(text).slice(0, 3500)}` }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const describe = (err) => (err?.stack || err?.message || String(err)).split("\n").slice(0, 4).join("\n");

/**
 * LOG_FORMAT=json bo'lsa console.* chiqishi bir qatorli JSON'ga aylanadi
 * ({ ts, level, msg, reqId? }) — Loki/ELK/Datadog kabi tizimlar to'g'ridan-to'g'ri o'qiydi.
 * Aks holda (standart) oddiy matn qoladi, faqat vaqt belgisi qo'shiladi.
 */
export function installLogger() {
  if (installLogger.done) return;
  installLogger.done = true;
  const json = process.env.LOG_FORMAT === "json";
  const fmt = (a) => (a instanceof Error ? describe(a) : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
  for (const [method, level] of [["log", "info"], ["info", "info"], ["warn", "warn"], ["error", "error"]]) {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      const ts = new Date().toISOString();
      if (!json) return orig(ts, ...args);
      const reqId = requestContext.getStore()?.id;
      orig(JSON.stringify({ ts, level, msg: args.map(fmt).join(" "), ...(reqId ? { reqId } : {}) }));
    };
  }
}

const requestContext = new AsyncLocalStorage();

/**
 * Har bir so'rovga ID beradi (X-Request-Id — nginx yuborgan bo'lsa o'shani) va
 * sekin (>3 s) yoki xato (5xx) so'rovlarni logga yozadi. Loglardagi reqId orqali
 * bitta so'rovga tegishli barcha yozuvlarni topish mumkin.
 */
export function requestLogger(req, res, next) {
  const incoming = String(req.get("x-request-id") || "");
  const id = /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomBytes(8).toString("hex");
  req.id = id;
  res.setHeader("X-Request-Id", id);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (res.statusCode >= 500 || ms > 3000) {
      requestContext.run({ id }, () => console.warn(`[HTTP] ${req.method} ${req.path} → ${res.statusCode} (${Math.round(ms)} ms)`));
    }
  });
  requestContext.run({ id }, next);
}

/** Jarayon darajasidagi xatolarni ushlaydi (index.js da bir marta). */
export function installProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
    alertAdmin("unhandledRejection", describe(reason));
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
    alertAdmin("uncaughtException", describe(err)).finally(() => {
      // Holat buzilgan bo'lishi mumkin — Docker (restart: unless-stopped) qayta ishga tushiradi
      setTimeout(() => process.exit(1), 1500).unref();
    });
  });
}

/** Express xato middleware'i: 500 sahifa + ogohlantirish. */
export function expressErrorHandler(err, req, res, next) {
  console.error(`[HTTP 500] ${req.method} ${req.originalUrl}:`, err);
  alertAdmin("http500", `${req.method} ${req.originalUrl}\n${describe(err)}`);
  if (res.headersSent) return next(err);
  res.status(500);
  if (req.accepts("html")) return res.send(`<!doctype html><meta charset="utf-8"><title>Xatolik</title><div style="font-family:sans-serif;max-width:520px;margin:80px auto;text-align:center"><h1>Kutilmagan xatolik</h1><p>Muammo haqida xabar oldik. Birozdan so'ng qayta urinib ko'ring.</p><p><a href="/">← Bosh sahifa</a></p></div>`);
  res.json({ error: "internal_error" });
}
