import { graphPost } from "../graph.js";
import { graphUrl } from "../config.js";

/** WhatsApp Cloud API orqali matnli xabar yuboradi. */
export function sendWhatsAppMessage(tenant, to, text) {
  return graphPost(
    `${tenant.meta.whatsappPhoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      // Havola bo'lsa — WhatsApp oldindan ko'rinish (preview) kartasini chiqaradi
      text: { body: text, preview_url: /https?:\/\//i.test(String(text)) },
    },
    tenant.meta.whatsappToken
  );
}

/**
 * WhatsApp interaktiv xabari (reply tugmalari yoki ro'yxat).
 * interactive — outbound.js#buildWhatsAppInteractive natijasi.
 */
export function sendWhatsAppInteractive(tenant, to, interactive) {
  return graphPost(
    `${tenant.meta.whatsappPhoneNumberId}/messages`,
    { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive },
    tenant.meta.whatsappToken,
    { retries: 0 }
  );
}

/**
 * Kiruvchi WhatsApp xabarini "o'qildi" deb belgilaydi. typing=true — mijozga
 * "yozmoqda..." ko'rsatiladi (javob yuborilguncha yoki 25 soniyagacha).
 */
export function markWhatsAppRead(tenant, messageId, { typing = false } = {}) {
  return graphPost(
    `${tenant.meta.whatsappPhoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      ...(typing ? { typing_indicator: { type: "text" } } : {}),
    },
    tenant.meta.whatsappToken,
    { retries: 0 }
  );
}

/** Ovoz (yoki boshqa media) faylni WhatsApp'ga yuklaydi, media ID qaytaradi. */
export async function uploadWhatsAppMedia(tenant, buffer, mimeType) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([buffer], { type: mimeType }), "voice.mp3");
  const res = await fetch(graphUrl(`${tenant.meta.whatsappPhoneNumberId}/media`), {
    method: "POST",
    headers: { Authorization: `Bearer ${tenant.meta.whatsappToken}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    console.error("WhatsApp media yuklash xatosi:", JSON.stringify(data).slice(0, 200));
    return null;
  }
  return data.id;
}

/** Yuklangan ovoz faylni WhatsApp orqali yuboradi. */
export function sendWhatsAppAudio(tenant, to, mediaId) {
  return graphPost(
    `${tenant.meta.whatsappPhoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { id: mediaId },
    },
    tenant.meta.whatsappToken
  );
}
