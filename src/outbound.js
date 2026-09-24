/**
 * Kanaldan mustaqil javob yuborish — matn + tanlov tugmalari (options).
 *
 * options: [{ title, payload }] yoki [{ title, url }] (havola tugmasi).
 *  - Instagram / Messenger: Quick Replies (payload bilan qaytadi)
 *  - Telegram: inline keyboard (callback_data yoki url)
 *  - WhatsApp: raqamlangan ro'yxat matnga qo'shiladi, mijoz raqam yozadi —
 *    automation.js oxirgi yuborilgan variantlarni eslab, raqamni payload'ga aylantiradi.
 */
import { graphPost } from "./graph.js";
import { sendDirectMessage, sendDirectQuickReplies, sendDirectButtons } from "./services/instagram.js";
import { sendMessengerMessage } from "./services/messenger.js";
import { sendWhatsAppMessage } from "./services/whatsapp.js";
import { callTelegramApi } from "./telegram.js";

/** Kanal nomini qisqa ko'rinishga keltiradi (ig/fb/wa/tg). */
export function chanShort(channel) {
  switch (channel) {
    case "instagram": return "ig";
    case "facebook": return "fb";
    case "whatsapp": return "wa";
    case "telegram": return "tg";
    default: return channel;
  }
}

/** "ig:123" -> { chan: "ig", id: "123" } */
export function splitKey(fullKey) {
  const s = String(fullKey || "");
  const i = s.indexOf(":");
  if (i < 0) return { chan: "ig", id: s };
  return { chan: s.slice(0, i), id: s.slice(i + 1) };
}

/** WhatsApp/matnli kanallar uchun variantlarni raqamlangan ro'yxatga aylantiradi. */
export function optionsAsText(text, options = []) {
  const payloadOpts = options.filter((o) => !o.url);
  const urlOpts = options.filter((o) => o.url);
  let out = String(text || "");
  if (payloadOpts.length) {
    out += "\n\n" + payloadOpts.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
    out += "\n\n👉 Raqamini yozib yuboring";
  }
  if (urlOpts.length) out += "\n\n" + urlOpts.map((o) => `🔗 ${o.title}: ${o.url}`).join("\n");
  return out;
}

function sendMessengerQuickReplies(tenant, psid, text, options) {
  return graphPost(
    "me/messages",
    {
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: {
        text,
        quick_replies: options.slice(0, 13).map((o) => ({
          content_type: "text",
          title: String(o.title).slice(0, 20),
          payload: String(o.payload || o.title),
        })),
      },
    },
    tenant.meta.pageAccessToken
  );
}

function telegramToken(tenant) {
  return tenant.settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || "";
}

/**
 * Bitta mijozga javob yuboradi. channel — "ig"/"instagram" va h.k.
 * Natija: true (yuborildi) / false.
 */
export async function sendReply(tenant, channel, recipientId, text, options = []) {
  const chan = chanShort(channel);
  const opts = (options || []).filter((o) => o && o.title);
  if (!text && !opts.length) return false;

  try {
    if (chan === "tg") {
      const token = telegramToken(tenant);
      if (!token) return false;
      const payload = { chat_id: recipientId, text: String(text || "👇") };
      if (opts.length) {
        payload.reply_markup = {
          inline_keyboard: opts.map((o) => [
            o.url
              ? { text: String(o.title).slice(0, 64), url: o.url }
              : { text: String(o.title).slice(0, 64), callback_data: String(o.payload || o.title).slice(0, 64) },
          ]),
        };
      }
      const r = await callTelegramApi(token, "sendMessage", payload);
      return Boolean(r?.ok);
    }

    if (chan === "wa") {
      const r = await sendWhatsAppMessage(tenant, recipientId, optionsAsText(text, opts));
      return Boolean(r && !r.error);
    }

    const payloadOpts = opts.filter((o) => !o.url);
    const urlOpts = opts.filter((o) => o.url);

    if (chan === "fb") {
      let r;
      if (payloadOpts.length) {
        r = await sendMessengerQuickReplies(tenant, recipientId, optionsAsText(text, urlOpts), payloadOpts);
      } else {
        r = await sendMessengerMessage(tenant, recipientId, optionsAsText(text, urlOpts));
      }
      return Boolean(r && !r.error);
    }

    // Instagram
    let r;
    if (urlOpts.length && !payloadOpts.length) {
      r = await sendDirectButtons(tenant, recipientId, text, urlOpts.slice(0, 3).map((o) => ({ type: "web_url", url: o.url, title: o.title })));
      if (!r || r.error) r = await sendDirectMessage(tenant, recipientId, optionsAsText(text, urlOpts));
    } else if (payloadOpts.length) {
      r = await sendDirectQuickReplies(tenant, recipientId, optionsAsText(text, urlOpts), payloadOpts.slice(0, 13));
    } else {
      r = await sendDirectMessage(tenant, recipientId, text);
    }
    return Boolean(r && !r.error);
  } catch (err) {
    console.error(`[Outbound] ${chan}:${recipientId} ga yuborishda xato:`, err.message);
    return false;
  }
}
