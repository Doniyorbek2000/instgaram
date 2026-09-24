/**
 * Kanaldan mustaqil javob yuborish — matn + tanlov tugmalari (options).
 *
 * options: [{ title, payload }] yoki [{ title, url }] (havola tugmasi).
 *  - Instagram / Messenger: Quick Replies (payload bilan qaytadi)
 *  - Telegram: inline keyboard (callback_data yoki url)
 *  - WhatsApp: raqamlangan ro'yxat matnga qo'shiladi, mijoz raqam yozadi —
 *    automation.js oxirgi yuborilgan variantlarni eslab, raqamni payload'ga aylantiradi.
 */
import { graphPost, igGraphPost } from "./graph.js";
import { sanitizeMedia, absoluteMediaUrl } from "./mediaStore.js";
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

/**
 * Ichki (mijoz bo'lmagan) kalitmi: eski versiyalar komment AI javobi tarixini
 * "comment:<id>" / "ig:comment:<id>" kaliti bilan saqlagan — ular Inbox, CRM va
 * ommaviy xabarlarda ko'rinmasligi kerak.
 */
export function isInternalKey(key) {
  const s = String(key || "");
  return s.startsWith("comment:") || /^[a-z]{2}:comment:/.test(s);
}

/**
 * Bazadan ichki "comment:" yozuvlarini o'chiradi (suhbatlar, statistika, CRM, lidlar).
 * Qaytaradi: o'chirilgan yozuvlar soni (0 — o'zgarish yo'q).
 */
export function purgeInternalKeys(tenant) {
  let removed = 0;
  for (const obj of [tenant.chats, tenant.stats?.customers, tenant.contactMeta]) {
    for (const k of Object.keys(obj || {})) {
      if (isInternalKey(k)) {
        delete obj[k];
        removed++;
      }
    }
  }
  if (Array.isArray(tenant.leads)) {
    const before = tenant.leads.length;
    tenant.leads = tenant.leads.filter((l) => !isInternalKey(l?.chatKey) && !isInternalKey(l?.key));
    removed += before - tenant.leads.length;
  }
  return removed;
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
 * Telegram Business: mijoz egasining shaxsiy akkauntiga yozgan bo'lsa, javob
 * bot nomidan emas, egasining akkauntidan (business_connection_id orqali) ketadi.
 */
export function telegramBusinessExtra(tenant, chatId) {
  const conn = tenant.tgBusiness?.chats?.[String(chatId)];
  return conn ? { business_connection_id: conn } : {};
}

const TG_MEDIA = { image: ["sendPhoto", "photo"], video: ["sendVideo", "video"], audio: ["sendAudio", "audio"], file: ["sendDocument", "document"] };
const WA_MEDIA = { image: "image", video: "video", audio: "audio", file: "document" };

/**
 * Kanal uchun media so'rov tanasini quradi (sof funksiya — testlanadi).
 * media: { type: image|video|audio|file|post, url, name, postId, permalink }
 * Qaytaradi: { kind: "ig"|"fb"|"wa"|"tg", method?, body } yoki { fallbackText }.
 */
export function buildMediaPayload(chan, recipientId, media, caption = "") {
  const url = media.url ? absoluteMediaUrl(media.url) : "";
  if (media.type === "post") {
    if (chan === "ig") return { kind: "ig", body: { recipient: { id: recipientId }, message: { attachment: { type: "MEDIA_SHARE", payload: { id: media.postId } } } } };
    return { fallbackText: media.permalink || "" };
  }
  if (!url) return { fallbackText: "" };
  if (chan === "tg") {
    const [method, field] = TG_MEDIA[media.type] || TG_MEDIA.file;
    return { kind: "tg", method, body: { chat_id: recipientId, [field]: url, ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) } };
  }
  if (chan === "wa") {
    const t = WA_MEDIA[media.type] || "document";
    const obj = { link: url };
    if (caption && t !== "audio") obj.caption = String(caption).slice(0, 1024);
    if (t === "document") obj.filename = media.name || url.split("/").pop();
    return { kind: "wa", body: { messaging_product: "whatsapp", to: recipientId, type: t, [t]: obj } };
  }
  const type = media.type === "file" ? "file" : media.type;
  const body = { recipient: { id: recipientId }, message: { attachment: { type, payload: { url, is_reusable: true } } } };
  if (chan === "fb") body.messaging_type = "RESPONSE";
  return { kind: chan === "fb" ? "fb" : "ig", body };
}

/**
 * Bitta mijozga media yuboradi. caption — faqat Telegram/WhatsApp'da media bilan birga
 * ketadi (Instagram/Messenger'da matn alohida xabar bo'lib yuboriladi).
 * Media yuborilmasa, havola matn sifatida yuboriladi — mijoz baribir oladi.
 */
export async function sendMedia(tenant, channel, recipientId, media, caption = "") {
  const chan = chanShort(channel);
  const m = sanitizeMedia(media);
  if (!m) return false;
  const built = buildMediaPayload(chan, recipientId, m, caption);
  try {
    let r = null;
    if (built.kind === "tg") {
      const token = telegramToken(tenant);
      r = token ? await callTelegramApi(token, built.method, { ...built.body, ...telegramBusinessExtra(tenant, recipientId) }) : null;
      if (r?.ok) return true;
    } else if (built.kind === "wa") {
      r = await graphPost(`${tenant.meta.whatsappPhoneNumberId}/messages`, built.body, tenant.meta.whatsappToken);
      if (r && !r.error) return true;
    } else if (built.kind === "fb") {
      r = await graphPost("me/messages", built.body, tenant.meta.pageAccessToken);
      if (r && !r.error) return true;
    } else if (built.kind === "ig") {
      r = await igGraphPost("me/messages", built.body, tenant.meta?.igAccessToken || tenant.meta?.pageAccessToken || "");
      if (r && !r.error) return true;
    }
    // Media o'tmadi — havolani matn qilib yuboramiz
    const link = built.fallbackText || (m.url ? absoluteMediaUrl(m.url) : "");
    if (!link) return false;
    const icon = { image: "🖼️", video: "🎬", audio: "🎧", file: "📎", post: "📸" }[m.type] || "📎";
    return sendReply(tenant, chan, recipientId, `${icon} ${m.name ? m.name + "\n" : ""}${link}`);
  } catch (err) {
    console.error(`[Outbound] media ${chan}:${recipientId}:`, err.message);
    return false;
  }
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
      const payload = { chat_id: recipientId, text: String(text || "👇"), ...telegramBusinessExtra(tenant, recipientId) };
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
