/**
 * Admin panel uchun alohida kirish tizimi (biznes akkauntlaridan mustaqil).
 *
 *  - Login: telefon raqami (faqat raqamlar solishtiriladi) + parol
 *  - Parol hech qayerda ochiq saqlanmaydi: scrypt(parol, salt) izi.
 *    Ustuvorlik: paneldagi "Xavfsizlik"da o'zgartirilgan parol (platforma sozlamasi)
 *    → .env (ADMIN_LOGIN / ADMIN_PASSWORD) → dastlabki (quyidagi iz).
 *  - Sessiya: HMAC imzoli cookie ("adm"), 12 soat; parol o'zgarsa barcha sessiyalar bekor
 *  - Brute-force himoyasi: IP bo'yicha 5 ta xato → 15 daqiqa blok
 *  - Audit jurnali: har bir admin amali (kim, qachon, IP, nima)
 */
import crypto from "node:crypto";
import { getPlatformSettings, setPlatformSettings } from "../db.js";

// Dastlabki admin: +998 94 939 22 50. Parolning faqat scrypt izi (ochiq matn emas).
// Birinchi kirishdan keyin "Xavfsizlik" bo'limida parolni almashtirish tavsiya etiladi.
const DEFAULT_ADMIN = {
  login: "998949392250",
  salt: "0f5f7b2d01041c91eb80c6940c630ede",
  hash: "5b09e888aa638fb809a023b2125040b15025894167c14456685072e2877a23394bb411a16737637762e096963737650e9ce35e728cb34fd534eb11dd484adcf4",
  version: "default",
};

const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_AUDIT = 500;
const COOKIE = "adm";

export const normalizeLogin = (v) => String(v || "").replace(/\D/g, "");
const scrypt = (password, salt) => crypto.scryptSync(String(password ?? ""), salt, 64).toString("hex");

async function credentials() {
  const s = (await getPlatformSettings()) || {};
  if (s.adminAuth?.hash && s.adminAuth?.salt && s.adminAuth?.login) return s.adminAuth;
  if (process.env.ADMIN_LOGIN && process.env.ADMIN_PASSWORD) {
    const salt = crypto.createHash("sha256").update(`env:${process.env.ADMIN_LOGIN}`).digest("hex").slice(0, 32);
    const hash = scrypt(process.env.ADMIN_PASSWORD, salt);
    return { login: normalizeLogin(process.env.ADMIN_LOGIN), salt, hash, version: `env-${hash.slice(0, 10)}` };
  }
  return DEFAULT_ADMIN;
}

async function secret() {
  const s = (await getPlatformSettings()) || {};
  if (s.adminSecret) return s.adminSecret;
  const fresh = crypto.randomBytes(32).toString("hex");
  await setPlatformSettings({ adminSecret: fresh });
  return fresh;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- brute-force ----------
// Xotirada tekshiriladi, platforma sozlamalarida ham saqlanadi — restart blokni bekor qilmaydi.
const fails = new Map(); // ip -> { count, until }
let failsLoaded = false;

async function loadFails() {
  if (failsLoaded) return;
  failsLoaded = true;
  const saved = ((await getPlatformSettings()) || {}).adminLocks || {};
  for (const [ip, r] of Object.entries(saved)) if (!fails.has(ip) && r && (r.until > Date.now() || r.count)) fails.set(ip, r);
}

async function saveFails() {
  const now = Date.now();
  const out = {};
  for (const [ip, r] of fails) if (r.until > now || (r.count && r.at > now - LOCK_MS)) out[ip] = r;
  await setPlatformSettings({ adminLocks: out });
}

export function lockInfo(ip) {
  const r = fails.get(ip);
  return r && r.until > Date.now() ? Math.ceil((r.until - Date.now()) / 60000) : 0;
}

/** Login + parolni tekshiradi. Qaytaradi: { ok } | { error } */
export async function verifyAdmin(login, password, ip = "") {
  await loadFails();
  const locked = lockInfo(ip);
  if (locked) return { error: `Juda ko'p noto'g'ri urinish. ${locked} daqiqadan so'ng qayta urinib ko'ring.` };
  const c = await credentials();
  const okLogin = safeEqual(normalizeLogin(login), c.login);
  const okPass = safeEqual(scrypt(password, c.salt), c.hash); // login noto'g'ri bo'lsa ham hisoblanadi (vaqt bo'yicha farq bo'lmasin)
  if (okLogin && okPass) {
    if (fails.delete(ip)) await saveFails();
    return { ok: true, version: c.version };
  }
  const prev = fails.get(ip);
  // Blok muddati o'tgan yoki oxirgi xato 15 daqiqadan eski bo'lsa — hisob qaytadan
  const stale = !prev || (prev.until && prev.until <= Date.now()) || (prev.at && prev.at < Date.now() - LOCK_MS);
  const count = (stale ? 0 : prev.count || 0) + 1;
  fails.set(ip, { count, at: Date.now(), until: count >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
  if (fails.size > 10000) fails.delete(fails.keys().next().value);
  await saveFails();
  return { error: count >= MAX_FAILS ? "Juda ko'p noto'g'ri urinish. 15 daqiqadan so'ng qayta urinib ko'ring." : "Login yoki parol noto'g'ri" };
}

// ---------- sessiya ----------
export async function issueSession() {
  const c = await credentials();
  const exp = Date.now() + SESSION_MS;
  const nonce = crypto.randomBytes(8).toString("hex");
  const body = `${exp}.${nonce}.${c.version}`;
  const sig = crypto.createHmac("sha256", await secret()).update(body).digest("hex");
  return `${body}.${sig}`;
}

export async function checkSession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 4) return false;
  const [exp, nonce, version, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const c = await credentials();
  if (version !== String(c.version)) return false; // parol o'zgargan — eski sessiyalar bekor
  const expected = crypto.createHmac("sha256", await secret()).update(`${exp}.${nonce}.${version}`).digest("hex");
  return safeEqual(sig, expected);
}

export function readCookie(req) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return "";
}

export function sessionCookie(req, value, maxAgeSec = SESSION_MS / 1000) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

/** Parolni almashtiradi (joriy parol tekshiriladi). Barcha sessiyalar bekor bo'ladi. */
export async function changeAdminPassword(current, next, newLogin = "") {
  const c = await credentials();
  if (!safeEqual(scrypt(current, c.salt), c.hash)) return { error: "Joriy parol noto'g'ri" };
  const pw = String(next || "");
  if (pw.length < 10 || !/\d/.test(pw) || !/[a-zA-Z]/.test(pw)) return { error: "Yangi parol kamida 10 belgi, harf va raqamdan iborat bo'lsin" };
  const login = normalizeLogin(newLogin) || c.login;
  if (login.length < 9) return { error: "Login (telefon raqami) noto'g'ri" };
  const salt = crypto.randomBytes(16).toString("hex");
  await setPlatformSettings({ adminAuth: { login, salt, hash: scrypt(pw, salt), version: crypto.randomBytes(6).toString("hex"), updatedAt: new Date().toISOString() } });
  return { ok: true };
}

export async function usingDefaultPassword() {
  return (await credentials()).version === "default";
}

export async function adminLogin() {
  return (await credentials()).login;
}

// ---------- audit ----------
export async function audit(req, action, target = "", details = "") {
  const s = (await getPlatformSettings()) || {};
  const log = Array.isArray(s.adminAudit) ? s.adminAudit : [];
  log.unshift({ at: new Date().toISOString(), ip: clientIp(req), action: String(action).slice(0, 60), target: String(target).slice(0, 120), details: String(details).slice(0, 300) });
  await setPlatformSettings({ adminAudit: log.slice(0, MAX_AUDIT) });
}

export async function auditLog() {
  const s = (await getPlatformSettings()) || {};
  return Array.isArray(s.adminAudit) ? s.adminAudit : [];
}

export function clientIp(req) {
  return String(req.get?.("x-forwarded-for") || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
}

/** Middleware: admin sessiyasi bo'lmasa login sahifasiga. POST'larda Origin tekshiriladi (CSRF). */
export async function requireAdminSession(req, res, next) {
  if (!(await checkSession(readCookie(req)))) {
    if (req.method !== "GET") return res.status(401).send("Sessiya tugagan — qayta kiring");
    return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  if (req.method !== "GET") {
    const origin = req.get("origin") || req.get("referer") || "";
    const host = req.get("host");
    if (origin && host && !new RegExp(`^https?://${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`).test(origin)) {
      return res.status(403).send("Noto'g'ri so'rov manbai");
    }
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
}
