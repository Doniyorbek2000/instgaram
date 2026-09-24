/**
 * CRM bilan to'g'ridan-to'g'ri ulanish (Make/Zapier'siz):
 *  - amoCRM / Kommo — "uzoq muddatli token" (Настройки → Интеграции → Создать интеграцию →
 *    Ключи и доступы → Долгосрочный токен) va subdomen
 *  - Bitrix24 — kiruvchi webhook manzili (Разработчикам → Другое → Входящий вебхук, crm huquqi)
 *
 * Lid (bitim) yaratiladi: nom, telefon, email, summa, izoh, teglar. Bir mijoz uchun
 * bitim bir marta ochiladi — keyingi ma'lumotlar o'sha bitimga izoh bo'lib qo'shiladi.
 *
 * tenant.integrations.crm = {
 *   type: "" | "amocrm" | "bitrix24",
 *   amo: { domain, token, pipelineId, statusId },
 *   bitrix: { webhookUrl },
 *   auto: { forms, leads, ai, orders },
 * }
 * contactMeta[key].crmLeadId — ochilgan bitim ID'si
 */
import { persist } from "./db.js";
import { isSafeUrl, ensureIntegrations } from "./integrations.js";
import { getContactMeta } from "./contacts.js";

const TIMEOUT_MS = 8000;

export const CRM_TYPES = { "": "Ulanmagan", amocrm: "amoCRM / Kommo", bitrix24: "Bitrix24" };
const AUTO_DEFAULTS = { forms: true, leads: true, ai: true, orders: true };

export function crmSettings(tenant) {
  const integ = ensureIntegrations(tenant);
  const c = (integ.crm ||= {});
  c.type ||= "";
  c.amo ||= {};
  c.bitrix ||= {};
  c.auto = { ...AUTO_DEFAULTS, ...(c.auto || {}) };
  return c;
}

export const crmConnected = (tenant) => {
  const c = crmSettings(tenant);
  return (c.type === "amocrm" && c.amo.domain && c.amo.token) || (c.type === "bitrix24" && c.bitrix.webhookUrl) ? c.type : "";
};

/** "mycompany", "mycompany.amocrm.ru", "https://mycompany.kommo.com/" → "mycompany.amocrm.ru" */
export function normalizeAmoDomain(v) {
  let d = String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (d && !d.includes(".")) d = `${d}.amocrm.ru`;
  return /^[a-z0-9-]+\.(amocrm\.(ru|com)|kommo\.com)$/.test(d) ? d : "";
}

export function saveCrmSettings(tenant, body = {}) {
  const c = crmSettings(tenant);
  const errors = [];
  c.type = CRM_TYPES[body.crmType] !== undefined ? body.crmType : "";
  if (c.type === "amocrm") {
    const domain = normalizeAmoDomain(body.amoDomain);
    if (!domain) errors.push("amoCRM manzili noto'g'ri (masalan: kompaniya.amocrm.ru)");
    c.amo.domain = domain;
    if (String(body.amoToken || "").trim()) c.amo.token = String(body.amoToken).trim().slice(0, 4000);
    c.amo.pipelineId = /^\d{1,12}$/.test(String(body.amoPipeline || "")) ? String(body.amoPipeline) : "";
    c.amo.statusId = /^\d{1,12}$/.test(String(body.amoStatus || "")) ? String(body.amoStatus) : "";
  }
  if (c.type === "bitrix24") {
    const url = String(body.bitrixUrl || "").trim().replace(/\/?$/, "/");
    if (!isSafeUrl(url) || !/\/rest\/\d+\/[\w]+\/$/.test(url)) errors.push("Bitrix24 webhook manzili noto'g'ri (…/rest/1/xxxx/ ko'rinishida bo'lishi kerak)");
    else c.bitrix.webhookUrl = url;
  }
  for (const k of Object.keys(AUTO_DEFAULTS)) c.auto[k] = body[`crmAuto_${k}`] === "on";
  persist(tenant);
  return errors;
}

async function request(url, { method = "POST", token = "", body, fetchFn = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.name === "AbortError" ? "timeout" : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function logCrm(tenant, ok, status, what) {
  const integ = ensureIntegrations(tenant);
  integ.log.unshift({ at: new Date().toISOString(), event: what, target: crmSettings(tenant).type, ok, status });
  integ.log = integ.log.slice(0, 50);
}

/**
 * CRM'da lid/bitim ochadi (yoki mavjudiga izoh qo'shadi).
 * lead: { key, title, name, phone, email, price, note, tags }
 * Qaytaradi: { ok, id?, error? }
 */
export async function pushCrmLead(tenant, lead = {}, { fetchFn = fetch } = {}) {
  const type = crmConnected(tenant);
  if (!type) return { ok: false, error: "CRM ulanmagan" };
  const c = crmSettings(tenant);
  const meta = lead.key ? getContactMeta(tenant, lead.key) : null;
  const existing = meta?.crmLeadId && meta.crmType === type ? meta.crmLeadId : "";
  const title = String(lead.title || `Obunext: ${lead.name || lead.phone || lead.key || "yangi lid"}`).slice(0, 250);
  const note = [lead.note, lead.key ? `Chat: ${lead.key}` : ""].filter(Boolean).join("\n").slice(0, 4000);

  if (type === "amocrm") {
    const base = `https://${c.amo.domain}/api/v4`;
    if (existing) {
      const r = await request(`${base}/leads/${existing}/notes`, { token: c.amo.token, body: [{ note_type: "common", params: { text: [title, lead.phone, lead.email, note].filter(Boolean).join("\n") } }], fetchFn });
      logCrm(tenant, r.ok, r.status, "crm_note");
      persist(tenant);
      return r.ok ? { ok: true, id: existing, updated: true } : { ok: false, error: `amoCRM: ${r.status || r.error}` };
    }
    const fields = [];
    if (lead.phone) fields.push({ field_code: "PHONE", values: [{ value: String(lead.phone), enum_code: "WORK" }] });
    if (lead.email) fields.push({ field_code: "EMAIL", values: [{ value: String(lead.email), enum_code: "WORK" }] });
    const item = {
      name: title,
      ...(Number(lead.price) > 0 ? { price: Math.round(Number(lead.price)) } : {}),
      ...(c.amo.pipelineId ? { pipeline_id: Number(c.amo.pipelineId) } : {}),
      ...(c.amo.statusId ? { status_id: Number(c.amo.statusId) } : {}),
      _embedded: {
        contacts: [{ first_name: String(lead.name || lead.phone || "Mijoz").slice(0, 100), ...(fields.length ? { custom_fields_values: fields } : {}) }],
        tags: [...new Set(["obunext", ...(lead.tags || [])])].slice(0, 10).map((name) => ({ name: String(name).slice(0, 50) })),
      },
    };
    const r = await request(`${base}/leads/complex`, { token: c.amo.token, body: [item], fetchFn });
    const id = Array.isArray(r.data) ? r.data[0]?.id : r.data?.[0]?.id;
    logCrm(tenant, r.ok && id, r.status, "crm_lead");
    if (!r.ok || !id) {
      persist(tenant);
      return { ok: false, error: `amoCRM: ${r.status || r.error}${r.data?.title ? ` ${r.data.title}` : ""}` };
    }
    if (note) await request(`${base}/leads/${id}/notes`, { token: c.amo.token, body: [{ note_type: "common", params: { text: note } }], fetchFn });
    if (meta) Object.assign(meta, { crmLeadId: String(id), crmType: type });
    persist(tenant);
    return { ok: true, id: String(id) };
  }

  // Bitrix24
  const hook = c.bitrix.webhookUrl;
  if (existing) {
    const r = await request(`${hook}crm.timeline.comment.add.json`, { body: { fields: { ENTITY_ID: Number(existing), ENTITY_TYPE: "lead", COMMENT: [title, lead.phone, lead.email, note].filter(Boolean).join("\n") } }, fetchFn });
    logCrm(tenant, r.ok, r.status, "crm_note");
    persist(tenant);
    return r.ok ? { ok: true, id: existing, updated: true } : { ok: false, error: `Bitrix24: ${r.status || r.error}` };
  }
  const r = await request(`${hook}crm.lead.add.json`, {
    body: {
      fields: {
        TITLE: title,
        NAME: String(lead.name || "").slice(0, 100),
        ...(lead.phone ? { PHONE: [{ VALUE: String(lead.phone), VALUE_TYPE: "WORK" }] } : {}),
        ...(lead.email ? { EMAIL: [{ VALUE: String(lead.email), VALUE_TYPE: "WORK" }] } : {}),
        ...(Number(lead.price) > 0 ? { OPPORTUNITY: Number(lead.price), CURRENCY_ID: "UZS" } : {}),
        COMMENTS: note,
        SOURCE_ID: "OTHER",
        SOURCE_DESCRIPTION: "Obunext",
      },
      params: { REGISTER_SONET_EVENT: "Y" },
    },
    fetchFn,
  });
  const id = r.data?.result;
  logCrm(tenant, r.ok && id, r.status, "crm_lead");
  if (!r.ok || !id) {
    persist(tenant);
    return { ok: false, error: `Bitrix24: ${r.status || r.error}${r.data?.error_description ? ` ${r.data.error_description}` : ""}` };
  }
  if (meta) Object.assign(meta, { crmLeadId: String(id), crmType: type });
  persist(tenant);
  return { ok: true, id: String(id) };
}

/** Avtomatik uzatish (forma, hot lead, AI, buyurtma) — sozlamada yoqilgan bo'lsa, fon rejimida. */
export function autoPushCrm(tenant, source, lead) {
  if (!crmConnected(tenant) || !crmSettings(tenant).auto[source]) return;
  pushCrmLead(tenant, lead).then((r) => {
    if (!r.ok) console.error(`[CRM] ${tenant.businessName}: ${r.error}`);
  }).catch((err) => console.error("[CRM]", err.message));
}

/** Ulanishni tekshiradi va amoCRM voronkalarini qaytaradi. */
export async function testCrm(tenant, { fetchFn = fetch } = {}) {
  const type = crmConnected(tenant);
  if (!type) return { ok: false, error: "Avval CRM ma'lumotlarini kiriting" };
  const c = crmSettings(tenant);
  if (type === "amocrm") {
    const r = await request(`https://${c.amo.domain}/api/v4/leads/pipelines`, { method: "GET", token: c.amo.token, fetchFn });
    if (!r.ok) return { ok: false, error: `amoCRM javob bermadi (${r.status || r.error}) — token va manzilni tekshiring` };
    const pipelines = (r.data?._embedded?.pipelines || []).map((p) => ({
      id: p.id, name: p.name,
      statuses: (p._embedded?.statuses || []).map((s) => ({ id: s.id, name: s.name })),
    }));
    return { ok: true, pipelines };
  }
  const r = await request(`${c.bitrix.webhookUrl}crm.status.list.json`, { body: { filter: { ENTITY_ID: "STATUS" } }, fetchFn });
  if (!r.ok) return { ok: false, error: `Bitrix24 javob bermadi (${r.status || r.error}) — webhook manzilini va crm huquqini tekshiring` };
  return { ok: true, statuses: (r.data?.result || []).map((s) => ({ id: s.STATUS_ID, name: s.NAME })) };
}
