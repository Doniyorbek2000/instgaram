import { processMessage } from "../respond.js";
import { isDuplicate } from "../dedup.js";
import { fetchWhatsAppMedia } from "../media.js";
import { synthesize, ttsAvailable } from "../tts.js";
import { sendReply } from "../outbound.js";
import {
  markWhatsAppRead,
  uploadWhatsAppMedia,
  sendWhatsAppAudio,
} from "../services/whatsapp.js";

/** WhatsApp webhook (object: "whatsapp_business_account") hodisalarini qayta ishlaydi. */
export async function handleWhatsAppEntry(tenant, entry) {
  for (const change of entry.changes || []) {
    if (change.field !== "messages") continue;

    for (const message of change.value?.messages || []) {
      const from = message.from;
      if (!from) continue;
      if (isDuplicate(message.id)) continue; // takroriy webhook

      let text = "";
      const media = [];

      if (message.type === "text") {
        text = message.text?.body || "";
      } else if (["image", "audio", "video", "voice", "document"].includes(message.type)) {
        const mediaObj = message[message.type];
        text = mediaObj?.caption || "";
        if (mediaObj?.id) {
          try {
            media.push(
              await fetchWhatsAppMedia(mediaObj.id, tenant.meta.whatsappToken)
            );
          } catch (err) {
            console.error("WhatsApp mediani yuklab bo'lmadi:", err.message);
          }
        }
      } else {
        continue; // sticker, location va h.k. — hozircha o'tkazib yuboramiz
      }

      if (!text && media.length === 0) continue;

      console.log(
        `[WhatsApp] ${tenant.businessName}: ${from} -> "${text}" (${media.length} media, tur: ${message.type})`
      );
      await markWhatsAppRead(tenant, message.id);

      const { reply, quickReplies } = await processMessage(tenant, "whatsapp", from, { text, media });
      if (!reply) continue;

      // Ovozli javob: tadbirkor yoqib qo'ygan va platformada TTS sozlangan bo'lsa,
      // matn bilan birga ovozli javob ham yuboramiz.
      const wantVoice = Boolean(tenant.settings?.voiceReplies) && ttsAvailable;
      if (wantVoice) {
        try {
          const audio = await synthesize(reply);
          if (audio) {
            const mediaId = await uploadWhatsAppMedia(tenant, audio, "audio/mpeg");
            if (mediaId) await sendWhatsAppAudio(tenant, from, mediaId);
          }
        } catch (err) {
          console.error("Ovozli javob yuborilmadi:", err.message);
        }
      }

      // Matnli javobni ham yuboramiz (ovoz qo'shimcha); variantlar raqamlangan ro'yxat bo'ladi
      await sendReply(tenant, "whatsapp", from, reply, quickReplies);
    }
  }
}
