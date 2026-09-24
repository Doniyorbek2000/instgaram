/**
 * Qo'shimcha kanallar: SMS (Eskiz.uz) va Email (SMTP).
 * Mijozning telefon/email maydoni (forma, flow "Savol" bloki yoki AI yig'gan) bo'yicha yuboriladi:
 * flow'dagi "📱 SMS yuborish" / "✉️ Email yuborish" amallari va ommaviy xabarlarda.
 *
 * tenant.integrations.sms   = { provider: "eskiz", email, password, from, token, tokenAt }
 * tenant.integrations.email = { host, port, secure, user, pass, from }
 */
import nodemailer from "nodemailer";
import { persist } from "./db.js";
import { ensureIntegrations } from "./integrations.js";

const ESKIZ = "https://notify.eskiz.uz/api";
const TOKEN_TTL_MS = 25 * 24 * 60 * 60 * 1000; // Eskiz tokeni 30 kun amal qiladi

export function smsSettings(tenant) {
  const i = ensureIntegrations(tenant);
  i.sms = { provider: "eskiz", email: "", password: "", from: "4546", ...(i.sms || {}) };
  return i.sms;
}

export function emailSettings(tenant) {
  const i = ensureIntegrations(tenant);
  i.email = { host: "", port: 465, secure: true, user: "", pass: "", from: "", ...(i.email || {}) };
  return i.email;
}

export const smsReady = (tenant) => Boolean(smsSettings(tenant).email && smsSettings(tenant).password);
export const emailReady = (tenant) => Boolean(emailSettings(tenant).host && emailSettings(tenant).user && emailSettings(tenant).pass);

/** +998 90 123-45-67 → 998901234567 (faqat O'zbekiston raqamlari). */
export function normalizeUzPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 9) d = `998${d}`;
  return /^998\d{9}$/.test(d) ? d : "";
}

async function eskizToken(tenant, { fetchFn = fetch, force = false } = {}) {
  const s = smsSettings(tenant);
  if (!force && s.token && Date.now() - (s.tokenAt || 0) < TOKEN_TTL_MS) return s.token;
  const form = new FormData();
  form.append("email", s.email);
  form.append("password", s.password);
  const res = await fetchFn(`${ESKIZ}/auth/login`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  const token = data?.data?.token;
  if (!res.ok || !token) throw new Error(data?.message || `Eskiz login xatosi (${res.status})`);
  s.token = token;
  s.tokenAt = Date.now();
  persist(tenant);
  return token;
}

/** SMS yuboradi. Qaytaradi: { ok, id?, error? } */
export async function sendSms(tenant, phone, text, { fetchFn = fetch } = {}) {
  if (!smsReady(tenant)) return { ok: false, error: "SMS (Eskiz) sozlanmagan" };
  const to = normalizeUzPhone(phone);
  if (!to) return { ok: false, error: "Telefon raqami noto'g'ri" };
  const message = String(text || "").trim().slice(0, 900);
  if (!message) return { ok: false, error: "Matn bo'sh" };
  const s = smsSettings(tenant);
  const attempt = async (force) => {
    const token = await eskizToken(tenant, { fetchFn, force });
    const form = new FormData();
    form.append("mobile_phone", to);
    form.append("message", message);
    form.append("from", /^[\w]{3,11}$/.test(s.from) ? s.from : "4546");
    const res = await fetchFn(`${ESKIZ}/message/sms/send`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  };
  try {
    let { res, data } = await attempt(false);
    if (res.status === 401) ({ res, data } = await attempt(true)); // token eskirgan
    if (!res.ok || (data?.status && !["waiting", "success", "ok"].includes(String(data.status).toLowerCase()))) {
      return { ok: false, error: data?.message || `Eskiz xatosi (${res.status})` };
    }
    return { ok: true, id: data?.id || data?.data?.id || "" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

let transportCache = new WeakMap();

/** Email yuboradi. Qaytaradi: { ok, error? } */
export async function sendEmail(tenant, to, subject, text, { transport } = {}) {
  if (!emailReady(tenant)) return { ok: false, error: "Email (SMTP) sozlanmagan" };
  const addr = String(to || "").trim();
  if (!/^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/i.test(addr)) return { ok: false, error: "Email manzili noto'g'ri" };
  const s = emailSettings(tenant);
  try {
    let t = transport || transportCache.get(tenant);
    if (!t) {
      t = nodemailer.createTransport({ host: s.host, port: Number(s.port) || 465, secure: Boolean(s.secure), auth: { user: s.user, pass: s.pass }, connectionTimeout: 10000 });
      transportCache.set(tenant, t);
    }
    await t.sendMail({
      from: s.from || s.user,
      to: addr,
      subject: String(subject || tenant.businessName || "Xabar").slice(0, 200),
      text: String(text || ""),
      headers: { "List-Unsubscribe": "<mailto:" + (s.from || s.user) + "?subject=unsubscribe>" },
    });
    return { ok: true };
  } catch (err) {
    transportCache.delete(tenant);
    return { ok: false, error: err.message };
  }
}

export function saveMessagingSettings(tenant, body = {}) {
  const sms = smsSettings(tenant);
  const em = emailSettings(tenant);
  const errors = [];
  sms.email = String(body.smsEmail || "").trim().slice(0, 120);
  if (String(body.smsPassword || "").trim()) { sms.password = String(body.smsPassword).trim().slice(0, 200); sms.token = ""; }
  if (!sms.email) { sms.password = ""; sms.token = ""; }
  sms.from = /^[\w]{3,11}$/.test(String(body.smsFrom || "")) ? String(body.smsFrom) : "4546";
  em.host = String(body.smtpHost || "").trim().replace(/[^\w.-]/g, "").slice(0, 120);
  em.port = Math.max(1, Math.min(65535, Number(body.smtpPort) || 465));
  em.secure = body.smtpSecure === "on";
  em.user = String(body.smtpUser || "").trim().slice(0, 120);
  if (String(body.smtpPass || "").trim()) em.pass = String(body.smtpPass).slice(0, 200);
  if (!em.user) em.pass = "";
  em.from = String(body.smtpFrom || "").trim().slice(0, 160);
  if (em.host && /^(localhost|127\.|10\.|192\.168\.)/.test(em.host)) { errors.push("SMTP manzili ichki tarmoqqa ishora qilmasligi kerak"); em.host = ""; }
  transportCache = new WeakMap();
  persist(tenant);
  return errors;
}
