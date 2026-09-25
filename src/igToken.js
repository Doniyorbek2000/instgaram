/**
 * Instagram Login tokenlarini avtomatik yangilash.
 *
 * Uzoq muddatli token 60 kun amal qiladi. Yangilanmasa bot Instagram'da jimgina
 * ishlamay qoladi. Token 24 soatdan eski va hali muddati o'tmagan bo'lsa,
 * `ig_refresh_token` bilan yana 60 kunga uzaytiriladi. Har 7 kunda bir marta
 * yangilaymiz; yangilab bo'lmasa egasiga Telegram/Push orqali ogohlantirish ketadi.
 */
import { listUsers, persist } from "./db.js";

const DAY = 86400000;
const REFRESH_EVERY_MS = 7 * DAY;
const MIN_AGE_MS = DAY; // Instagram 24 soatdan yosh tokenni yangilamaydi
const WARN_EVERY_MS = 3 * DAY;

export function needsRefresh(meta = {}, now = Date.now()) {
  if (!meta.igAccessToken) return false;
  const refreshed = Date.parse(meta.igTokenRefreshedAt || 0) || 0;
  if (!refreshed) return true; // eski ulanish — muddati noma'lum, darhol yangilaymiz
  if (now - refreshed < MIN_AGE_MS) return false;
  const expires = Date.parse(meta.igTokenExpiresAt || 0) || 0;
  return now - refreshed >= REFRESH_EVERY_MS || (expires && expires - now < 10 * DAY);
}

/** Bitta biznes tokenini yangilaydi. Qaytaradi: { ok } | { error } */
export async function refreshIgToken(tenant, { fetchFn = fetch, now = Date.now() } = {}) {
  const meta = (tenant.meta ||= {});
  const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: meta.igAccessToken });
  let data = {};
  try {
    const res = await fetchFn(`https://graph.instagram.com/refresh_access_token?${qs}`);
    data = await res.json().catch(() => ({}));
  } catch (err) {
    return { error: err.message, network: true };
  }
  if (data.access_token) {
    meta.igAccessToken = data.access_token;
    meta.igTokenExpiresAt = new Date(now + (Number(data.expires_in) || 60 * 86400) * 1000).toISOString();
    meta.igTokenRefreshedAt = new Date(now).toISOString();
    meta.igTokenError = "";
    await persist(tenant);
    return { ok: true };
  }
  const error = String(data.error?.message || "Token yangilanmadi").slice(0, 300);
  meta.igTokenError = error;
  await persist(tenant);
  return { error };
}

async function warnOwner(tenant, error, now) {
  const meta = tenant.meta;
  if (now - (Date.parse(meta.igTokenWarnedAt || 0) || 0) < WARN_EVERY_MS) return;
  meta.igTokenWarnedAt = new Date(now).toISOString();
  await persist(tenant);
  const expires = Date.parse(meta.igTokenExpiresAt || 0) || 0;
  const left = expires ? Math.max(0, Math.ceil((expires - now) / DAY)) : null;
  const text = `⚠️ Instagram ulanishini yangilab bo'lmadi${left !== null ? ` (${left} kun qoldi)` : ""}.\nBot Instagram'da javob bermay qolmasligi uchun panelda Instagram'ni qayta ulang.\nSabab: ${error}`;
  const chatId = tenant.settings?.telegramChatId;
  if (chatId) {
    const { sendTelegram } = await import("./notify.js");
    await sendTelegram(chatId, text).catch(() => {});
  }
  const { notifyPush } = await import("./push.js");
  await Promise.resolve()
    .then(() => notifyPush(tenant, { title: "⚠️ Instagram qayta ulanishi kerak", body: text.split("\n")[1], url: "/dashboard", tag: "ig-token" }))
    .catch(() => {});
}

let running = false;

/** Barcha bizneslar bo'yicha (index.js da har 6 soatda). */
export async function runIgTokenRefresh({ fetchFn = fetch, now = Date.now() } = {}) {
  if (running) return 0;
  running = true;
  let refreshed = 0;
  try {
    for (const tenant of await listUsers()) {
      if (!needsRefresh(tenant.meta, now)) continue;
      const r = await refreshIgToken(tenant, { fetchFn, now });
      if (r.ok) refreshed++;
      else if (!r.network) {
        console.warn(`[IG token] ${tenant.businessName}: ${r.error}`);
        await warnOwner(tenant, r.error, now);
      }
    }
  } finally {
    running = false;
  }
  return refreshed;
}
