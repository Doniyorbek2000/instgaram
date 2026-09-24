/**
 * Telegram Bot Kanal Integratsiyasi (Telegram Bot Channel Integration).
 *  - Har bir biznes egasining shaxsiy Telegram Bot Tokeni bilan ishlaydi
 *  - Webhook: /telegram/webhook/:userId
 *  - Matn, ovoz va rasm xabarlarini AI & Rules Engine orqali qayta ishlaydi
 */

import { Router } from "express";
import crypto from "node:crypto";
import { findUserById, persist } from "./db.js";
import { pushChat } from "./chatStore.js";
import { processMessage } from "./respond.js";
import { fetchAsBase64 } from "./media.js";
import { sendReply, telegramBusinessExtra } from "./outbound.js";

export const telegramRouter = Router();

/** Telegram Bot API ga so'rov yuboruvchi yordamchi funksiya */
export async function callTelegramApi(token, method, payload = {}) {
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`Telegram API xatosi (${method}):`, JSON.stringify(data));
      return null;
    }
    return data;
  } catch (err) {
    console.error(`Telegram API tarmoq xatosi (${method}):`, err.message);
    return null;
  }
}

/** Telegram foydalanuvchisiga matnli javob yuboradi */
export async function sendTelegramMessage(user, chatId, text) {
  const token = user.settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !text) return false;

  const result = await callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: String(text),
    ...telegramBusinessExtra(user, chatId),
  });

  return Boolean(result?.ok);
}

/**
 * Foydalanuvchi biznesning Telegram kanaliga a'zomi (obuna tekshiruvi).
 * true/false — aniq javob; null — tekshirib bo'lmadi (bot kanalda admin emas,
 * kanal sozlanmagan va h.k.). Bot kanalga ADMIN qilib qo'shilgan bo'lishi shart.
 */
export async function isTelegramChannelMember(user, telegramUserId) {
  const token = user.settings?.telegramBotToken;
  const channel = user.settings?.telegramChannel;
  if (!token || !channel || !telegramUserId) return null;
  const r = await callTelegramApi(token, "getChatMember", { chat_id: channel, user_id: Number(telegramUserId) });
  if (!r?.ok) return null;
  const st = r.result?.status;
  if (["creator", "administrator", "member"].includes(st)) return true;
  if (st === "restricted") return Boolean(r.result?.is_member);
  return false;
}

/** Istalgan kanal/guruhga a'zolikni tekshiradi (flow shartlari uchun). null — tekshirib bo'lmadi. */
export async function isTelegramMemberOf(user, channel, telegramUserId) {
  const token = user.settings?.telegramBotToken;
  const chat = String(channel || "").trim().replace(/^https?:\/\/t\.me\//, "@");
  if (!token || !chat || !telegramUserId) return null;
  const r = await callTelegramApi(token, "getChatMember", { chat_id: chat, user_id: Number(telegramUserId) });
  if (!r?.ok) return null;
  const st = r.result?.status;
  if (["creator", "administrator", "member"].includes(st)) return true;
  if (st === "restricted") return Boolean(r.result?.is_member);
  return false;
}

/** Foydalanuvchi kanalga "boost" berganmi (bot kanalda admin bo'lishi shart). */
export async function hasTelegramBoost(user, channel, telegramUserId) {
  const token = user.settings?.telegramBotToken;
  const chat = String(channel || user.settings?.telegramChannel || "").trim().replace(/^https?:\/\/t\.me\//, "@");
  if (!token || !chat || !telegramUserId) return null;
  const r = await callTelegramApi(token, "getUserChatBoosts", { chat_id: chat, user_id: Number(telegramUserId) });
  if (!r?.ok) return null;
  return (r.result?.boosts || []).length > 0;
}

/** Kanal havolasi (@kanal -> https://t.me/kanal). */
export function telegramChannelUrl(user) {
  const ch = String(user.settings?.telegramChannel || "").trim();
  if (!ch) return "";
  if (ch.startsWith("http")) return ch;
  return `https://t.me/${ch.replace(/^@/, "")}`;
}

/** Telegram Webhook ni botga ulash (Set Webhook) */
export async function setupTelegramWebhook(user) {
  const token = user.settings?.telegramBotToken;
  if (!token) return false;

  const baseUrl = process.env.BASE_URL || "";
  if (!baseUrl) return false;

  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/telegram/webhook/${user.id}`;
  // Maxfiy kalit: Telegram har bir so'rovda X-Telegram-Bot-Api-Secret-Token sarlavhasida
  // qaytaradi — shu bilan soxta (Telegram'dan kelmagan) update'lar rad etiladi.
  // Kalit faqat Telegram setWebhook'ni QABUL QILGANDAN keyin saqlanadi — aks holda
  // (tarmoq xatosi va h.k.) eski, kalitsiz webhook'dan kelgan update'lar rad etilib, bot jim qolardi
  const secret = user.settings.telegramWebhookSecret || crypto.randomBytes(24).toString("hex");
  const result = await callTelegramApi(token, "setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "edited_message", "callback_query", "business_connection", "business_message"],
  });

  if (result?.ok) {
    user.settings.telegramWebhookSecret = secret;
    console.log(`[Telegram Webhook] Muvaffaqiyatli o'rnatildi (${user.businessName}): ${webhookUrl}`);
    user.settings.telegramWebhookSet = true;
    // Referal havolalar (t.me/<bot>?start=...) uchun bot username'ini saqlaymiz
    const me = await callTelegramApi(token, "getMe");
    if (me?.result?.username) user.settings.telegramBotUsername = me.result.username;
    persist(user);
    return true;
  }
  return false;
}

/**
 * Webhook maxfiy kalitini tekshiradi. Kalit o'rnatilmagan eski ulanishlar
 * (secret_token'siz setWebhook) vaqtincha qabul qilinadi — server ishga
 * tushganda ular avtomatik qayta ro'yxatdan o'tkaziladi (refreshTelegramWebhooks).
 */
export function isValidTelegramSecret(user, header) {
  const secret = user.settings?.telegramWebhookSecret;
  if (!secret) return true;
  const a = Buffer.from(String(header || ""));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Server ishga tushganda: secret_token'siz ulangan botlarni qayta ro'yxatdan o'tkazadi. */
export async function refreshTelegramWebhooks(users) {
  for (const u of users) {
    if (!u.settings?.telegramBotToken || u.settings?.telegramWebhookSecret) continue;
    const ok = await setupTelegramWebhook(u).catch(() => false);
    console.log(`[Telegram] ${u.businessName}: webhook maxfiy kalit bilan yangilandi — ${ok ? "OK" : "XATO"}`);
  }
}

// ============ Telegram Business ============

/**
 * business_connection: ega Telegram Premium → Business → Chatbots bo'limida
 * botni ulaganda, ruxsatlarini o'zgartirganda yoki uzganda keladi.
 */
export function handleBusinessConnection(user, conn) {
  const canReply = conn.rights ? Boolean(conn.rights.can_reply) : Boolean(conn.can_reply);
  const tb = (user.tgBusiness ||= {});
  tb.connectionId = conn.id;
  tb.ownerId = String(conn.user?.id || "");
  tb.ownerName = [conn.user?.first_name, conn.user?.last_name].filter(Boolean).join(" ") || conn.user?.username || "";
  tb.ownerUsername = conn.user?.username || "";
  tb.enabled = Boolean(conn.is_enabled);
  tb.canReply = canReply;
  tb.updatedAt = new Date().toISOString();
  tb.autoReply ??= true;
  tb.chats ||= {};
  if (!tb.enabled) tb.chats = {};
  persist(user);
  console.log(`[Telegram Business] ${user.businessName}: ${tb.enabled ? "ulandi" : "uzildi"} (${tb.ownerName}, javob berish: ${canReply ? "ha" : "yo'q"})`);
}

/**
 * business_message: egasining shaxsiy akkauntidagi chatdagi xabar.
 *  - Mijoz yozgan bo'lsa → AI/flow javob beradi (egasining nomidan).
 *  - Egasi o'zi yozgan bo'lsa → shu chatda bot 2 soat jim turadi (operator rejimi),
 *    xabar Inbox tarixiga "operator" sifatida yoziladi.
 */
export async function handleBusinessMessage(user, message, token) {
  const tb = user.tgBusiness || {};
  if (!message?.chat?.id || message.chat.type !== "private") return;
  if (!tb.enabled || message.business_connection_id !== tb.connectionId) return;
  const chatId = String(message.chat.id);
  const key = `tg:${chatId}`;
  const text = message.text || message.caption || "";

  if (String(message.from?.id) === tb.ownerId) {
    user.manualChats ||= {};
    user.manualChats[key] = Date.now() + 2 * 60 * 60 * 1000;
    if (text) pushChat(user, key, { role: "operator", text });
    else pushChat(user, key);
    persist(user);
    return;
  }

  tb.chats ||= {};
  tb.chats[chatId] = message.business_connection_id;
  persist(user);
  if (!tb.autoReply || !tb.canReply) return;

  const media = [];
  if (token && message.voice?.file_id) {
    const fileInfo = await callTelegramApi(token, "getFile", { file_id: message.voice.file_id });
    if (fileInfo?.result?.file_path) {
      try {
        media.push(await fetchAsBase64(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`));
      } catch (err) {
        console.error("[Telegram Business] ovozni yuklab bo'lmadi:", err.message);
      }
    }
  }
  if (!text && !media.length) return;

  console.log(`[Telegram Business] ${user.businessName}: ${chatId} -> "${text}"`);
  const { reply, quickReplies } = await processMessage(user, "telegram", chatId, {
    text,
    media,
    profile: { username: message.from?.username || "", name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") },
  });
  if (reply) await sendReply(user, "telegram", chatId, reply, quickReplies);
}

/** Callback (inline tugma) bosilganda — tugma "soat" belgisini o'chiradi. */
function answerCallback(token, id) {
  return callTelegramApi(token, "answerCallbackQuery", { callback_query_id: id });
}


/**
 * Telegram Webhook Handler (/telegram/webhook/:userId)
 * Kiruvchi Telegram xabarlarini qabul qiladi
 */
telegramRouter.post("/telegram/webhook/:userId", async (req, res) => {
  res.sendStatus(200); // Telegram 200 OK kutadi

  const { userId } = req.params;
  const user = await findUserById(userId);
  if (!user) return;
  if (!isValidTelegramSecret(user, req.get("x-telegram-bot-api-secret-token"))) {
    console.warn(`[Telegram] ${user.businessName}: noto'g'ri secret token — update rad etildi`);
    return;
  }

  const update = req.body || {};
  const token = user.settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;

  // Telegram Business: ega botni shaxsiy akkauntiga ulaganda / uzganda
  if (update.business_connection) {
    handleBusinessConnection(user, update.business_connection);
    return;
  }
  // Telegram Business: mijoz egasining shaxsiy akkauntiga yozdi (yoki egasi o'zi yozdi)
  if (update.business_message) {
    await handleBusinessMessage(user, update.business_message, token);
    return;
  }

  // Inline tugma bosildi (sovg'a tanlash, viktorina javobi, forma varianti, obuna tekshiruvi...)
  const cq = update.callback_query;
  if (cq?.data && cq.message?.chat?.id) {
    if (token) answerCallback(token, cq.id).catch(() => {});
    if (cq.message.chat.type !== "private") return;
    const chatId = String(cq.message.chat.id);
    if (cq.message.business_connection_id && user.tgBusiness?.enabled && cq.message.business_connection_id === user.tgBusiness.connectionId) {
      user.tgBusiness.chats ||= {};
      user.tgBusiness.chats[chatId] = cq.message.business_connection_id;
    }
    const { reply, quickReplies } = await processMessage(user, "telegram", chatId, {
      text: "",
      payload: cq.data,
      profile: { username: cq.from?.username || "", name: [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") },
    });
    if (reply) await sendReply(user, "telegram", chatId, reply, quickReplies);
    return;
  }

  const message = update.message;
  if (!message || !message.chat?.id) return;
  // Guruh/kanal xabarlariga bot javob bermaydi — faqat shaxsiy chat
  if (message.chat.type && message.chat.type !== "private") return;
  // Mijoz botga to'g'ridan-to'g'ri yozdi — javoblar endi bot nomidan ketadi
  if (user.tgBusiness?.chats?.[String(message.chat.id)]) {
    delete user.tgBusiness.chats[String(message.chat.id)];
    persist(user);
  }

  const chatId = String(message.chat.id);
  let text = message.text || message.caption || "";

  // /start g_ABC123 — referal havola orqali kelgan yangi foydalanuvchi
  let ref = "";
  const startMatch = text.match(/^\/start(?:@\w+)?\s*(.*)$/);
  if (startMatch) {
    ref = startMatch[1].trim();
    text = ref ? "" : "/start";
  }

  // Media yuklab olish (rasm yoki ovozli xabar)
  const media = [];

  if (token) {
    try {
      if (message.photo?.length) {
        // Eng katak rasm versiyasi
        const photo = message.photo[message.photo.length - 1];
        const fileInfo = await callTelegramApi(token, "getFile", { file_id: photo.file_id });
        if (fileInfo?.result?.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
          media.push(await fetchAsBase64(fileUrl));
        }
      } else if (message.voice?.file_id) {
        const fileInfo = await callTelegramApi(token, "getFile", { file_id: message.voice.file_id });
        if (fileInfo?.result?.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`;
          media.push(await fetchAsBase64(fileUrl));
        }
      }
    } catch (err) {
      console.error("Telegram media yuklashda xato:", err.message);
    }
  }

  if (!text && !ref && media.length === 0) return;

  console.log(`[Telegram] ${user.businessName}: ${chatId} -> "${text}"${ref ? ` (ref: ${ref})` : ""} (${media.length} media)`);

  const { reply, quickReplies } = await processMessage(user, "telegram", chatId, {
    text,
    media,
    ref,
    messageId: String(message.message_id || ""),
    profile: { username: message.from?.username || "", name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") },
  });
  if (reply) {
    await sendReply(user, "telegram", chatId, reply, quickReplies);
  }
});
