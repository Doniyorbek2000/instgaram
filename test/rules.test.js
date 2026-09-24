import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });

// AI kalitlarisiz — AI trigger deterministik ravishda o'chiq bo'lsin
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const rules = await import("../src/rules.js");
const { scheduleFollowUp, cancelFollowUps, runTenantFollowUps } = await import("../src/followups.js");
const { onRuleDelivered, onGateBlocked, ruleReplyOptions } = await import("../src/ruleActions.js");
const { processMessage } = await import("../src/respond.js");
const { classifyIntent } = await import("../src/ai.js");

async function newTenant(email) {
  const { user } = await register(email, "parol123", "Test Do'kon");
  user.rules = [];
  return user;
}

// ==== Kalit so'z mosligi ====

test("bir qoidada vergul bilan bir nechta kalit so'z ishlaydi", async () => {
  const t = await newTenant("multi@x.uz");
  rules.addRule(t, { type: "comment_to_dm", keyword: "narx, price, цена", matchType: "contains", privateReply: "Katalog" });
  assert.ok(rules.findCommentRule(t, "Narxi qancha?"));
  assert.ok(rules.findCommentRule(t, "what's the PRICE"));
  assert.ok(rules.findCommentRule(t, "Цена?"));
  assert.strictEqual(rules.findCommentRule(t, "salom"), null);
});

test("o'zbekcha apostrof variantlari bir xil qabul qilinadi", async () => {
  const t = await newTenant("apos@x.uz");
  rules.addRule(t, { type: "keyword_dm", keyword: "sovg'a", matchType: "contains", privateReply: "Mana" });
  for (const text of ["sovg'a", "sovg‘a bering", "SOVG’A", "sovg`a"]) {
    assert.ok(rules.findKeywordRule(t, text), text);
  }
});

test("matchType 'any' har qanday kommentga ishlaydi, lekin aniq qoida ustun", async () => {
  const t = await newTenant("any@x.uz");
  const all = rules.addRule(t, { type: "comment_to_dm", keyword: "narx", matchType: "any", privateReply: "Hamma" });
  const specific = rules.addRule(t, { type: "comment_to_dm", keyword: "katalog", matchType: "exact", privateReply: "Aniq" });
  assert.strictEqual(rules.findCommentRule(t, "katalog")?.id, specific.id);
  assert.strictEqual(rules.findCommentRule(t, "zo'r post")?.id, all.id);
});

test("aniq post uchun yozilgan qoida umumiy qoidadan ustun", async () => {
  const t = await newTenant("media@x.uz");
  rules.addRule(t, { type: "comment_to_dm", keyword: "info", matchType: "contains", targetMediaId: "*", privateReply: "Umumiy" });
  const exact = rules.addRule(t, { type: "comment_to_dm", keyword: "info", matchType: "contains", targetMediaId: "M1", privateReply: "Post" });
  assert.strictEqual(rules.findCommentRule(t, "info", "M1")?.id, exact.id);
  assert.notStrictEqual(rules.findCommentRule(t, "info", "M2")?.id, exact.id);
});

test("DM'da '*' qoidasi AI javobini to'sib qo'ymaydi", async () => {
  const t = await newTenant("star@x.uz");
  rules.addRule(t, { type: "keyword_dm", keyword: "*", matchType: "contains", privateReply: "X" });
  assert.strictEqual(rules.findKeywordRule(t, "salom"), null);
});

test("noto'g'ri regex serverni yiqitmaydi", async () => {
  const t = await newTenant("regex@x.uz");
  rules.addRule(t, { type: "keyword_dm", keyword: "([, ^zakaz", matchType: "regex", privateReply: "Z" });
  assert.ok(rules.findKeywordRule(t, "zakaz bermoqchiman"));
  assert.strictEqual(rules.findKeywordRule(t, "salom"), null);
});

test("AI trigger qoidalari kalit so'z bo'yicha ishlamaydi, AI kaliti yo'q bo'lsa null", async () => {
  const t = await newTenant("ai@x.uz");
  const r = rules.addRule(t, { type: "comment_to_dm", keyword: "*", matchType: "ai", aiIntent: "narx so'rash", privateReply: "Narx" });
  assert.strictEqual(rules.findCommentRule(t, "qancha turadi"), null);
  assert.deepStrictEqual(rules.aiRules(t, "comment_to_dm").map((x) => x.id), [r.id]);
  assert.strictEqual(await classifyIntent(t, "qancha turadi", rules.aiRules(t, "comment_to_dm")), null);
});

// ==== Qoida maydonlari ====

test("tugmalar, teglar va kechikishlar tozalanadi", () => {
  const x = rules.sanitizeRuleExtras({
    buttons: "Katalog | https://a.uz/k\nNoto'g'ri qator\nJS | javascript:alert(1)\nSayt | http://b.uz\nX | https://c.uz\nY | https://d.uz",
    tags: "lid, reels-sovga, ",
    reminderDelayMin: "99999",
    followUpDelayMin: "abc",
  });
  assert.deepStrictEqual(x.buttons, [
    { title: "Katalog", url: "https://a.uz/k" },
    { title: "Sayt", url: "http://b.uz" },
    { title: "X", url: "https://c.uz" },
  ]);
  assert.deepStrictEqual(x.tags, ["lid", "reels-sovga"]);
  assert.strictEqual(x.reminderDelayMin, 1380);
  assert.strictEqual(x.followUpDelayMin, 60);
  assert.strictEqual(rules.buttonsToText(x.buttons).split("\n").length, 3);
});

test("ruleReplyOptions havola tugmalari va forma tugmasini birlashtiradi", () => {
  const opts = ruleReplyOptions({ buttons: [{ title: "Sayt", url: "https://a.uz" }], formId: "f1" });
  assert.deepStrictEqual(opts, [
    { title: "Sayt", url: "https://a.uz" },
    { title: "📝 Ariza qoldirish", payload: "FORM:f1" },
  ]);
});

// ==== Follow-up navbati ====

test("vazifa rejalashtiriladi, muddati kelganda yuboriladi va navbatdan o'chadi", async () => {
  const t = await newTenant("fu@x.uz");
  scheduleFollowUp(t, { key: "ig:1", kind: "followup", ruleId: "r1", text: "Salom!", delayMin: 5 });
  const sent = [];
  const fakeSend = async (_t, chan, id, text) => { sent.push({ chan, id, text }); return true; };

  assert.strictEqual(await runTenantFollowUps(t, Date.now(), fakeSend), 0);
  assert.strictEqual(t.followUps.length, 1);

  assert.strictEqual(await runTenantFollowUps(t, Date.now() + 6 * 60 * 1000, fakeSend), 1);
  assert.deepStrictEqual(sent, [{ chan: "ig", id: "1", text: "Salom!" }]);
  assert.strictEqual(t.followUps.length, 0);
});

test("bir mijoz+qoida uchun eslatma takrorlanmaydi va bekor qilinadi", async () => {
  const t = await newTenant("dedupe@x.uz");
  scheduleFollowUp(t, { key: "ig:2", kind: "reminder", ruleId: "r1", text: "A", delayMin: 10 });
  scheduleFollowUp(t, { key: "ig:2", kind: "reminder", ruleId: "r1", text: "B", delayMin: 10 });
  assert.strictEqual(t.followUps.length, 1);
  assert.strictEqual(t.followUps[0].text, "B");
  assert.strictEqual(cancelFollowUps(t, "ig:2", { kind: "reminder" }), 1);
  assert.strictEqual(t.followUps.length, 0);
});

test("juda eskirgan vazifa yuborilmaydi, obunasi tugagan biznesga ham yuborilmaydi", async () => {
  const t = await newTenant("stale@x.uz");
  scheduleFollowUp(t, { key: "ig:3", kind: "followup", text: "Eski", delayMin: 1 });
  let calls = 0;
  const fakeSend = async () => { calls++; return true; };
  await runTenantFollowUps(t, Date.now() + 8 * 60 * 60 * 1000, fakeSend);
  assert.strictEqual(calls, 0);

  // Obuna tugagan va bepul tarif o'chirilgan — yuborilmaydi
  const { savePlatformSettings } = await import("../src/credits.js");
  await savePlatformSettings({ freePlan: false });
  const t2 = await newTenant("inactive@x.uz");
  t2.subscription.trialEndsAt = new Date(Date.now() - 86400000).toISOString();
  scheduleFollowUp(t2, { key: "ig:4", kind: "followup", text: "X", delayMin: 1 });
  await runTenantFollowUps(t2, Date.now() + 2 * 60 * 1000, fakeSend);
  assert.strictEqual(calls, 0);
  assert.strictEqual(t2.followUps.length, 0);

  // Bepul tarif yoqilgan — bot (va eslatmalar) ishlashda davom etadi
  await savePlatformSettings({ freePlan: true });
  scheduleFollowUp(t2, { key: "ig:4", kind: "followup", text: "X", delayMin: 1 });
  await runTenantFollowUps(t2, Date.now() + 2 * 60 * 1000, fakeSend);
  assert.strictEqual(calls, 1);
});

test("obuna darvozasi eslatma qo'yadi, sovg'a yetkazilgach u bekor bo'lib follow-up qo'yiladi", async () => {
  const t = await newTenant("gate@x.uz");
  const rule = rules.addRule(t, {
    type: "comment_to_dm", keyword: "sovg'a", requireFollow: true, privateReply: "Sovg'a",
    tags: "lid", followUpText: "Yoqdimi?", followUpDelayMin: 30, reminderDelayMin: 45,
  });
  onGateBlocked(t, rule, "ig:9", [{ title: "Obuna bo'ldim ✅", payload: `CHECK_FOLLOW:${rule.id}` }]);
  assert.strictEqual(rule.stats.gateBlocked, 1);
  assert.deepStrictEqual(t.followUps.map((j) => j.kind), ["reminder"]);

  onRuleDelivered(t, rule, "ig:9");
  assert.deepStrictEqual(t.followUps.map((j) => j.kind), ["followup"]);
  assert.deepStrictEqual(t.contactMeta["ig:9"].tags, ["lid"]);
});

test("eslatma 0 daqiqa bo'lsa o'chiq", async () => {
  const t = await newTenant("noremind@x.uz");
  const rule = rules.addRule(t, { type: "comment_to_dm", requireFollow: true, privateReply: "S", reminderDelayMin: 0 });
  onGateBlocked(t, rule, "ig:10");
  assert.strictEqual(t.followUps.length, 0);
});

// ==== To'liq oqim: DM kalit so'z ====

test("DM kalit so'z qoidasi tugmalar bilan javob beradi, teg qo'yadi va follow-up rejalashtiradi", async () => {
  const t = await newTenant("flow@x.uz");
  rules.addRule(t, {
    type: "keyword_dm", keyword: "katalog, catalog", matchType: "contains", privateReply: "Mana katalog 📒",
    buttons: "Ochish | https://shop.uz/k", tags: "katalog-sorovi", followUpText: "Tanladingizmi?", followUpDelayMin: 20,
  });
  const res = await processMessage(t, "telegram", "555", { text: "Catalog bormi?" });
  assert.strictEqual(res.reply, "Mana katalog 📒");
  assert.deepStrictEqual(res.quickReplies, [{ title: "Ochish", url: "https://shop.uz/k" }]);
  assert.deepStrictEqual(t.contactMeta["tg:555"].tags, ["katalog-sorovi"]);
  assert.strictEqual(t.followUps[0]?.key, "tg:555");
  assert.strictEqual(t.followUps[0]?.kind, "followup");
});

test("Triggers UI moduli xatosiz yuklanadi", async () => {
  const { rulesRouter } = await import("../src/web/rules_ui.js");
  assert.ok(rulesRouter);
});
