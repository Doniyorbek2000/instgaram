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
