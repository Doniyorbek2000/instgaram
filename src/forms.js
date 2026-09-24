/**
 * DM lid formalari (so'rovnomalar) — ChatPlace'dagi "Lead collection / Survey".
 * Mijoz kalit so'z yozadi yoki tugmani bosadi → bot savollarni ketma-ket beradi →
 * javoblar tekshiriladi (telefon, email, raqam, variant) → lid saqlanadi, kontaktga
 * teg qo'yiladi, egasiga Telegram bildirishnoma va integratsiyalarga (webhook/Sheets) yuboriladi.
 *
 * tenant.forms = { list: [Form], sessions: { [chatKey]: Session }, submissions: [Submission] }
 */
import crypto from "node:crypto";
import { persist } from "./db.js";
import { fireEvent } from "./integrations.js";
import { addTags, setFields } from "./contacts.js";
import { sendTelegram } from "./notify.js";
import { config } from "./config.js";

export const FIELD_TYPES = {
  text: "Matn",
  name: "Ism",
  phone: "Telefon raqam",
  email: "Email",
  number: "Raqam",
  choice: "Variant tanlash (tugmalar)",
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SUBMISSIONS = 2000;
const CANCEL_WORDS = ["bekor", "bekor qilish", "stop", "cancel", "отмена", "/cancel"];

export function ensureForms(tenant) {
  const f = (tenant.forms ||= {});
  f.list ||= [];
  f.sessions ||= {};
  f.submissions ||= [];
  return f;
}

export function newFormId() {
  return `form_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`;
}

/** Forma kalit so'ziga mosligini tekshiradi. */
export function findFormByTrigger(tenant, text) {
  const f = ensureForms(tenant);
  const t = String(text || "").toLowerCase().trim();
  if (!t) return null;
  for (const form of f.list) {
    if (form.active === false) continue;
    const kws = String(form.keywords || "").split(",").map((k) => k.toLowerCase().trim()).filter(Boolean);
    for (const kw of kws) {
      if (form.matchType === "contains" ? t.includes(kw) : t === kw) return form;
    }
  }
  return null;
}

function questionFor(field) {
  const q = field.question || field.label || "Javobingizni yozing";
  if (field.type === "choice") {
    return { text: q, options: (field.options || []).slice(0, 10).map((o, i) => ({ title: String(o).slice(0, 20), payload: `FORMOPT:${i}` })) };
  }
  const hint = field.type === "phone" ? " (masalan: +998 90 123 45 67)" : field.type === "email" ? " (masalan: ism@gmail.com)" : "";
  return { text: q + hint, options: field.required === false ? [{ title: "⏭ O'tkazib yuborish", payload: "FORMSKIP" }] : [] };
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 9) return "+998" + digits;
  if (digits.length === 12 && digits.startsWith("998")) return "+" + digits;
  if (digits.length >= 10 && digits.length <= 15) return "+" + digits;
  return "";
}

/** Javobni tekshiradi. Qaytaradi: { ok, value, error } */
export function validateAnswer(field, text, payload) {
  const t = String(text || "").trim();
  switch (field.type) {
    case "phone": {
      const v = normalizePhone(t);
      return v ? { ok: true, value: v } : { ok: false, error: "Telefon raqam noto'g'ri ko'rinadi. Iltimos, to'liq raqam yozing, masalan: +998 90 123 45 67" };
    }
    case "email":
      return /^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/i.test(t) ? { ok: true, value: t.toLowerCase() } : { ok: false, error: "Email manzil noto'g'ri. Masalan: ism@gmail.com" };
    case "number": {
      const n = Number(t.replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) && t !== "" ? { ok: true, value: String(n) } : { ok: false, error: "Iltimos, faqat raqam yozing." };
    }
    case "choice": {
      const opts = field.options || [];
      if (payload?.startsWith("FORMOPT:")) {
        const i = Number(payload.split(":")[1]);
        if (opts[i] !== undefined) return { ok: true, value: opts[i] };
      }
      const byNum = /^\d+$/.test(t) ? opts[Number(t) - 1] : undefined;
      if (byNum !== undefined) return { ok: true, value: byNum };
      const byText = opts.find((o) => o.toLowerCase() === t.toLowerCase());
      if (byText) return { ok: true, value: byText };
      return { ok: false, error: "Iltimos, quyidagi variantlardan birini tanlang 👇" };
    }
    case "name":
      return t.length >= 2 && t.length <= 60 ? { ok: true, value: t } : { ok: false, error: "Iltimos, ismingizni yozing." };
    default:
      return t ? { ok: true, value: t.slice(0, 500) } : { ok: false, error: "Iltimos, javobingizni matn ko'rinishida yozing." };
  }
}

export function startForm(tenant, key, form, channel) {
  const f = ensureForms(tenant);
  if (!form.fields?.length) return { reply: form.finishMessage || "Rahmat!" };
  f.sessions[key] = { formId: form.id, step: 0, answers: {}, channel, startedAt: Date.now() };
  form.starts = (form.starts || 0) + 1;
  persist(tenant);
  const q = questionFor(form.fields[0]);
  const intro = form.intro ? form.intro + "\n\n" : "";
  return { reply: intro + q.text, options: q.options };
}

export function activeSession(tenant, key) {
  const f = ensureForms(tenant);
  const s = f.sessions[key];
  if (!s) return null;
  if (Date.now() - s.startedAt > SESSION_TTL_MS || !f.list.some((x) => x.id === s.formId)) {
    delete f.sessions[key];
    persist(tenant);
    return null;
  }
  return s;
}

/** Sessiya ochiq bo'lganda kelgan javobni qayta ishlaydi. */
export function handleFormInput(tenant, key, { text, payload }) {
  const f = ensureForms(tenant);
  const s = activeSession(tenant, key);
  if (!s) return null;
  const form = f.list.find((x) => x.id === s.formId);

  if (CANCEL_WORDS.includes(String(text || "").toLowerCase().trim()) || payload === "FORMCANCEL") {
    delete f.sessions[key];
    persist(tenant);
    return { reply: "Forma bekor qilindi. Savollaringiz bo'lsa, bemalol yozing 🙂" };
  }

  const field = form.fields[s.step];
  if (payload === "FORMSKIP" && field.required === false) {
    s.answers[field.label] = "";
  } else {
    const v = validateAnswer(field, text, payload);
    if (!v.ok) {
      const q = questionFor(field);
      return { reply: v.error + (field.type === "choice" ? "" : `\n\n${q.text}`), options: q.options };
    }
    s.answers[field.label] = v.value;
    if (["name", "phone", "email"].includes(field.type)) s[field.type] = v.value;
  }

  s.step++;
  if (s.step < form.fields.length) {
    persist(tenant);
    const q = questionFor(form.fields[s.step]);
    return { reply: q.text, options: q.options };
  }
  return finishForm(tenant, key, form, s);
}

function finishForm(tenant, key, form, s) {
  const f = ensureForms(tenant);
  delete f.sessions[key];

  const sub = {
    id: `sub_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    formId: form.id,
    formName: form.name,
    key,
    channel: s.channel || key.split(":")[0],
    answers: s.answers,
    at: new Date().toISOString(),
    status: "new",
  };
  f.submissions.unshift(sub);
  f.submissions = f.submissions.slice(0, MAX_SUBMISSIONS);
  form.submissionsCount = (form.submissionsCount || 0) + 1;

  // Kontakt kartasiga yozamiz (CRM)
  setFields(tenant, key, { name: s.name, phone: s.phone, email: s.email });
  if (form.tag) addTags(tenant, key, form.tag);
  addTags(tenant, key, "lid");

  // Mavjud "hot lead" ro'yxatiga ham qo'shamiz (dashboard/hisobot bot ko'radi)
  const contact = s.phone || s.email || "";
  if (contact) {
    tenant.leads ||= [];
    tenant.leads.unshift({
      id: `lead_${Date.now()}`,
      key,
      channel: sub.channel,
      contact,
      lastMessage: `[${form.name}] ` + Object.entries(s.answers).map(([k, v]) => `${k}: ${v}`).join("; ").slice(0, 200),
      status: "new",
      createdAt: sub.at,
    });
  }
  persist(tenant);

  fireEvent(tenant, "form_submitted", { form: form.name, contact: key, channel: sub.channel, ...s.answers });
  import("./crm.js").then(({ autoPushCrm }) =>
    autoPushCrm(tenant, "forms", {
      key, title: `${form.name}: ${s.name || s.phone || key}`, name: s.name, phone: s.phone, email: s.email,
      note: Object.entries(s.answers).map(([k, v]) => `${k}: ${v}`).join("\n"), tags: [form.tag].filter(Boolean),
    })
  ).catch(() => {});

  const chatId = tenant.settings?.telegramChatId;
  if (chatId && form.notify !== false) {
    const esc = (x) => String(x ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    const lines = Object.entries(s.answers).map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join("\n");
    const url = `${config.baseUrl || "https://obunext.uz"}/forms?tab=submissions`;
    sendTelegram(chatId, `📝 <b>YANGI ARIZA: ${esc(form.name)}</b>\n\n${lines}\n\n<b>Kanal:</b> ${esc(sub.channel.toUpperCase())}`, {
      inline_keyboard: [[{ text: "📋 Arizalarni ko'rish", url }]],
    }).catch(() => {});
  }

  return { reply: form.finishMessage || "Rahmat! Ma'lumotlaringiz qabul qilindi ✅ Tez orada siz bilan bog'lanamiz." };
}
