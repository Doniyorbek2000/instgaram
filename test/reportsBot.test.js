import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });

process.env.REPORTS_BOT_TOKEN = process.env.REPORTS_BOT_TOKEN || "test-token-123";

// Telegram API'ga haqiqiy tarmoq so'rovi yubormaslik uchun fetch'ni ushlab qolamiz.
const sentMessages = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("api.telegram.org")) {
    sentMessages.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  }
  return realFetch(url, opts);
};

const { normalizePhone, findUserByPhone, findUserByReportsChatId, buildReportText, reportsBotRouter } = await import("../src/reportsBot.js");
const { register } = await import("../src/auth.js");
const { updateUser, findUserByEmail } = await import("../src/db.js");
const eng = await import("../src/engagement.js");
const express = (await import("express")).default;

test("normalizePhone turli formatlarni bir xil natijaga keltiradi", () => {
  const a = normalizePhone("+998901234567");
  const b = normalizePhone("998901234567");
  const c = normalizePhone("90 123 45 67");
  assert.strictEqual(a, "901234567");
  assert.strictEqual(a, b);
  assert.strictEqual(a.slice(-9), c.slice(-9));
});

test("findUserByPhone /settings'da kiritilgan raqamni topadi (prefiksdan qat'i nazar)", async () => {
  const { user } = await register("phonetest@x.uz", "parol123", "Telefon Testi");
  await updateUser(user.id, { settings: { ...(user.settings || {}), phone: "+998901112233" } });

  const found = await findUserByPhone("998901112233");
  assert.ok(found);
  assert.strictEqual(found.email, "phonetest@x.uz");

  const notFound = await findUserByPhone("+998999999999");
  assert.strictEqual(notFound, null);
});

test("findUserByReportsChatId bog'langan chatId bo'yicha topadi", async () => {
  const { user } = await register("chattest@x.uz", "parol123", "Chat Testi");
  await updateUser(user.id, { settings: { ...(user.settings || {}), reportsTelegramChatId: "555666777" } });

  const found = await findUserByReportsChatId("555666777");
  assert.ok(found);
  assert.strictEqual(found.email, "chattest@x.uz");
});

test("buildReportText statistikani va faqat haqiqiy (contact bor) leadlarni ko'rsatadi", async () => {
  const { user } = await register("reporttest@x.uz", "parol123", "Hisobot Testi");
  eng.recordMessage(user, "instagram", "111", "salom");
  eng.recordMessage(user, "whatsapp", "222", "narxi qancha?");
  // engagement.js shaklidagi (contact'siz) yozuv — hisobotda ko'rinmasligi kerak
  user.leads.push({ chatKey: "333", channel: "instagram", lastText: "faqat savol", count: 1 });
  // respond.js shaklidagi (contact bor) haqiqiy "hot lead" — ko'rinishi kerak
  user.leads.push({ id: "lead_1", key: "444", channel: "whatsapp", contact: "+998901234567", lastMessage: "sotib olmoqchiman", status: "new" });

  const textUz = buildReportText(user, "uz");
  assert.match(textUz, /Hisobot/);
  assert.match(textUz, /\+998901234567/);
  assert.doesNotMatch(textUz, /faqat savol/);

  const textEn = buildReportText(user, "en");
  assert.match(textEn, /Report/);

  const textRu = buildReportText(user, "ru");
  assert.match(textRu, /Отчёт/);
});

test("Telegram bot orqali: bog'lash -> AI'ni o'qitish menyusi -> Qo'shish -> businessInfo haqiqatan yangilanadi -> holat to'g'ri ko'rsatadi", async () => {
  const { user } = await register("tgbotflow@x.uz", "parol123", "Bot Flow Biz");
  await updateUser(user.id, { settings: { ...(user.settings || {}), phone: "+998907778899" } });

  const app = express();
  app.use(express.json());
  app.use(reportsBotRouter);
  const server = app.listen(0);
  const port = await new Promise((resolve) => server.once("listening", () => resolve(server.address().port)));
  const base = `http://localhost:${port}`;
  const chatId = 111222333;

  async function post(update) {
    await fetch(`${base}/telegram-reports/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    await new Promise((r) => setTimeout(r, 30));
  }

  await post({ message: { chat: { id: chatId }, contact: { phone_number: "+998907778899" } } });
  assert.deepStrictEqual(
    sentMessages.at(-1).reply_markup?.keyboard?.[0]?.map((b) => b.text),
    ["📊 Hisobot", "🎓 AI'ni o'qitish", "🏢 Holat"]
  );

  // "AI'ni o'qitish" bosilganda avval JORIY bazani (bo'sh holatda) va amal tugmalarini ko'rsatadi
  await post({ message: { chat: { id: chatId }, text: "🎓 AI'ni o'qitish" } });
  assert.match(sentMessages.at(-1).text, /bo'sh/);
  const actionButtons = sentMessages.at(-1).reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepStrictEqual(actionButtons, ["train:add", "train:replace", "train:clear", "train:back"]);

  // "➕ Qo'shish" inline tugmasi -> matn so'raladi
  await post({ callback_query: { id: "cq1", message: { chat: { id: chatId } }, data: "train:add" } });
  assert.match(sentMessages.at(-1).text, /Matn yuboring/);

  await post({ message: { chat: { id: chatId }, text: "Manzil: Toshkent, Chilonzor" } });
  let fresh = await findUserByEmail("tgbotflow@x.uz");
  assert.match(fresh.businessInfo, /Manzil: Toshkent, Chilonzor/);
  assert.match(sentMessages.at(-1).text, /Saqlandi/);

  // Training tugagach — oddiy xabar businessInfo'ga QO'SHILMASLIGI kerak, hisobot qaytishi kerak
  await post({ message: { chat: { id: chatId }, text: "tasodifiy xabar" } });
  fresh = await findUserByEmail("tgbotflow@x.uz");
  assert.doesNotMatch(fresh.businessInfo, /tasodifiy xabar/);
  assert.match(sentMessages.at(-1).text, /Hisobot/);

  await post({ message: { chat: { id: chatId }, text: "🏢 Holat" } });
  assert.match(sentMessages.at(-1).text, /Bot Flow Biz/);
  assert.match(sentMessages.at(-1).text, /AI o'qitilgan: ✅/);

  // "🎓 AI'ni o'qitish" endi mavjud kontentni ko'rsatishi kerak (bo'sh emas)
  await post({ message: { chat: { id: chatId }, text: "🎓 AI'ni o'qitish" } });
  assert.match(sentMessages.at(-1).text, /Manzil: Toshkent, Chilonzor/);

  // "✏️ Almashtirish" -> yangi matn ESKISINI TO'LIQ almashtiradi (qo'shilmaydi)
  await post({ callback_query: { id: "cq2", message: { chat: { id: chatId } }, data: "train:replace" } });
  assert.match(sentMessages.at(-1).text, /BUTUNLAY ALMASHTIRADI/);
  await post({ message: { chat: { id: chatId }, text: "Yangi to'liq matn" } });
  fresh = await findUserByEmail("tgbotflow@x.uz");
  assert.strictEqual(fresh.businessInfo, "Yangi to'liq matn");
  assert.doesNotMatch(fresh.businessInfo, /Chilonzor/);

  // "🗑 Tozalash" -> tasdiqlash so'raladi -> "Ha" bosilsa butunlay tozalanadi
  await post({ callback_query: { id: "cq3", message: { chat: { id: chatId } }, data: "train:clear" } });
  assert.match(sentMessages.at(-1).text, /Rostdan ham/);
  await post({ callback_query: { id: "cq4", message: { chat: { id: chatId } }, data: "train:clear_yes" } });
  fresh = await findUserByEmail("tgbotflow@x.uz");
  assert.strictEqual(fresh.businessInfo, "");
  assert.match(sentMessages.at(-1).text, /tozalandi/);

  server.close();
});
