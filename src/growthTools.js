/**
 * Mijoz jalb qilish vositalari (ManyChat "Growth Tools"):
 *  - Referal havolalar + QR kod: ig.me/m/<user>?ref=KOD, t.me/<bot>?start=KOD,
 *    wa.me/<raqam>?text=KOD, m.me/<sahifa>?ref=KOD. Flow'dagi "🔗 Referal havola"
 *    triggeri shu KOD bilan ishga tushadi. Bosishlar /g/<tenantId>/<kod> orqali sanaladi.
 *  - Sayt vidjeti: <script src=".../w/<tenantId>.js"> — saytda suzuvchi chat tugmasi
 *  - Havolalar sahifasi (link in bio): /p/<slug>
 *
 * tenant.growth.tools = { contacts: { ig, tg, wa, fb }, links: [...], widget: {...}, page: {...} }
 */
import crypto from "node:crypto";
import QRCode from "qrcode";
import { persist } from "./db.js";

export const CHANNEL_LABELS = { ig: "Instagram", tg: "Telegram", wa: "WhatsApp", fb: "Messenger" };

export function ensureTools(tenant) {
  tenant.growth ||= {};
  const t = (tenant.growth.tools ||= {});
  t.contacts = {
    ig: tenant.meta?.igUsername || "",
    tg: tenant.settings?.telegramBotUsername || "",
    wa: "",
    fb: "",
    ...(t.contacts || {}),
  };
  if (!t.contacts.ig && tenant.meta?.igUsername) t.contacts.ig = tenant.meta.igUsername;
  if (!t.contacts.tg && tenant.settings?.telegramBotUsername) t.contacts.tg = tenant.settings.telegramBotUsername;
  if (!Array.isArray(t.links)) t.links = [];
  t.widget = { enabled: false, color: "#7c3aed", greeting: "Savolingiz bormi? Yozing 👋", position: "right", channels: { ig: true, tg: true, wa: true, fb: false }, ref: "", ...(t.widget || {}) };
  t.page = { enabled: false, slug: "", title: tenant.businessName || "", bio: "", buttons: [], ...(t.page || {}) };
  return t;
}

const cleanUser = (v) => String(v || "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(instagram\.com|t\.me|m\.me|wa\.me)\//i, "").replace(/[/?#].*$/, "").slice(0, 60);
const cleanPhone = (v) => String(v || "").replace(/\D/g, "").slice(0, 15);

export function saveContacts(tenant, body = {}) {
  const t = ensureTools(tenant);
  t.contacts = { ig: cleanUser(body.ig), tg: cleanUser(body.tg), wa: cleanPhone(body.wa), fb: cleanUser(body.fb) };
  persist(tenant);
  return t.contacts;
}

/** Kanal uchun to'g'ridan-to'g'ri chat havolasi (kod bilan). "" — kontakt kiritilmagan. */
export function channelUrl(tenant, chan, code = "") {
  const c = ensureTools(tenant).contacts;
  const k = encodeURIComponent(code);
  if (chan === "ig" && c.ig) return `https://ig.me/m/${c.ig}${code ? `?ref=${k}` : ""}`;
  if (chan === "tg" && c.tg) return `https://t.me/${c.tg}${code ? `?start=${k}` : ""}`;
  if (chan === "wa" && c.wa) return `https://wa.me/${c.wa}${code ? `?text=${k}` : ""}`;
  if (chan === "fb" && c.fb) return `https://m.me/${c.fb}${code ? `?ref=${k}` : ""}`;
  return "";
}

export function createLink(tenant, { name, channel, code }) {
  const t = ensureTools(tenant);
  const chan = CHANNEL_LABELS[channel] ? channel : "ig";
  const cleanCode = String(code || "").trim().replace(/[^\w-]/g, "").slice(0, 40) || crypto.randomBytes(3).toString("hex");
  const link = { id: `gl_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`, name: String(name || cleanCode).trim().slice(0, 80), channel: chan, code: cleanCode, clicks: 0, createdAt: new Date().toISOString() };
  t.links.unshift(link);
  t.links = t.links.slice(0, 200);
  persist(tenant);
  return link;
}

/** QR kod SVG (chop etish uchun sifatli). */
export function qrSvg(text) {
  return QRCode.toString(String(text), { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#0f1222", light: "#ffffff" } });
}

export function qrPng(text) {
  return QRCode.toBuffer(String(text), { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M" });
}

/** Vidjet skripti (saytga joylanadi) — sozlamalar ichida, tashqi so'rovsiz. */
export function widgetScript(tenant) {
  const t = ensureTools(tenant);
  const w = t.widget;
  const buttons = Object.entries(w.channels)
    .filter(([c, on]) => on && channelUrl(tenant, c, w.ref))
    .map(([c]) => ({ c, label: CHANNEL_LABELS[c], url: channelUrl(tenant, c, w.ref) }));
  const cfg = JSON.stringify({ color: /^#[0-9a-f]{6}$/i.test(w.color) ? w.color : "#7c3aed", greeting: String(w.greeting || "").slice(0, 120), right: w.position !== "left", buttons, name: String(tenant.businessName || "").slice(0, 60) });
  return `/* Obunext chat vidjeti */
(function(){if(window.__obxWidget)return;window.__obxWidget=1;var c=${cfg.replace(/</g, "\\u003c")};if(!c.buttons.length)return;
var ic={ig:"#E1306C",tg:"#229ED9",wa:"#25D366",fb:"#0084FF"};var s=document.createElement("style");
s.textContent=".obx-w{position:fixed;bottom:20px;"+(c.right?"right":"left")+":20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.obx-b{width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:"+c.color+";box-shadow:0 10px 30px rgba(0,0,0,.25);display:grid;place-items:center;transition:transform .2s}.obx-b:hover{transform:scale(1.06)}.obx-p{position:absolute;bottom:72px;"+(c.right?"right":"left")+":0;width:260px;background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.25);padding:14px;display:none}.obx-w.open .obx-p{display:block}.obx-p b{display:block;font-size:15px;color:#111;margin-bottom:4px}.obx-p p{margin:0 0 10px;font-size:13px;color:#555}.obx-p a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;margin-top:6px;color:#fff;text-decoration:none;font-size:14px;font-weight:600}";
document.head.appendChild(s);var w=document.createElement("div");w.className="obx-w";
var p=document.createElement("div");p.className="obx-p";var t=document.createElement("b");t.textContent=c.name||"";var g=document.createElement("p");g.textContent=c.greeting;p.appendChild(t);p.appendChild(g);
c.buttons.forEach(function(x){var a=document.createElement("a");a.href=x.url;a.target="_blank";a.rel="noopener";a.style.background=ic[x.c]||c.color;a.textContent=x.label;p.appendChild(a);});
var b=document.createElement("button");b.className="obx-b";b.setAttribute("aria-label","Chat");b.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.6 1.3 4.9 3.4 6.5L4.6 22l4.2-2.2c1 .3 2.1.4 3.2.4 5.5 0 10-3.9 10-8.6S17.5 3 12 3z"/></svg>';
b.onclick=function(){w.classList.toggle("open")};w.appendChild(p);w.appendChild(b);document.body.appendChild(w);})();`;
}

export function slugify(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
