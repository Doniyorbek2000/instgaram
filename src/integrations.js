/**
 * Tashqi integratsiyalar — hodisalarni tashqi tizimlarga yuborish.
 *  - Webhook: istalgan URL'ga JSON POST (Make, Zapier, n8n, amoCRM, Bitrix24 va h.k.)
 *  - Google Sheets: Apps Script "Web app" URL'iga JSON POST (skript qatorni jadvalga yozadi)
 *
 * tenant.integrations = {
 *   webhookUrl, sheetsUrl,
 *   events: { form_submitted, lead, reward_redeemed, new_contact, points_awarded },
 *   log: [{ at, event, target, ok, status }]
 * }
 */
import { persist } from "./db.js";

export const INTEGRATION_EVENTS = {
  form_submitted: "Forma to'ldirildi (lid)",
  lead: "Telefon/email qoldirildi (hot lead)",
  new_contact: "Yangi kontakt yozdi",
  reward_redeemed: "Ball evaziga sovg'a olindi",
  points_awarded: "Ball berildi (geymifikatsiya)",
  conversion: "Flow'da konversiya qayd etildi",
  flow_event: "Flow'dagi \"Webhook / CRM\" amali",
  link_click: "Havola bosildi",
  order_created: "Yangi buyurtma",
  order_status: "Buyurtma holati o'zgardi",
  opt_out: "Mijoz ommaviy xabarlardan chiqdi",
};

const DEFAULT_EVENTS = { form_submitted: true, lead: true, reward_redeemed: true, new_contact: false, points_awarded: false, conversion: true, flow_event: true, link_click: false, order_created: true, order_status: true, opt_out: false };
const TIMEOUT_MS = 6000;

export function ensureIntegrations(tenant) {
  tenant.integrations ||= {};
  tenant.integrations.events = { ...DEFAULT_EVENTS, ...(tenant.integrations.events || {}) };
  tenant.integrations.log ||= [];
  return tenant.integrations;
}

/** Faqat http(s) va ichki tarmoqqa ishora qilmaydigan URL'larni qabul qiladi (SSRF himoyasi). */
export function isSafeUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h === "[::1]" || h.startsWith("[fc") || h.startsWith("[fd")) return false;
  if (!h.includes(".")) return false; // docker servis nomlari (postgres, bot...)
  return true;
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Obunext-Webhook/1.0" },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "follow", // Apps Script 302 bilan javob beradi
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: err.name === "AbortError" ? "timeout" : err.message.slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

/** Jadvalga yozish uchun ma'lumotni tekis (flat) ko'rinishga keltiradi. */
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

/**
 * Hodisani sozlangan integratsiyalarga yuboradi. Hech qachon xato tashlamaydi va
 * chaqiruvchini kutdirmaydi (fon rejimida) — mijozga javob tezligiga ta'sir qilmaydi.
 */
export function fireEvent(tenant, event, data = {}, { force = false } = {}) {
  const integ = ensureIntegrations(tenant);
  if (!force && !integ.events[event]) return;
  const targets = [
    integ.webhookUrl ? { name: "webhook", url: integ.webhookUrl, flat: false } : null,
    integ.sheetsUrl ? { name: "sheets", url: integ.sheetsUrl, flat: true } : null,
  ].filter(Boolean);
  if (!targets.length) return;

  const payload = {
    event,
    eventTitle: INTEGRATION_EVENTS[event] || event,
    business: tenant.businessName || "",
    at: new Date().toISOString(),
    data,
  };

  (async () => {
    for (const t of targets) {
      if (!isSafeUrl(t.url)) {
        integ.log.unshift({ at: payload.at, event, target: t.name, ok: false, status: "bad-url" });
        continue;
      }
      const body = t.flat ? { event, at: payload.at, business: payload.business, ...flatten(data) } : payload;
      const r = await postJson(t.url, body);
      integ.log.unshift({ at: payload.at, event, target: t.name, ok: r.ok, status: r.status });
      if (!r.ok) console.warn(`[Integratsiya] ${tenant.businessName}: ${t.name} ${event} -> ${r.status}`);
    }
    integ.log = integ.log.slice(0, 30);
    persist(tenant);
  })().catch((err) => console.error("[Integratsiya] xato:", err.message));
}

/** Google Sheets uchun tayyor Apps Script kodi (sozlamalar sahifasida ko'rsatiladi). */
export const SHEETS_APPS_SCRIPT = `function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  var headers = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  Object.keys(data).forEach(function (k) {
    if (headers.indexOf(k) === -1) {
      headers.push(k);
      sheet.getRange(1, headers.length).setValue(k);
    }
  });
  var row = headers.map(function (h) { return data[h] !== undefined ? data[h] : ""; });
  sheet.appendRow(row);
  return ContentService.createTextOutput("ok");
}`;
