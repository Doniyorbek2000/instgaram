import { processMessage } from "../respond.js";
import { isDuplicate } from "../dedup.js";
import { fetchWhatsAppMedia } from "../media.js";
import { synthesize, ttsAvailable } from "../tts.js";
import { canUseAi, consumeAi } from "../credits.js";
import { ttsCredits, recordAiCost } from "../aiCost.js";
import { sendReply } from "../outbound.js";
import {
  markWhatsAppRead,
  uploadWhatsAppMedia,
  sendWhatsAppAudio,
} from "../services/whatsapp.js";

const MEDIA_TYPES = ["image", "audio", "video", "voice", "document", "sticker"];

/**
 * Kiruvchi WhatsApp xabaridan matn, bosilgan tugma (payload) va media ID'ni ajratadi.
 * Sof funksiya — testlanadi. Qaytaradi: { text, payload, mediaId } yoki null (e'tiborsiz).
 */
export function parseWhatsAppMessage(message) {
  const type = message?.type;
  if (type === "text") return { text: message.text?.body || "", payload: "", mediaId: "" };
  if (type === "interactive") {
    // Bizning reply tugmasi yoki ro'yxatdan tanlov — id = payload
    const r = message.interactive?.button_reply || message.interactive?.list_reply;
    return r ? { text: r.title || "", payload: r.id || "", mediaId: "" } : null;
  }
  if (type === "button") {
    // Shablon (template) xabaridagi quick reply tugmasi
    return { text: message.button?.text || "", payload: message.button?.payload || "", mediaId: "" };
  }
  if (type === "location") {
    const l = message.location || {};
    if (l.latitude === undefined || l.longitude === undefined) return null;
    const place = [l.name, l.address].filter(Boolean).join(", ");
    return { text: `📍 Lokatsiya${place ? `: ${place}` : ""}\nhttps://maps.google.com/?q=${l.latitude},${l.longitude}`, payload: "", mediaId: "" };
  }
  if (type === "contacts") {
    const c = message.contacts?.[0];
    const phone = c?.phones?.[0]?.phone || c?.phones?.[0]?.wa_id || "";
    const name = c?.name?.formatted_name || "";
    return phone || name ? { text: `👤 Kontakt: ${[name, phone].filter(Boolean).join(" ")}`, payload: "", mediaId: "" } : null;
  }
  if (MEDIA_TYPES.includes(type)) {
    if (type === "sticker") return null; // stiker — javob talab qilmaydi
    const obj = message[type];
    return { text: obj?.caption || "", payload: "", mediaId: obj?.id || "" };
  }
  return null; // reaction, system, unsupported va h.k.
}

/** WhatsApp webhook (object: "whatsapp_business_account") hodisalarini qayta ishlaydi. */
export async function handleWhatsAppEntry(tenant, entry) {
  for (const change of entry.changes || []) {
    if (change.field !== "messages") continue;

    // Yetkazilmagan xabarlar (24 soatlik oyna yopilgan, raqam WhatsApp'da yo'q va h.k.)
    for (const st of change.value?.statuses || []) {
      if (st.status !== "failed") continue;
      const e = st.errors?.[0] || {};
      console.warn(`[WhatsApp] ${tenant.businessName}: ${st.recipient_id} ga xabar yetkazilmadi — ${e.code || ""} ${e.title || e.message || ""}`.trim());
    }

    const contacts = change.value?.contacts || [];
    for (const message of change.value?.messages || []) {
      const from = message.from;
      if (!from) continue;
      if (isDuplicate(message.id)) continue; // takroriy webhook

      const parsed = parseWhatsAppMessage(message);
      if (!parsed) continue;
      const { text, payload, mediaId } = parsed;
      const media = [];
      if (mediaId) {
        try {
          media.push(await fetchWhatsAppMedia(mediaId, tenant.meta.whatsappToken));
        } catch (err) {
          console.error("WhatsApp mediani yuklab bo'lmadi:", err.message);
        }
      }
      if (!text && !payload && media.length === 0) continue;

      const name = contacts.find((c) => c.wa_id === from)?.profile?.name || contacts[0]?.profile?.name || "";
      console.log(
        `[WhatsApp] ${tenant.businessName}: ${from} -> "${text}"${payload ? ` [${payload}]` : ""} (${media.length} media, tur: ${message.type})`
      );
      // O'qildi + "yozmoqda..." — kosmetik, javobni kutib turmaydi
      markWhatsAppRead(tenant, message.id, { typing: true }).catch(() => {});

      const { reply, quickReplies } = await processMessage(tenant, "whatsapp", from, {
        text,
        media,
        payload,
        messageId: message.id || "",
        profile: { name, username: "" },
      });
      if (!reply) continue;

      // Ovozli javob: tadbirkor yoqib qo'ygan va platformada TTS sozlangan bo'lsa,
      // matn bilan birga ovozli javob ham yuboramiz.
      // Ovoz ham AI xarajati — kredit tugagan bo'lsa faqat matn yuboriladi
      const wantVoice = Boolean(tenant.settings?.voiceReplies) && ttsAvailable && canUseAi(tenant);
      if (wantVoice) {
        try {
          const audio = await synthesize(reply);
          if (audio) {
            const chars = Math.min(600, reply.length);
            consumeAi(tenant, ttsCredits(chars));
            recordAiCost(tenant, { kind: "tts", ttsChars: chars });
            const audioId = await uploadWhatsAppMedia(tenant, audio, "audio/mpeg");
            if (audioId) await sendWhatsAppAudio(tenant, from, audioId);
          }
        } catch (err) {
          console.error("Ovozli javob yuborilmadi:", err.message);
        }
      }

      // Matnli javob (ovoz qo'shimcha); variantlar WhatsApp tugmalari yoki ro'yxati bo'ladi
      const ok = await sendReply(tenant, "whatsapp", from, reply, quickReplies);
      if (!ok) console.error(`[WhatsApp] ${tenant.businessName} -> ${from}: javob yuborilmadi`);
    }
  }
}
