/**
 * Kontakt metama'lumotlari (CRM): teglar, eslatma va maydonlar (ism, telefon, email...).
 * tenant.contactMeta[chatKey] = { tags: [], note: "", fields: {}, updatedAt }
 * chatKey — "ig:123", "tg:456" formatidagi to'liq kalit.
 */

export function normTag(tag) {
  return String(tag || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
}

export function getContactMeta(tenant, key) {
  tenant.contactMeta ||= {};
  const m = (tenant.contactMeta[key] ||= { tags: [], note: "", fields: {} });
  m.tags ||= [];
  m.fields ||= {};
  return m;
}

export function addTags(tenant, key, tags) {
  const m = getContactMeta(tenant, key);
  for (const t of [].concat(tags || [])) {
    const n = normTag(t);
    if (n && !m.tags.includes(n)) m.tags.push(n);
  }
  m.updatedAt = new Date().toISOString();
  return m;
}

export function removeTag(tenant, key, tag) {
  const m = getContactMeta(tenant, key);
  m.tags = m.tags.filter((t) => t !== normTag(tag));
  m.updatedAt = new Date().toISOString();
  return m;
}

export function setFields(tenant, key, fields) {
  const m = getContactMeta(tenant, key);
  for (const [k, v] of Object.entries(fields || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") m.fields[k] = String(v).trim().slice(0, 300);
  }
  m.updatedAt = new Date().toISOString();
  return m;
}

/** Barcha kontaktlarda ishlatilgan teglar va ularning soni. */
export function allTags(tenant) {
  const counts = {};
  for (const m of Object.values(tenant.contactMeta || {})) {
    for (const t of m.tags || []) counts[t] = (counts[t] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Kontaktning oxirgi yozgan vaqti (ms) — Meta'ning 24 soatlik oynasi uchun. */
export function lastInboundAt(tenant, key) {
  let last = 0;
  for (const m of tenant.chats?.[key] || []) {
    if (m.role === "user" && m.at) last = Math.max(last, Date.parse(m.at) || 0);
  }
  const lead = (tenant.leads || []).find((l) => l.chatKey === key);
  if (lead?.lastAt) last = Math.max(last, Date.parse(lead.lastAt) || 0);
  return last;
}

/**
 * Suhbat oynasi holati: Instagram/Messenger/WhatsApp erkin xabarni faqat mijoz
 * oxirgi 24 soatda yozgan bo'lsa qabul qiladi. Telegram'da cheklov yo'q
 * (faqat mijoz botni bloklamagan bo'lsa).
 * Qaytaradi: { open, msLeft, label }
 */
export function windowStatus(tenant, key, now = Date.now()) {
  const chan = String(key).split(":")[0];
  if (chan === "tg") {
    const blocked = Boolean(tenant.contactMeta?.[key]?.blocked);
    return { open: !blocked, msLeft: blocked ? 0 : Infinity, label: blocked ? "Botni bloklagan" : "Doim ochiq" };
  }
  const last = lastInboundAt(tenant, key);
  const left = last ? last + WINDOW_MS - now : 0;
  if (left <= 0) return { open: false, msLeft: 0, label: "Oyna yopiq" };
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return { open: true, msLeft: left, label: h ? `${h} soat ${m} daq qoldi` : `${m} daq qoldi` };
}

/** Kontaktning ko'rinadigan nomi: forma ismi > IG username > ID. */
export function displayName(tenant, key) {
  const m = tenant.contactMeta?.[key];
  if (m?.fields?.name) return m.fields.name;
  const id = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  const p = tenant.contactProfiles?.[id];
  if (p?.username) return "@" + p.username;
  if (p?.name) return p.name;
  return id;
}
