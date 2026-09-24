// Telegram orqali biznes egasiga bildirishnoma yuboradi.
import { config } from "./config.js";
import { notifyPush } from "./push.js";

const botToken = process.env.TELEGRAM_BOT_TOKEN || "";

export const telegramAvailable = Boolean(botToken);

/** Berilgan chat ID'ga xabar yuboradi. Xato bo'lsa false. */
export async function sendTelegram(chatId, text, replyMarkup = null) {
  if (!botToken || !chatId) return false;
  try {
    const bodyObj = { chat_id: chatId, text, parse_mode: "HTML" };
    if (replyMarkup) bodyObj.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("Telegram xatosi:", JSON.stringify(data).slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Telegram so'rovida xato:", err.message);
    return false;
  }
}

/** Biznes egasiga operator chaqirilgani haqida xabar beradi. */
export function notifyHandoff(tenant, channel, chatKey) {
  notifyPush(tenant, { title: "🚨 Operator chaqirildi", body: `${String(channel).toUpperCase()} · ${chatKey}`, url: `/inbox?chat=${encodeURIComponent(chatKey)}`, tag: `handoff-${chatKey}` });
  const chatId = tenant.settings?.telegramChatId;
  if (!chatId) return Promise.resolve(false);

  const inboxUrl = `${config.baseUrl || "http://localhost:" + config.port}/inbox?chat=${encodeURIComponent(chatKey)}`;
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "💬 Live Inbox'da Ochish", url: inboxUrl },
      ],
    ],
  };

  return sendTelegram(
    chatId,
    `🚨 <b>OPERATOR CHAQIRILDI!</b>\n\n<b>Biznes:</b> ${tenant.businessName || "Biznes"}\n<b>Kanal:</b> ${channel.toUpperCase()}\n<b>Mijoz ID:</b> <code>${chatKey}</code>\n\n📌 <i>Bot ushbu muloqot uchun vaqtincha to'xtatildi. Web Inbox orqali bevosita javob berishingiz mumkin.</i>`,
    inlineKeyboard
  );
}

/** Biznes egasiga yangi haridor/buyurtma haridor (Hot Lead) haqida telegraf bildirishnoma yuboradi. */
export function notifyHotLead(tenant, channel, chatKey, text) {
  notifyPush(tenant, { title: "🛍️ Yangi lid", body: String(text || "").slice(0, 160), url: `/inbox?chat=${encodeURIComponent(chatKey)}`, tag: `lead-${chatKey}` });
  const chatId = tenant.settings?.telegramChatId;
  if (!chatId) return Promise.resolve(false);

  const inboxUrl = `${config.baseUrl || "https://obunext.uz"}/inbox?chat=${encodeURIComponent(chatKey)}`;
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "💬 Live Inbox'da Javob Berish", url: inboxUrl },
      ],
    ],
  };

  return sendTelegram(
    chatId,
    `🛍️ <b>YANGI HARIDOR / BUYURTMA (HOT LEAD)!</b>\n\n<b>Biznes:</b> ${tenant.businessName || "Biznes"}\n<b>Kanal:</b> ${channel.toUpperCase()}\n<b>Mijoz:</b> <code>${chatKey}</code>\n\n💬 <b>Matn:</b> "${text}"\n\n🚀 <i>Mijoz harid qilish istagini bildirdi! Live Inbox orqali darhol aloqaga chiqing.</i>`,
    inlineKeyboard
  );
}
