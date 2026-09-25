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
import { sendWhatsAppMessage, sendWhatsAppInteractive } from "./services/whatsapp.js";
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

/**
 * Kanal bitta xabarda qabul qiladigan eng uzun matn (belgi). Oshib ketsa Meta/Telegram
 * xabarni butunlay rad etadi va mijoz hech narsa olmaydi — shuning uchun bo'lib yuboramiz.
 */
export const TEXT_LIMITS = { ig: 1000, fb: 2000, wa: 4096, tg: 4096 };

/**
 * Uzun matnni limitdan oshmaydigan bo'laklarga ajratadi: avval xat boshi, keyin qator,
 * gap, so'z chegarasida (so'z o'rtasidan kesilmaydi). Bo'sh matn — [].
 */
export function splitText(text, limit) {
  let rest = String(text || "").trim();
  const out = [];
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = -1;
    for (const sep of ["\n\n", "\n", ". ", "! ", "? ", " "]) {
      const i = window.lastIndexOf(sep);
      if (i >= limit * 0.4) {
        cut = i + sep.length;
        break;
      }
    }
    if (cut <= 0) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Matnni bitta xabarga sig'diradi (Private Reply kabi faqat BITTA xabar mumkin bo'lgan joylar uchun). */
export function clipText(text, limit) {
  const s = String(text || "");
  if (s.length <= limit) return s;
  const head = splitText(s, limit - 1)[0] || s.slice(0, limit - 1);
  return `${head.slice(0, limit - 1)}…`;
}

/** UTF-8 baytlari bo'yicha qisqartiradi (Telegram callback_data — 64 BAYT, belgi emas). */
export function clipBytes(value, maxBytes) {
  let s = String(value || "");
  while (Buffer.byteLength(s, "utf8") > maxBytes) s = s.slice(0, -1);
  return s;
}

/**
 * WhatsApp interaktiv xabar tanasi: 1–3 variant — tugmalar, 4–10 — ro'yxat (menu).
 * Mos kelmasa (havola tugmasi, 10 dan ko'p variant, uzun/takroriy id) — null,
 * unda raqamlangan matn yuboriladi.
 */
export function buildWhatsAppInteractive(text, options = []) {
  const opts = (options || []).filter((o) => o && o.title);
  if (!opts.length || opts.length > 10 || opts.some((o) => o.url)) return null;
  const ids = opts.map((o) => String(o.payload || o.title));
  if (new Set(ids).size !== ids.length || ids.some((id) => id.length > 200)) return null;
  const body = String(text || "👇");
  if (opts.length <= 3) {
    const titles = opts.map((o) => String(o.title).slice(0, 20));
    if (new Set(titles).size !== titles.length || body.length > 1024) return null;
    return {
      type: "button",
      body: { text: body },
      action: { buttons: opts.map((o, i) => ({ type: "reply", reply: { id: ids[i], title: titles[i] } })) },
    };
  }
  return {
    type: "list",
    body: { text: body },
    action: {
      button: "Tanlash",
      sections: [{ title: "Variantlar", rows: opts.map((o, i) => ({ id: ids[i], title: String(o.title).slice(0, 24), ...(String(o.title).length > 24 ? { description: String(o.title).slice(0, 72) } : {}) })) }],
    },
  };
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

  // Limitdan uzun matn: oldingi bo'laklar oddiy xabar, tugmalar oxirgi bo'lak bilan ketadi
  // (variantlar matn oxiriga qo'shilishi mumkin — ularga joy qoldiramiz)
  const reserve = opts.length ? optionsAsText("", opts).length + 10 : 0;
  const onlyLinks = chan === "ig" && opts.length && opts.every((o) => o.url);
  const limit = chan === "wa" && opts.length && opts.length <= 3 ? 1024 : onlyLinks ? 640 : (TEXT_LIMITS[chan] || TEXT_LIMITS.ig) - reserve;
  const parts = splitText(text, Math.max(300, limit));
  if (parts.length > 1) {
    for (const part of parts.slice(0, -1)) {
      if (!(await sendReply(tenant, chan, recipientId, part))) return false;
    }
    return sendReply(tenant, chan, recipientId, parts[parts.length - 1], opts);
  }

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
              : { text: String(o.title).slice(0, 64), callback_data: clipBytes(o.payload || o.title, 64) },
          ]),
        };
      }
      const r = await callTelegramApi(token, "sendMessage", payload);
      return Boolean(r?.ok);
    }

    if (chan === "wa") {
      // Variantlar — haqiqiy WhatsApp tugmalari/ro'yxati; rad etilsa raqamli matn
      const interactive = buildWhatsAppInteractive(text, opts);
      if (interactive) {
        const ri = await sendWhatsAppInteractive(tenant, recipientId, interactive);
        if (ri && !ri.error) return true;
      }
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

/**
 * Mahsulot kartochkalari (karusel): Instagram/Messenger — generic template (10 tagacha),
 * Telegram — rasm + tugma, WhatsApp — raqamli ro'yxat.
 * items: [{ title, subtitle, image, buttons: [{ title, payload } | { title, url }] }]
 */
export async function sendCarousel(tenant, channel, recipientId, items = []) {
  const chan = chanShort(channel);
  const list = (items || []).filter((x) => x && x.title).slice(0, 10);
  if (!list.length) return false;
  try {
    if (chan === "ig" || chan === "fb") {
      const elements = list.map((it) => ({
        title: String(it.title).slice(0, 80),
        ...(it.subtitle ? { subtitle: String(it.subtitle).slice(0, 80) } : {}),
        ...(it.image && /^https:\/\//i.test(it.image) ? { image_url: it.image } : {}),
        buttons: (it.buttons || []).slice(0, 3).map((b) =>
          b.url ? { type: "web_url", url: b.url, title: String(b.title).slice(0, 20) } : { type: "postback", payload: String(b.payload).slice(0, 1000), title: String(b.title).slice(0, 20) }
        ),
      }));
      const body = { recipient: { id: recipientId }, message: { attachment: { type: "template", payload: { template_type: "generic", elements } } } };
      const r = chan === "ig"
        ? await igGraphPost("me/messages", body, tenant.meta?.igAccessToken || tenant.meta?.pageAccessToken || "")
        : await graphPost("me/messages", { ...body, messaging_type: "RESPONSE" }, tenant.meta?.pageAccessToken || "");
      if (r && !r.error) return true;
      // Shablon qabul qilinmasa — oddiy matn + tugmalar
      const opts = list.flatMap((it) => (it.buttons || []).filter((b) => b.payload).slice(0, 1).map((b) => ({ title: `${it.title}`.slice(0, 20), payload: b.payload })));
      return sendReply(tenant, channel, recipientId, list.map((it, i) => `${i + 1}. ${it.title}${it.subtitle ? ` — ${it.subtitle}` : ""}`).join("\n"), opts);
    }
    if (chan === "tg") {
      const token = telegramToken(tenant);
      if (!token) return false;
      let ok = false;
      for (const it of list) {
        const keyboard = { inline_keyboard: (it.buttons || []).slice(0, 3).map((b) => [b.url ? { text: String(b.title).slice(0, 64), url: b.url } : { text: String(b.title).slice(0, 64), callback_data: clipBytes(b.payload, 64) }]) };
        const caption = `<b>${String(it.title).replace(/[<>&]/g, "")}</b>${it.subtitle ? `\n${String(it.subtitle).replace(/[<>&]/g, "")}` : ""}`;
        const extra = telegramBusinessExtra(tenant, recipientId);
        const r = it.image
          ? await callTelegramApi(token, "sendPhoto", { chat_id: recipientId, photo: it.image, caption, parse_mode: "HTML", reply_markup: keyboard, ...extra })
          : await callTelegramApi(token, "sendMessage", { chat_id: recipientId, text: caption, parse_mode: "HTML", reply_markup: keyboard, ...extra });
        ok = ok || Boolean(r?.ok);
      }
      return ok;
    }
    // WhatsApp va boshqalar — raqamli ro'yxat (optionsAsText raqamlaydi)
    const opts = list.flatMap((it) => (it.buttons || []).filter((b) => b.payload).slice(0, 1).map((b) => ({ title: `${it.title}${it.subtitle ? ` — ${it.subtitle}` : ""}`, payload: b.payload })));
    return sendReply(tenant, channel, recipientId, "🛍️ Katalog:", opts);
  } catch (err) {
    console.error(`[Outbound] karusel ${chan}:${recipientId}:`, err.message);
    return false;
  }
}
