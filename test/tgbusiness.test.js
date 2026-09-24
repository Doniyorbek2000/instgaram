import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.FREE_MODE = "false";

// Telegram API chaqiruvlarini ushlab qolamiz (tarmoqqa chiqmaymiz)
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    calls.push({ method: String(url).split("/").pop(), body: JSON.parse(opts.body || "{}") });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }
  return realFetch(url, opts);
};

const { register } = await import("../src/auth.js");
const tg = await import("../src/telegram.js");
const { addRule } = await import("../src/rules.js");

async function tenant(email) {
  const { user } = await register(email, "parol123", "Biznes");
  user.settings.telegramBotToken = "123:ABC";
  user.rules = [];
  return user;
}

const conn = { id: "BC1", user: { id: 777, first_name: "Ega" }, is_enabled: true, rights: { can_reply: true } };

test("webhook maxfiy kaliti: o'rnatilgan bo'lsa aniq mos kelishi shart", () => {
  const u = { settings: { telegramWebhookSecret: "s3cret" } };
  assert.strictEqual(tg.isValidTelegramSecret(u, "s3cret"), true);
  assert.strictEqual(tg.isValidTelegramSecret(u, "wrong!"), false);
  assert.strictEqual(tg.isValidTelegramSecret(u, undefined), false);
  assert.strictEqual(tg.isValidTelegramSecret({ settings: {} }, undefined), true, "eski ulanish vaqtincha qabul qilinadi");
});

test("mijoz yozsa — javob egasining akkauntidan (business_connection_id) ketadi", async () => {
  const u = await tenant("tgb1@x.uz");
  addRule(u, { type: "keyword_dm", keyword: "narx", matchType: "contains", privateReply: "Narxlar: 100 000 so'm" });
  tg.handleBusinessConnection(u, conn);
  assert.strictEqual(u.tgBusiness.enabled, true);
  calls.length = 0;
  await tg.handleBusinessMessage(u, { business_connection_id: "BC1", chat: { id: 555, type: "private" }, from: { id: 555, first_name: "Mijoz" }, text: "Narxi qancha?" }, "123:ABC");
  const send = calls.find((c) => c.method === "sendMessage");
  assert.ok(send, "javob yuborildi");
  assert.strictEqual(send.body.business_connection_id, "BC1");
  assert.strictEqual(send.body.chat_id, "555");
  assert.strictEqual(send.body.text, "Narxlar: 100 000 so'm");
});

test("egasi o'zi yozsa — bot shu chatda jim bo'ladi va xabar operator sifatida yoziladi", async () => {
  const u = await tenant("tgb2@x.uz");
  tg.handleBusinessConnection(u, conn);
  await tg.handleBusinessMessage(u, { business_connection_id: "BC1", chat: { id: 556, type: "private" }, from: { id: 777 }, text: "Salom, men o'zim javob beraman" }, "123:ABC");
  assert.ok(u.manualChats["tg:556"] > Date.now());
  assert.strictEqual(u.chats["tg:556"].at(-1).role, "operator");
  calls.length = 0;
  await tg.handleBusinessMessage(u, { business_connection_id: "BC1", chat: { id: 556, type: "private" }, from: { id: 556 }, text: "narx?" }, "123:ABC");
  assert.strictEqual(calls.filter((c) => c.method === "sendMessage").length, 0, "operator rejimida bot javob bermaydi");
});

test("uzilgan, boshqa ulanish yoki javob ruxsati yo'q bo'lsa — javob yo'q", async () => {
  const u = await tenant("tgb3@x.uz");
  tg.handleBusinessConnection(u, { ...conn, rights: { can_reply: false } });
  calls.length = 0;
  await tg.handleBusinessMessage(u, { business_connection_id: "BC1", chat: { id: 1, type: "private" }, from: { id: 1 }, text: "salom" }, "t");
  await tg.handleBusinessMessage(u, { business_connection_id: "OTHER", chat: { id: 2, type: "private" }, from: { id: 2 }, text: "salom" }, "t");
  tg.handleBusinessConnection(u, { ...conn, is_enabled: false });
  await tg.handleBusinessMessage(u, { business_connection_id: "BC1", chat: { id: 3, type: "private" }, from: { id: 3 }, text: "salom" }, "t");
  assert.strictEqual(calls.filter((c) => c.method === "sendMessage").length, 0);
  assert.deepStrictEqual(u.tgBusiness.chats, {});
});
