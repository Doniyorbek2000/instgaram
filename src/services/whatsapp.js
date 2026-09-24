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
      text: { body: text },
    },
    tenant.meta.whatsappToken
  );
}

/** Kiruvchi WhatsApp xabarini "o'qildi" deb belgilaydi. */
export function markWhatsAppRead(tenant, messageId) {
  return graphPost(
    `${tenant.meta.whatsappPhoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    },
    tenant.meta.whatsappToken
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
