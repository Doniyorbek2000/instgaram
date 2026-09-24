import { config, graphUrl } from "./config.js";

const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB — Gemini inline limitiga mos

/**
 * URL'dan media faylni yuklab olib base64 qaytaradi.
 * Katta fayllar (video) 15 MB dan kesiladi — AI'ga sig'ishi uchun.
 */
export async function fetchAsBase64(url, authToken) {
  const res = await fetch(url, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (!res.ok) {
    throw new Error(`Media yuklab olinmadi (${res.status}): ${url.slice(0, 80)}`);
  }
  const mimeType = (res.headers.get("content-type") || "application/octet-stream")
    .split(";")[0]
    .trim();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error(`Media juda katta (${Math.round(buffer.length / 1e6)} MB)`);
  }
  return { mimeType, data: buffer.toString("base64") };
}

/**
 * WhatsApp media ID'sini yuklab olinadigan URL'ga aylantiradi,
 * so'ng faylni yuklab oladi (ikkalasi ham token talab qiladi).
 */
export async function fetchWhatsAppMedia(mediaId, token) {
  const metaRes = await fetch(graphUrl(mediaId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.url) {
    throw new Error(`WhatsApp media topilmadi: ${JSON.stringify(meta)}`);
  }
  const file = await fetchAsBase64(meta.url, token);
  // WhatsApp o'z mime turini aniq beradi — shuni ishlatamiz
  if (meta.mime_type) file.mimeType = meta.mime_type.split(";")[0].trim();
  return file;
}
