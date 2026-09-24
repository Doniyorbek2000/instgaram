/**
 * Telegram Bot Kanal Integratsiyasi (Telegram Bot Channel Integration).
 *  - Har bir biznes egasining shaxsiy Telegram Bot Tokeni bilan ishlaydi
 *  - Webhook: /telegram/webhook/:userId
 *  - Matn, ovoz va rasm xabarlarini AI & Rules Engine orqali qayta ishlaydi
 */

import { Router } from "express";
import { findUserById, persist } from "./db.js";
import { processMessage } from "./respond.js";
import { fetchAsBase64 } from "./media.js";
import { sendReply } from "./outbound.js";

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
  const result = await callTelegramApi(token, "setWebhook", {
    url: webhookUrl,
    allowed_updates: ["message", "edited_message", "callback_query"],
  });

  if (result?.ok) {
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

  const update = req.body || {};
  const token = user.settings?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;

  // Inline tugma bosildi (sovg'a tanlash, viktorina javobi, forma varianti, obuna tekshiruvi...)
  const cq = update.callback_query;
  if (cq?.data && cq.message?.chat?.id) {
    if (token) answerCallback(token, cq.id).catch(() => {});
    if (cq.message.chat.type !== "private") return;
    const chatId = String(cq.message.chat.id);
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
    profile: { username: message.from?.username || "", name: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") },
  });
  if (reply) {
    await sendReply(user, "telegram", chatId, reply, quickReplies);
  }
});
