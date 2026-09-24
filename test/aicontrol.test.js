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

const { register } = await import("../src/auth.js");
const ac = await import("../src/aiControl.js");
const { processMessage } = await import("../src/respond.js");
const { addRule } = await import("../src/rules.js");

async function tenant(email) {
  const { user } = await register(email, "parol123", "B");
  user.rules = [];
  user.settings.timezone = "Asia/Tashkent";
  return user;
}
// 2026-09-24 payshanba 10:30 Toshkent / 2026-09-27 yakshanba 23:00 Toshkent
const WORK = new Date("2026-09-24T05:30:00Z");
const NIGHT = new Date("2026-09-27T18:00:00Z");

test("sukut bo'yicha AI yoqilgan; umumiy, kanal va chat bo'yicha o'chiriladi", async () => {
  const t = await tenant("ac1@x.uz");
  assert.deepStrictEqual(ac.aiAllowed(t, "ig", "ig:1"), { allowed: true, reason: "" });
  ac.saveAiSettings(t, { enabled: "on", ch_ig: "on", ch_tg: "on", ch_fb: "on", mode: "always" });
  assert.strictEqual(ac.aiAllowed(t, "wa", "wa:1").reason, "channel");
  ac.setChatAi(t, "ig:2", false);
  assert.strictEqual(ac.aiAllowed(t, "ig", "ig:2").reason, "chat");
  assert.strictEqual(ac.aiAllowed(t, "ig", "ig:3").allowed, true);
  ac.setChatAi(t, "ig:2", true);
  assert.strictEqual(ac.aiAllowed(t, "ig", "ig:2").allowed, true);
  ac.setAiEnabled(t, false);
  assert.strictEqual(ac.aiAllowed(t, "ig", "ig:3").reason, "global");
});

test("jadval: faqat ish vaqtida / faqat ish vaqtidan tashqarida", async () => {
  const t = await tenant("ac2@x.uz");
  ac.saveAiSettings(t, { enabled: "on", ch_ig: "on", mode: "off_hours", from: "09:00", to: "18:00", days: ["1", "2", "3", "4", "5"] });
  assert.strictEqual(ac.isWorkTime(t, WORK), true);
  assert.strictEqual(ac.isWorkTime(t, NIGHT), false);
  assert.strictEqual(ac.aiAllowed(t, "ig", "", WORK).reason, "schedule");
  assert.strictEqual(ac.aiAllowed(t, "ig", "", NIGHT).allowed, true);
  ac.saveAiSettings(t, { enabled: "on", ch_ig: "on", mode: "work_hours", from: "09:00", to: "18:00", days: ["1", "2", "3", "4", "5"] });
  assert.strictEqual(ac.aiAllowed(t, "ig", "", WORK).allowed, true);
  assert.strictEqual(ac.aiAllowed(t, "ig", "", NIGHT).reason, "schedule");
});

test("AI o'chiq: kalit so'z qoidasi baribir ishlaydi, qolgan xabarlarga jim yoki 6 soatda bir marta zaxira xabar", async () => {
  const t = await tenant("ac3@x.uz");
  addRule(t, { type: "keyword_dm", keyword: "narx", matchType: "contains", privateReply: "Narx: 100" });
  ac.setAiEnabled(t, false);
  assert.strictEqual((await processMessage(t, "telegram", "10", { text: "narx?" })).reply, "Narx: 100");
  assert.strictEqual((await processMessage(t, "telegram", "10", { text: "salom" })).reply, null, "jim");
  assert.strictEqual(t.chats["tg:10"].at(-1).text, "salom", "xabar Inbox'da ko'rinadi");

  ac.saveAiSettings(t, { enabled: "", whenOff: "message", offMessage: "Tez orada javob beramiz" });
  assert.strictEqual((await processMessage(t, "telegram", "11", { text: "salom" })).reply, "Tez orada javob beramiz");
  assert.strictEqual((await processMessage(t, "telegram", "11", { text: "yana" })).reply, null, "6 soat ichida takrorlanmaydi");
});

test("holat matni", async () => {
  const t = await tenant("ac4@x.uz");
  assert.strictEqual(ac.aiStatusLabel(t).on, true);
  ac.setAiEnabled(t, false);
  assert.deepStrictEqual(ac.aiStatusLabel(t), { on: false, label: "AI javob o'chiq" });
});
