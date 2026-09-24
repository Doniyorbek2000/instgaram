import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const bc = await import("../src/broadcasts.js");
const { addTags } = await import("../src/contacts.js");

async function tenantWithContacts(email) {
  const { user: t } = await register(email, "parol123", "Do'kon");
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  t.chats = {
    "ig:1": [{ role: "user", text: "salom", at: now }],
    "ig:2": [{ role: "user", text: "salom", at: old }],
    "tg:3": [{ role: "user", text: "salom", at: old }],
    "wa:4": [{ role: "user", text: "salom", at: now }],
    "comment:99": [{ role: "user", text: "komment", at: now }],
  };
  t.contactProfiles = { 1: { name: "Ali" } };
  addTags(t, "ig:1", ["vip"]);
  addTags(t, "tg:3", ["vip", "lid"]);
  addTags(t, "wa:4", ["lid", "stop"]);
  return t;
}

test("auditoriya: ichki 'comment:' kalitlari kirmaydi, 24 soat oynasi Telegram'ga qo'llanmaydi", async () => {
  const t = await tenantWithContacts("aud@x.uz");
  assert.deepStrictEqual(bc.allContacts(t).sort(), ["ig:1", "ig:2", "tg:3", "wa:4"]);
  assert.deepStrictEqual(bc.resolveAudience(t, {}).sort(), ["ig:1", "tg:3", "wa:4"]);
  assert.deepStrictEqual(bc.resolveAudience(t, { only24h: false }).sort(), ["ig:1", "ig:2", "tg:3", "wa:4"]);
});

test("auditoriya: kanal, teglar (istalgani/barchasi) va istisno teg", async () => {
  const t = await tenantWithContacts("seg@x.uz");
  assert.deepStrictEqual(bc.resolveAudience(t, { channel: "tg" }), ["tg:3"]);
  assert.deepStrictEqual(bc.resolveAudience(t, { tags: "vip" }).sort(), ["ig:1", "tg:3"]);
  assert.deepStrictEqual(bc.resolveAudience(t, { tags: "vip, lid", tagMode: "all" }), ["tg:3"]);
  assert.deepStrictEqual(bc.resolveAudience(t, { tags: "lid", excludeTags: "stop" }), ["tg:3"]);
});

test("broadcast har bir kontaktga o'zgaruvchilar bilan yuboriladi va natija saqlanadi", async () => {
  const t = await tenantWithContacts("send@x.uz");
  const data = bc.sanitizeBroadcast({ name: "Aksiya", message: "Salom, {name|do'stim}!", tags: "vip", buttons: "Katalog | https://a.uz\nyomon qator" });
  const b = bc.createBroadcast(t, data);
  const sent = [];
  const fakeSend = async (_t, chan, id, text, options) => { sent.push({ chan, id, text, options }); return chan !== "tg"; };
  await bc.runBroadcast(t, b.id, { send: fakeSend, delayMs: 0 });
  assert.deepStrictEqual(sent.map((s) => `${s.chan}:${s.id}:${s.text}`).sort(), ["ig:1:Salom, Ali!\n\n— Chiqish uchun STOP deb yozing", "tg:3:Salom, do'stim!\n\n— Chiqish uchun STOP deb yozing"]);
  assert.deepStrictEqual(sent[0].options, [{ title: "Katalog", url: "https://a.uz" }]);
  assert.strictEqual(b.status, "completed");
  assert.strictEqual(b.total, 2);
  assert.strictEqual(b.sentCount, 1);
  assert.strictEqual(b.failedCount, 1);
  // Qayta ishga tushirish ikki marta yubormaydi
  await bc.runBroadcast(t, b.id, { send: fakeSend, delayMs: 0 });
  assert.strictEqual(sent.length, 2);
});

test("rejalashtirilgan vaqt o'tmishda bo'lsa darhol yuboriladi, kelajakda bo'lsa scheduled", () => {
  const past = bc.sanitizeBroadcast({ name: "x", message: "y", scheduledAt: "2000-01-01T00:00:00Z" });
  assert.strictEqual(past.scheduledAt, "");
  const future = bc.sanitizeBroadcast({ name: "x", message: "y", scheduledAt: new Date(Date.now() + 3600000).toISOString() });
  assert.ok(future.scheduledAt);
});
