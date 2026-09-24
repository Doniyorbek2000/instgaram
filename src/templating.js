/**
 * Xabar matnidagi o'zgaruvchilarni almashtiradi (ChatPlace "variables").
 *
 *   {name}            — kontakt ismi (forma/o'zgaruvchi → IG ism → @username)
 *   {first_name}      — ismning birinchi so'zi
 *   {username}        — Instagram username (@ belgisisiz)
 *   {points}          — geymifikatsiya ballari
 *   {business}        — biznes nomi
 *   {ig_profile}      — biznesning Instagram profili havolasi (instagram.com/...)
 *   {date} / {time}   — bugungi sana / hozirgi vaqt (biznes vaqt mintaqasida)
 *   {phone}, {email}, {har_qanday_maydon} — kontakt kartasidagi (flow "input" bloki
 *                       yoki forma orqali yig'ilgan) qiymatlar
 *   {name|do'stim}    — qiymat bo'sh bo'lsa "|" dan keyingi zaxira matn ishlatiladi
 *
 * Noma'lum o'zgaruvchi bo'sh satrga almashtiriladi — mijozga hech qachon "{xyz}"
 * ko'rinishidagi xom shablon yetib bormaydi.
 */
import { splitKey } from "./outbound.js";

export const DEFAULT_TIMEZONE = "Asia/Tashkent";

/** Biznes vaqt mintaqasidagi joriy sana/vaqt qismlari. */
export function zonedParts(tenant, now = new Date()) {
  const timeZone = tenant?.settings?.timezone || DEFAULT_TIMEZONE;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return zonedParts({ settings: { timezone: DEFAULT_TIMEZONE } }, now);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const weekdays = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: weekdays[get("weekday")] || 1,
  };
}

/** Kontakt haqida ma'lum barcha o'zgaruvchilar (kalitlar kichik harfda). */
export function contactVars(tenant, key) {
  const fields = tenant.contactMeta?.[key]?.fields || {};
  const { id } = splitKey(key);
  const profile = tenant.contactProfiles?.[id] || {};
  const participant = tenant.gamification?.participants?.[key];
  const name = fields.name || profile.name || (profile.username ? `@${profile.username}` : "");
  const now = zonedParts(tenant);

  const vars = {};
  for (const [k, v] of Object.entries(fields)) vars[String(k).toLowerCase()] = String(v ?? "");
  Object.assign(vars, {
    name,
    first_name: String(fields.name || profile.name || "").split(/\s+/)[0] || "",
    username: profile.username || "",
    points: String(participant?.points ?? 0),
    business: tenant.businessName || "",
    ig_username: tenant.meta?.igUsername || "",
    ig_profile: tenant.meta?.igUsername ? `instagram.com/${tenant.meta.igUsername}` : "",
    date: now.date,
    time: now.time,
  });
  return vars;
}

/** Matndagi {o'zgaruvchi} va {o'zgaruvchi|zaxira} larni almashtiradi. */
export function renderTemplate(text, tenant, key, extra = {}) {
  const src = String(text ?? "");
  if (!src.includes("{")) return src;
  const vars = { ...contactVars(tenant, key), ...extra };
  return src.replace(/\{([a-z0-9_]{1,40})(?:\|([^{}]{0,80}))?\}/gi, (_m, name, fallback = "") => {
    const value = vars[name.toLowerCase()];
    return value !== undefined && String(value).trim() !== "" ? String(value) : fallback;
  });
}
