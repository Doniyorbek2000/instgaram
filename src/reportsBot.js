/**
 * Telegram "Hisobot Boti" — butun platforma uchun UMUMIY, bitta bot.
 *
 * Bu src/telegram.js (har bir biznesning O'Z boti — mijozlar bilan suhbat kanali)
 * va src/notify.js (ad-hoc handoff/hot-lead bildirishnomalari) dan butunlay boshqa,
 * uchinchi narsa: tadbirkor bitta umumiy botni ochadi, tilni tanlaydi, telefon
 * raqamini yuboradi — tizim shu raqamni /settings sahifasidagi akkauntiga (u yerda
 * kiritilgan raqamga) bog'laydi va statistikasini shu botda ko'rsatadi.
 *
 * Oqim:
 *   1. Foydalanuvchi botga /start yozadi -> til tanlash tugmalari
 *   2. Til tanlanadi -> telefon raqamini so'raymiz (Telegram "contact share" tugmasi)
 *   3. Raqam kelganda -> shu raqam bilan /settings'da ro'yxatdan o'tgan akkauntni
 *      topamiz, chatId'ni saqlaymiz, darhol joriy hisobotni yuboramiz
 *   4. Bog'langan foydalanuvchi doimiy menyu tugmalaridan birini tanlaydi:
 *      📊 Hisobot — statistikani qayta yuboradi
 *      🎓 AI'ni o'qitish — joriy bilimlar bazasini ko'rsatib, ➕ Qo'shish /
 *         ✏️ Almashtirish / 🗑 Tozalash amallarini taklif qiladi (haqiqatan
 *         tenant.businessInfo'ni o'zgartiradi — saytdagi AI Studio bilan bir xil maydon)
 *      🏢 Holat — obuna, AI o'qitilganmi, qaysi kanallar ulanganini ko'rsatadi
 *      📸 Joylash — rasm/video yuborilsa, Post / Reels / Story tanlatib Instagram'ga
 *         joylaydi (saytdagi /scheduler bilan bir xil scheduledPosts navbati)
 *   5. Har kuni (server ~09:00 da) checkAndSendDailyReports() avtomatik hisobot yuboradi
 */

import { Router } from "express";
import crypto from "node:crypto";
import { listUsers, persist } from "./db.js";
import { statsSummary } from "./engagement.js";
import { statusInfo } from "./subscription.js";
import { saveUpload } from "./mediaStore.js";
import { publishDuePosts } from "./postPublisher.js";

// Bot API getFile faqat 20 MB gacha faylni yuklab berishga ruxsat beradi
const TG_DOWNLOAD_LIMIT = 20 * 1024 * 1024;
// Instagram faqat JPEG rasm va MP4/MOV video qabul qiladi
const POSTABLE_MIME = ["image/jpeg", "video/mp4", "video/quicktime"];

const TOKEN = process.env.REPORTS_BOT_TOKEN || "";
export const reportsBotAvailable = Boolean(TOKEN);

// Kunlik hisobot yuboriladigan server soati (0-23)
const DAILY_REPORT_HOUR = 9;

/** Bot @username — setupReportsBotWebhook() da bir marta olinib keshlanadi (/settings uchun) */
let cachedBotUsername = "";
export function getReportsBotUsername() {
  return cachedBotUsername;
}

/** Bog'lanmagan chat'lar uchun vaqtinchalik onboarding holati (serverni qayta ishga
 * tushirish holatni tozalaydi — foydalanuvchi shunchaki qayta til tanlaydi, zarari yo'q). */
const sessions = new Map(); // chatId -> { step: "phone", lang }

/** Telegram Bot API ga so'rov (har doim REPORTS_BOT_TOKEN bilan) */
export async function callReportsBotApi(method, payload = {}) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[ReportsBot] API xatosi (${method}):`, JSON.stringify(data).slice(0, 300));
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[ReportsBot] tarmoq xatosi (${method}):`, err.message);
    return null;
  }
}

/** Raqamni faqat raqamlarga qisqartirib, oxirgi 9 xonasini oladi (+998/998/0 prefikslariga chidamli) */
export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.slice(-9);
}

/** /settings'da shu telefon raqamini kiritgan foydalanuvchini topadi */
export async function findUserByPhone(phone) {
  const target = normalizePhone(phone);
  if (!target || target.length < 9) return null;
  const users = await listUsers();
  return users.find((u) => normalizePhone(u.settings?.phone) === target) || null;
}

/** Hisobot botiga allaqachon bog'langan foydalanuvchini chatId bo'yicha topadi */
export async function findUserByReportsChatId(chatId) {
  const id = String(chatId || "");
  if (!id) return null;
  const users = await listUsers();
  return users.find((u) => String(u.settings?.reportsTelegramChatId || "") === id) || null;
}

const TXT = {
  uz: {
    chooseLang: "Salom! 👋 Obunext Hisobot Boti. Tilni tanlang:",
    askPhone: "Rahmat! Endi saytdagi akkauntingizga bog'lash uchun telefon raqamingizni yuboring 👇",
    contactBtn: "📱 Raqamni yuborish",
    notFound: "Bu raqam saytdagi hech bir akkauntga bog'lanmagan. Avval /settings sahifasida shu raqamni kiriting, so'ng qayta urinib ko'ring.",
    linked: (b) => `✅ ${b} akkauntiga bog'landingiz! Bundan buyon shu botda kunlik hisobotingizni ko'rasiz va quyidagi tugmalar orqali akkauntingizni boshqarishingiz mumkin.\n\n`,
    report: (s, hot) => `📊 *Hisobot*\n\n💬 Jami xabarlar: ${s.messages}\n👥 Noyob mijozlar: ${s.customers}\n🛒 Xarid so'rovlari: ${s.orders}\n\n📷 Instagram: ${s.channels.instagram || 0} | 📘 Facebook: ${s.channels.facebook || 0} | 💚 WhatsApp: ${s.channels.whatsapp || 0}${hot.length ? `\n\n🔥 So'nggi qiziqqan mijozlar:\n${hot.map((l) => `• ${l.contact} — ${l.lastMessage || ""}`).join("\n")}` : ""}`,
    btnReport: "📊 Hisobot",
    btnTrain: "🎓 AI'ni o'qitish",
    btnStatus: "🏢 Holat",
    trainEmptyNote: "📚 Hozircha AI bilimlar bazasi bo'sh.",
    trainCurrentLabel: (len) => `📚 Joriy bilimlar bazasi (${len} belgi):`,
    trainChooseAction: "Nima qilmoqchisiz?",
    btnAdd: "➕ Qo'shish",
    btnReplace: "✏️ Almashtirish",
    btnClear: "🗑 Tozalash",
    btnBack: "⬅️ Orqaga",
    btnYes: "✅ Ha, o'chirish",
    btnNo: "❌ Yo'q, bekor",
    trainPrompt: "✍️ Matn yuboring — men buni AI bilimlar bazasiga QO'SHAMAN (narxlar, manzil, ish vaqti, mahsulotlar va h.k. haqida). Bekor qilish uchun /bekor yozing.",
    replacePrompt: "✍️ Yangi to'liq matnni yuboring — bu ESKI bilimlar bazasini BUTUNLAY ALMASHTIRADI. Bekor qilish uchun /bekor yozing.",
    clearConfirm: "🗑 Rostdan ham butun bilimlar bazasini o'chirmoqchimisiz? Bu amalni qaytarib bo'lmaydi.",
    cleared: "🗑 Bilimlar bazasi tozalandi.",
    trainCancelled: "Bekor qilindi.",
    trainSaved: (len) => `✅ Saqlandi! Endi AI bilimlar bazasi ${len} belgidan iborat. Sayt orqali ham ko'rish/tahrirlash mumkin: /account`,
    statusText: (b, sub, u, infoLen) =>
      `🏢 *${b}*\n\n💳 Obuna: ${sub.label}\n🤖 AI o'qitilgan: ${infoLen > 0 ? `✅ ha (${infoLen} belgi)` : "❌ yo'q"}\n\n🔌 Ulangan kanallar:\n📷 Instagram: ${u.meta?.igAccessToken || u.meta?.pageAccessToken ? "✅" : "❌"}\n📘 Facebook: ${u.meta?.pageAccessToken ? "✅" : "❌"}\n💚 WhatsApp: ${u.meta?.whatsappToken ? "✅" : "❌"}`,
    btnPost: "📸 Joylash",
    postHint: "📸 Rasm yoki video yuboring (izoh qo'shsangiz — post tavsifi bo'ladi). Keyin Post / Reels / Story tanlaysiz. Video 20 MB gacha.",
    postAsk: "Instagram'ga qanday joylaymiz?",
    btnFeed: "🖼 Post",
    btnReel: "🎬 Reels",
    btnStory: "📱 Story",
    btnCancel: "❌ Bekor",
    postNoIg: "Instagram ulanmagan. Avval saytda Instagram'ni ulang.",
    postTooBig: "Fayl 20 MB dan katta — Telegram bot orqali olib bo'lmaydi. Saytdagi /scheduler sahifasidan yuklang.",
    postBadFile: "Faqat JPG rasm yoki MP4/MOV video joylash mumkin.",
    postExpired: "Fayl topilmadi — iltimos, qayta yuboring.",
    postQueued: "⏳ Instagram'ga yuborildi. Video bo'lsa qayta ishlash bir necha daqiqa oladi — tayyor bo'lgach xabar beraman.",
    postDone: (type) => `✅ Instagram'ga joylandi (${type}).`,
    postFailed: (err) => `❌ Joylab bo'lmadi: ${err}`,
  },
  ru: {
    chooseLang: "Здравствуйте! 👋 Obunext Бот отчётов. Выберите язык:",
    askPhone: "Спасибо! Теперь отправьте номер телефона, чтобы привязать аккаунт на сайте 👇",
    contactBtn: "📱 Отправить номер",
    notFound: "Этот номер не привязан ни к одному аккаунту на сайте. Сначала введите его на странице /settings и повторите попытку.",
    linked: (b) => `✅ Вы привязаны к аккаунту ${b}! Теперь ежедневный отчёт будет приходить в этот бот, а кнопки ниже позволят управлять аккаунтом.\n\n`,
    report: (s, hot) => `📊 *Отчёт*\n\n💬 Всего сообщений: ${s.messages}\n👥 Уникальных клиентов: ${s.customers}\n🛒 Запросов на покупку: ${s.orders}\n\n📷 Instagram: ${s.channels.instagram || 0} | 📘 Facebook: ${s.channels.facebook || 0} | 💚 WhatsApp: ${s.channels.whatsapp || 0}${hot.length ? `\n\n🔥 Недавно заинтересованные клиенты:\n${hot.map((l) => `• ${l.contact} — ${l.lastMessage || ""}`).join("\n")}` : ""}`,
    btnReport: "📊 Отчёт",
    btnTrain: "🎓 Обучить AI",
    btnStatus: "🏢 Статус",
    trainEmptyNote: "📚 База знаний AI пока пуста.",
    trainCurrentLabel: (len) => `📚 Текущая база знаний (${len} симв.):`,
    trainChooseAction: "Что хотите сделать?",
    btnAdd: "➕ Добавить",
    btnReplace: "✏️ Заменить",
    btnClear: "🗑 Очистить",
    btnBack: "⬅️ Назад",
    btnYes: "✅ Да, удалить",
    btnNo: "❌ Нет, отмена",
    trainPrompt: "✍️ Отправьте текст — я ДОБАВЛЮ его в базу знаний AI (цены, адрес, часы работы, товары и т.д.). Для отмены напишите /bekor.",
    replacePrompt: "✍️ Отправьте новый полный текст — он ПОЛНОСТЬЮ ЗАМЕНИТ старую базу знаний. Для отмены напишите /bekor.",
    clearConfirm: "🗑 Вы точно хотите удалить всю базу знаний? Это действие нельзя отменить.",
    cleared: "🗑 База знаний очищена.",
    trainCancelled: "Отменено.",
    trainSaved: (len) => `✅ Сохранено! Теперь база знаний AI — ${len} символов. Также можно посмотреть/изменить на сайте: /account`,
    statusText: (b, sub, u, infoLen) =>
      `🏢 *${b}*\n\n💳 Подписка: ${sub.label}\n🤖 AI обучен: ${infoLen > 0 ? `✅ да (${infoLen} симв.)` : "❌ нет"}\n\n🔌 Подключённые каналы:\n📷 Instagram: ${u.meta?.igAccessToken || u.meta?.pageAccessToken ? "✅" : "❌"}\n📘 Facebook: ${u.meta?.pageAccessToken ? "✅" : "❌"}\n💚 WhatsApp: ${u.meta?.whatsappToken ? "✅" : "❌"}`,
    btnPost: "📸 Опубликовать",
    postHint: "📸 Отправьте фото или видео (подпись станет описанием поста). Затем выберите Пост / Reels / Story. Видео до 20 МБ.",
    postAsk: "Как опубликовать в Instagram?",
    btnFeed: "🖼 Пост",
    btnReel: "🎬 Reels",
    btnStory: "📱 Story",
    btnCancel: "❌ Отмена",
    postNoIg: "Instagram не подключён. Сначала подключите его на сайте.",
    postTooBig: "Файл больше 20 МБ — бот Telegram не может его получить. Загрузите на сайте: /scheduler.",
    postBadFile: "Можно публиковать только фото JPG или видео MP4/MOV.",
    postExpired: "Файл не найден — отправьте его ещё раз.",
    postQueued: "⏳ Отправлено в Instagram. Обработка видео занимает несколько минут — сообщу, когда будет готово.",
    postDone: (type) => `✅ Опубликовано в Instagram (${type}).`,
    postFailed: (err) => `❌ Не удалось опубликовать: ${err}`,
  },
  en: {
    chooseLang: "Hello! 👋 Obunext Reports Bot. Choose your language:",
    askPhone: "Thanks! Now send your phone number to link your website account 👇",
    contactBtn: "📱 Send phone number",
    notFound: "This number isn't linked to any account on the site. Add it on the /settings page first, then try again.",
    linked: (b) => `✅ Linked to ${b}! From now on your daily report will arrive in this bot, and the buttons below let you manage your account.\n\n`,
    report: (s, hot) => `📊 *Report*\n\n💬 Total messages: ${s.messages}\n👥 Unique customers: ${s.customers}\n🛒 Purchase inquiries: ${s.orders}\n\n📷 Instagram: ${s.channels.instagram || 0} | 📘 Facebook: ${s.channels.facebook || 0} | 💚 WhatsApp: ${s.channels.whatsapp || 0}${hot.length ? `\n\n🔥 Recently interested customers:\n${hot.map((l) => `• ${l.contact} — ${l.lastMessage || ""}`).join("\n")}` : ""}`,
    btnReport: "📊 Report",
    btnTrain: "🎓 Train AI",
    btnStatus: "🏢 Status",
    trainEmptyNote: "📚 The AI knowledge base is empty right now.",
    trainCurrentLabel: (len) => `📚 Current knowledge base (${len} chars):`,
    trainChooseAction: "What would you like to do?",
    btnAdd: "➕ Add",
    btnReplace: "✏️ Replace",
    btnClear: "🗑 Clear",
    btnBack: "⬅️ Back",
    btnYes: "✅ Yes, delete",
    btnNo: "❌ No, cancel",
    trainPrompt: "✍️ Send text — I'll ADD it to the AI knowledge base (prices, address, hours, products, etc.). Send /bekor to cancel.",
    replacePrompt: "✍️ Send the new full text — this will COMPLETELY REPLACE the old knowledge base. Send /bekor to cancel.",
    clearConfirm: "🗑 Are you sure you want to delete the entire knowledge base? This cannot be undone.",
    cleared: "🗑 Knowledge base cleared.",
    trainCancelled: "Cancelled.",
    trainSaved: (len) => `✅ Saved! The AI knowledge base is now ${len} characters. You can also view/edit it on the site: /account`,
    statusText: (b, sub, u, infoLen) =>
      `🏢 *${b}*\n\n💳 Subscription: ${sub.label}\n🤖 AI trained: ${infoLen > 0 ? `✅ yes (${infoLen} chars)` : "❌ no"}\n\n🔌 Connected channels:\n📷 Instagram: ${u.meta?.igAccessToken || u.meta?.pageAccessToken ? "✅" : "❌"}\n📘 Facebook: ${u.meta?.pageAccessToken ? "✅" : "❌"}\n💚 WhatsApp: ${u.meta?.whatsappToken ? "✅" : "❌"}`,
    btnPost: "📸 Publish",
    postHint: "📸 Send a photo or video (its caption becomes the post caption). Then choose Post / Reels / Story. Videos up to 20 MB.",
    postAsk: "How should it go on Instagram?",
    btnFeed: "🖼 Post",
    btnReel: "🎬 Reels",
    btnStory: "📱 Story",
    btnCancel: "❌ Cancel",
    postNoIg: "Instagram isn't connected. Connect it on the site first.",
    postTooBig: "The file is over 20 MB — the Telegram bot can't fetch it. Upload it on the site: /scheduler.",
    postBadFile: "Only JPG photos or MP4/MOV videos can be published.",
    postExpired: "File not found — please send it again.",
    postQueued: "⏳ Sent to Instagram. Video processing takes a few minutes — I'll message you when it's live.",
    postDone: (type) => `✅ Published on Instagram (${type}).`,
    postFailed: (err) => `❌ Couldn't publish: ${err}`,
  },
};

/**
 * Hisobot matnini quradi. user.leads massivida ikki xil obyekt shakli aralash
 * turadi (engagement.js va respond.js turli maqsadda yozadi) — shuning uchun
 * faqat `.contact` maydoni bor yozuvlarni ("haqiqiy xarid niyatidagilar") olamiz,
 * boshqalarini e'tiborsiz qoldiramiz.
 */
export function buildReportText(user, lang = "uz") {
  const t = TXT[lang] || TXT.uz;
  const s = statsSummary(user);
  const hot = (user.leads || []).filter((l) => l && l.contact).slice(0, 5);
  return t.report(s, hot);
}

function langKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🇺🇿 O'zbekcha", callback_data: "lang:uz" },
        { text: "🇷🇺 Русский", callback_data: "lang:ru" },
        { text: "🇬🇧 English", callback_data: "lang:en" },
      ],
    ],
  };
}

function contactKeyboard(lang) {
  const t = TXT[lang] || TXT.uz;
  return {
    keyboard: [[{ text: t.contactBtn, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

/** Bog'langan foydalanuvchi uchun doimiy menyu tugmalari — hisobot, AI o'qitish, holat. */
function menuKeyboard(lang) {
  const t = TXT[lang] || TXT.uz;
  return {
    keyboard: [[{ text: t.btnReport }, { text: t.btnTrain }, { text: t.btnStatus }], [{ text: t.btnPost }]],
    resize_keyboard: true,
  };
}

/** Xabardagi joylanadigan fayl: { fileId, size, mime } yoki null. */
export function incomingMedia(message) {
  if (message.photo?.length) {
    const p = message.photo[message.photo.length - 1]; // eng katta o'lcham
    return { fileId: p.file_id, size: p.file_size || 0, mime: "image/jpeg" };
  }
  const f = message.video || message.document;
  if (f?.file_id) return { fileId: f.file_id, size: f.file_size || 0, mime: f.mime_type || "" };
  return null;
}

async function downloadTelegramFile(fileId) {
  const info = await callReportsBotApi("getFile", { file_id: fileId });
  const filePath = info?.result?.file_path;
  if (!filePath) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`, { signal: AbortSignal.timeout(60000) });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

function postTypeKeyboard(lang, isVideo) {
  const t = TXT[lang] || TXT.uz;
  const main = isVideo ? { text: t.btnReel, callback_data: "post:reel" } : { text: t.btnFeed, callback_data: "post:image" };
  return { inline_keyboard: [[main, { text: t.btnStory, callback_data: "post:story" }], [{ text: t.btnCancel, callback_data: "post:cancel" }]] };
}

/** Rasm/video kelganda: faylni saqlab, Post/Reels/Story tanlatadi. */
async function handleIncomingMedia(chatId, user, lang, media, caption) {
  const t = TXT[lang] || TXT.uz;
  const say = (text) => callReportsBotApi("sendMessage", { chat_id: chatId, text, reply_markup: menuKeyboard(lang) });
  if (!user.meta?.igUserId) return say(t.postNoIg);
  if (!POSTABLE_MIME.includes(media.mime)) return say(t.postBadFile);
  if (media.size > TG_DOWNLOAD_LIMIT) return say(t.postTooBig);

  const buf = await downloadTelegramFile(media.fileId);
  if (!buf) return say(t.postFailed("Telegram faylni bermadi"));
  const item = saveUpload(user, buf, media.mime, "telegram");
  if (item.error) return say(t.postFailed(item.error));

  // shortcut: tanlov xotirada turadi — server qayta ishga tushsa fayl qayta yuboriladi
  sessions.set(chatId, { step: "post", lang, url: item.url, isVideo: item.type === "video", caption: String(caption || "") });
  await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.postAsk, reply_markup: postTypeKeyboard(lang, item.type === "video") });
}

/** Post/Reels/Story tugmasi bosilganda: navbatga qo'yib darhol joylashni boshlaydi. */
async function handlePostChoice(chatId, user, lang, choice) {
  const t = TXT[lang] || TXT.uz;
  const session = sessions.get(chatId);
  sessions.delete(chatId);
  if (choice === "cancel") {
    await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.trainCancelled, reply_markup: menuKeyboard(lang) });
    return;
  }
  if (session?.step !== "post" || !["image", "reel", "story"].includes(choice)) {
    await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.postExpired, reply_markup: menuKeyboard(lang) });
    return;
  }

  const now = new Date().toISOString();
  user.scheduledPosts = [
    {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: choice,
      mediaUrl: session.url,
      mediaUrls: [],
      publishAt: now,
      caption: session.caption,
      status: "pending",
      createdAt: now,
      source: "telegram",
    },
    ...(user.scheduledPosts || []),
  ];
  await persist(user);
  await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.postQueued, reply_markup: menuKeyboard(lang) });
  await publishDuePosts(user);
}

const POST_TYPE_LABEL = { image: "Post", reel: "Reels", story: "Story", carousel: "Carousel" };

/** postPublisher Telegram'dan kelgan post natijasini shu yerga yuboradi. */
export async function notifyPostResult(user, post) {
  const chatId = user.settings?.reportsTelegramChatId;
  if (!TOKEN || !chatId) return;
  const t = TXT[user.settings?.reportsLang] || TXT.uz;
  const text = post.status === "published" ? t.postDone(POST_TYPE_LABEL[post.type] || post.type) : t.postFailed(post.error || "noma'lum xato");
  await callReportsBotApi("sendMessage", { chat_id: chatId, text });
}

/** "AI'ni o'qitish" bosilganda ko'rsatiladigan inline amallar: qo'shish/almashtirish/tozalash/orqaga. */
function trainActionsKeyboard(lang) {
  const t = TXT[lang] || TXT.uz;
  return {
    inline_keyboard: [
      [{ text: t.btnAdd, callback_data: "train:add" }, { text: t.btnReplace, callback_data: "train:replace" }],
      [{ text: t.btnClear, callback_data: "train:clear" }, { text: t.btnBack, callback_data: "train:back" }],
    ],
  };
}

function clearConfirmKeyboard(lang) {
  const t = TXT[lang] || TXT.uz;
  return { inline_keyboard: [[{ text: t.btnYes, callback_data: "train:clear_yes" }, { text: t.btnNo, callback_data: "train:clear_no" }]] };
}

// Telegram xabari 4096 belgigacha ruxsat beradi — juda uzun bilimlar bazasini
// to'liq ko'rsatishga urinish xato beradi, shuning uchun ko'rinish uchun qisqartiriladi
// (tahrirlash/almashtirish esa haligacha TO'LIQ matn bilan ishlaydi, faqat ko'rinish qisqaradi).
const TRAIN_PREVIEW_LIMIT = 3000;
function previewText(text) {
  if (text.length <= TRAIN_PREVIEW_LIMIT) return text;
  return `${text.slice(0, TRAIN_PREVIEW_LIMIT)}…`;
}

/** "AI'ni o'qitish" bosilganda: joriy bilimlar bazasini ko'rsatib, amal tugmalarini beradi. */
async function sendTrainMenu(chatId, user, lang) {
  const t = TXT[lang] || TXT.uz;
  const info = user.businessInfo || "";
  const header = info ? `${t.trainCurrentLabel(info.length)}\n\n${previewText(info)}\n\n${t.trainChooseAction}` : `${t.trainEmptyNote}\n\n${t.trainChooseAction}`;
  await callReportsBotApi("sendMessage", {
    chat_id: chatId,
    text: header,
    reply_markup: trainActionsKeyboard(lang),
  });
}

const LINK_CODE_TTL_MS = 60 * 60 * 1000;

/**
 * Saytdagi "Botni ochish" havolasi: t.me/<bot>?start=<kod>. Kod bir martalik va 1 soat
 * amal qiladi — u akkauntga to'liq kirish beradi (bilim bazasi, Instagram'ga joylash),
 * shuning uchun faqat egasining o'z sahifasida ko'rsatiladi.
 */
export function reportsLinkUrl(user) {
  if (!cachedBotUsername) return "";
  user.settings ||= {};
  const cur = user.settings.reportsLinkCode;
  if (!cur?.code || Date.parse(cur.exp) - Date.now() < 10 * 60 * 1000) {
    user.settings.reportsLinkCode = { code: crypto.randomBytes(16).toString("hex"), exp: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString() };
    persist(user);
  }
  return `https://t.me/${cachedBotUsername}?start=${user.settings.reportsLinkCode.code}`;
}

export async function findUserByLinkCode(code) {
  const users = await listUsers();
  const user = users.find((u) => u.settings?.reportsLinkCode?.code === code);
  return user && Date.parse(user.settings.reportsLinkCode.exp) > Date.now() ? user : null;
}

/** Chat'ni akkauntga bog'laydi va darhol hisobot + menyu yuboradi. */
async function linkChat(user, chatId, lang) {
  user.settings ||= {};
  user.settings.reportsTelegramChatId = chatId;
  user.settings.reportsLang = lang;
  user.settings.reportsLastSentDate = new Date().toISOString().slice(0, 10);
  delete user.settings.reportsLinkCode;
  await persist(user);

  sessions.delete(chatId);
  await callReportsBotApi("sendMessage", {
    chat_id: chatId,
    text: TXT[lang].linked(user.businessName || "Obunext") + buildReportText(user, lang),
    parse_mode: "Markdown",
    reply_markup: menuKeyboard(lang),
  });
}

export const reportsBotRouter = Router();

reportsBotRouter.post("/telegram-reports/webhook", async (req, res) => {
  res.sendStatus(200); // Telegram 200 kutadi
  if (!TOKEN) return;

  // MUHIM: try/catch shart — javob allaqachon yuborilgani uchun bu yerdagi xato
  // hech qachon HTTP javobiga ta'sir qilmaydi, lekin try/catch bo'lmasa tutilmagan
  // (unhandled) promise rad etishga aylanadi va Node BUTUN serverni yiqitishi
  // mumkin (barcha bizneslar uchun, faqat shu bitta Telegram xabari uchun emas).
  try {
    await handleReportsBotUpdate(req.body || {});
  } catch (err) {
    console.error("[ReportsBot] Webhook qayta ishlashda xato:", err);
  }
});

async function handleReportsBotUpdate(update) {
  // 1. Inline tugma bosilganda (til tanlash YOKI AI o'qitish amallari)
  const cq = update.callback_query;
  if (cq) {
    const chatId = String(cq.message?.chat?.id || "");
    const data = String(cq.data || "");
    await callReportsBotApi("answerCallbackQuery", { callback_query_id: cq.id });

    const langMatch = data.match(/^lang:(uz|ru|en)$/);
    if (chatId && langMatch) {
      const lang = langMatch[1];
      sessions.set(chatId, { step: "phone", lang });
      const t = TXT[lang];
      await callReportsBotApi("sendMessage", {
        chat_id: chatId,
        text: t.askPhone,
        reply_markup: contactKeyboard(lang),
      });
      return;
    }

    if (chatId && data.startsWith("post:")) {
      const linkedUser = await findUserByReportsChatId(chatId);
      if (linkedUser) await handlePostChoice(chatId, linkedUser, linkedUser.settings?.reportsLang || "uz", data.slice("post:".length));
      return;
    }

    if (chatId && data.startsWith("train:")) {
      const linkedUser = await findUserByReportsChatId(chatId);
      if (!linkedUser) return;
      const lang = linkedUser.settings?.reportsLang || "uz";
      const t = TXT[lang];
      const action = data.slice("train:".length);

      if (action === "add") {
        sessions.set(chatId, { step: "training_add", lang });
        await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.trainPrompt, reply_markup: { remove_keyboard: true } });
      } else if (action === "replace") {
        sessions.set(chatId, { step: "training_replace", lang });
        await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.replacePrompt, reply_markup: { remove_keyboard: true } });
      } else if (action === "clear") {
        await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.clearConfirm, reply_markup: clearConfirmKeyboard(lang) });
      } else if (action === "clear_yes") {
        linkedUser.businessInfo = "";
        await persist(linkedUser);
        sessions.delete(chatId);
        await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.cleared, reply_markup: menuKeyboard(lang) });
      } else if (action === "clear_no" || action === "back") {
        sessions.delete(chatId);
        await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.trainCancelled, reply_markup: menuKeyboard(lang) });
      }
    }
    return;
  }

  const message = update.message;
  if (!message || !message.chat?.id) return;
  const chatId = String(message.chat.id);

  // 2a. Saytdagi "Botni ochish" havolasi: /start <bir martalik kod> — telefonsiz bog'lash
  const startCode = String(message.text || "").match(/^\/start ([A-Za-z0-9_-]{16,64})$/)?.[1];
  if (startCode) {
    const user = await findUserByLinkCode(startCode);
    if (user) {
      await linkChat(user, chatId, user.settings?.reportsLang || "uz");
      return;
    }
  }

  // 2b. Telefon raqami yuborilganda (contact share)
  if (message.contact?.phone_number) {
    const session = sessions.get(chatId);
    const lang = session?.lang || "uz";
    const user = await findUserByPhone(message.contact.phone_number);
    if (!user) {
      await callReportsBotApi("sendMessage", { chat_id: chatId, text: TXT[lang].notFound, reply_markup: { remove_keyboard: true } });
      return;
    }
    await linkChat(user, chatId, lang);
    return;
  }

  // 3. Allaqachon bog'langan chat -> menyu tugmalari (Hisobot / AI o'qitish / Holat)
  const linkedUser = await findUserByReportsChatId(chatId);
  if (linkedUser) {
    const lang = linkedUser.settings?.reportsLang || "uz";
    const t = TXT[lang];
    const text = String(message.text || "").trim();
    const session = sessions.get(chatId);

    // 3. Rasm/video — Instagram'ga joylash
    const media = incomingMedia(message);
    if (media) {
      await handleIncomingMedia(chatId, linkedUser, lang, media, message.caption);
      return;
    }
    if (text === t.btnPost) {
      await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.postHint, reply_markup: menuKeyboard(lang) });
      return;
    }

    // 3a. "AI'ni o'qitish" — Qo'shish yoki Almashtirish rejimida turibdi
    if (session?.step === "training_add" || session?.step === "training_replace") {
      if (text === "/bekor") {
        sessions.delete(chatId);
        await callReportsBotApi("sendMessage", { chat_id: chatId, text: t.trainCancelled, reply_markup: menuKeyboard(lang) });
        return;
      }
      if (text) {
        linkedUser.businessInfo =
          session.step === "training_replace"
            ? text
            : linkedUser.businessInfo
              ? `${linkedUser.businessInfo}\n\n${text}`
              : text;
        await persist(linkedUser);
        sessions.delete(chatId);
        await callReportsBotApi("sendMessage", {
          chat_id: chatId,
          text: t.trainSaved(linkedUser.businessInfo.length),
          reply_markup: menuKeyboard(lang),
        });
      }
      return;
    }

    // 3b. Menyu tugmalari
    if (text === t.btnTrain) {
      await sendTrainMenu(chatId, linkedUser, lang);
      return;
    }
    if (text === t.btnStatus) {
      const sub = statusInfo(linkedUser);
      await callReportsBotApi("sendMessage", {
        chat_id: chatId,
        text: t.statusText(linkedUser.businessName || "Obunext", sub, linkedUser, (linkedUser.businessInfo || "").length),
        parse_mode: "Markdown",
        reply_markup: menuKeyboard(lang),
      });
      return;
    }

    // 3c. Standart (shu jumladan "Hisobot" tugmasi va boshqa har qanday xabar)
    await callReportsBotApi("sendMessage", {
      chat_id: chatId,
      text: buildReportText(linkedUser, lang),
      parse_mode: "Markdown",
      reply_markup: menuKeyboard(lang),
    });
    return;
  }

  // 4. Bog'lanmagan, sessiya ham yo'q (masalan /start) -> til tanlash
  await callReportsBotApi("sendMessage", {
    chat_id: chatId,
    text: TXT.uz.chooseLang,
    reply_markup: langKeyboard(),
  });
}

/** Webhookni Telegram'da ro'yxatdan o'tkazadi va bot @username'ni keshlaydi (bir marta, server ishga tushganda) */
export async function setupReportsBotWebhook() {
  if (!TOKEN) return false;
  const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    console.warn("[ReportsBot] BASE_URL yo'q — webhook o'rnatilmadi");
    return false;
  }

  const me = await callReportsBotApi("getMe", {});
  if (me?.result?.username) cachedBotUsername = me.result.username;

  const result = await callReportsBotApi("setWebhook", {
    url: `${baseUrl}/telegram-reports/webhook`,
    allowed_updates: ["message", "callback_query"],
  });
  if (result?.ok) {
    console.log(`[ReportsBot] Webhook o'rnatildi: ${baseUrl}/telegram-reports/webhook${cachedBotUsername ? ` (@${cachedBotUsername})` : ""}`);
    return true;
  }
  return false;
}

/** Har ~20 daqiqada chaqiriladi — DAILY_REPORT_HOUR ga yetganda, bog'langan
 * foydalanuvchilarga bugun hali yuborilmagan bo'lsa kunlik hisobotni yuboradi. */
export async function checkAndSendDailyReports() {
  if (!TOKEN) return;
  const now = new Date();
  if (now.getHours() !== DAILY_REPORT_HOUR) return;

  const today = now.toISOString().slice(0, 10);
  const users = await listUsers();
  for (const user of users) {
    const chatId = user.settings?.reportsTelegramChatId;
    if (!chatId) continue;
    if (user.settings?.reportsLastSentDate === today) continue;

    const lang = user.settings?.reportsLang || "uz";
    const ok = await callReportsBotApi("sendMessage", {
      chat_id: chatId,
      text: buildReportText(user, lang),
      parse_mode: "Markdown",
    });
    if (ok) {
      user.settings.reportsLastSentDate = today;
      await persist(user);
    }
  }
}
