import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });

process.env.IG_APP_ID = "";
process.env.IG_APP_SECRET = "";
// Local .env'dagi FREE_MODE holatidan qat'i nazar testlar deterministik bo'lishi kerak
process.env.FREE_MODE = "false";

const { register, changePassword, login } = await import("../src/auth.js");
const sub = await import("../src/subscription.js");
const eng = await import("../src/engagement.js");
const { isDuplicate } = await import("../src/dedup.js");
const oauth = await import("../src/oauth.js");
const { setPlanPrices } = await import("../src/db.js");

async function newUser(email) {
  const res = await register(email, "parol123", "Test");
  return res.user;
}

// ==== Obuna ====

test("yangi foydalanuvchi trial bilan boshlaydi va faol", async () => {
  const u = await newUser("trial@x.uz");
  assert.strictEqual(u.subscription.status, "trial");
  assert.strictEqual(sub.isActive(u), true);
});

test("trial tugagan bo'lsa faol emas", async () => {
  const u = await newUser("expired@x.uz");
  u.subscription.trialEndsAt = new Date(Date.now() - 86400000).toISOString();
  assert.strictEqual(sub.isActive(u), false);
});

test("admin faollashtirsa obuna faol bo'ladi", async () => {
  const u = await newUser("paid@x.uz");
  u.subscription.trialEndsAt = new Date(Date.now() - 86400000).toISOString();
  sub.activate(u, 30, "pro");
  assert.strictEqual(sub.isActive(u), true);
  assert.strictEqual(u.subscription.plan, "pro");
});

test("bekor qilingan obuna faol emas", async () => {
  const u = await newUser("off@x.uz");
  sub.activate(u, 30);
  sub.deactivate(u);
  assert.strictEqual(sub.isActive(u), false);
});

// ==== Referal tizimi ====

test("creditReferral: to'g'ri kod bilan taklif qiluvchining obunasi +3 kunga uzayadi", async () => {
  const referrer = await newUser("referrer@x.uz");
  const before = new Date(referrer.subscription.trialEndsAt).getTime();

  const newcomer = await newUser("newcomer@x.uz");
  const credited = await sub.creditReferral(referrer.id.slice(0, 8), newcomer);

  assert.strictEqual(credited, true);
  const after = new Date(referrer.subscription.expiresAt).getTime();
  assert.ok(after > before, "obuna muddati uzayishi kerak");
  assert.strictEqual(referrer.growth.referrals.length, 1);
  assert.strictEqual(referrer.growth.referrals[0].email, "newcomer@x.uz");
});

test("creditReferral: o'z-o'zini taklif qilish (o'z kodi bilan) mukofot bermaydi", async () => {
  const u = await newUser("selfref@x.uz");
  const credited = await sub.creditReferral(u.id.slice(0, 8), u);
  assert.strictEqual(credited, false);
});

test("creditReferral: mavjud bo'lmagan/bo'sh kod hech narsa qilmaydi", async () => {
  const newcomer = await newUser("noref@x.uz");
  assert.strictEqual(await sub.creditReferral("", newcomer), false);
  assert.strictEqual(await sub.creditReferral("qwertyui", newcomer), false);
});

// ==== Tarif narxlari (admin o'zgartirsa getPlans() ham yangilanishi kerak) ====

test("admin narxni o'zgartirsa getPlans() yangi narxni qaytaradi", async () => {
  const before = await sub.getPlans();
  assert.strictEqual(before.start.price, sub.PLAN_DEFS.start.defaultPrice);

  await setPlanPrices({ start: 150000 });
  const after = await sub.getPlans();
  assert.strictEqual(after.start.price, 150000);
  // Narx o'zgartirilmagan tariflar defaultPrice bilan qolishi kerak
  assert.strictEqual(after.pro.price, sub.PLAN_DEFS.pro.defaultPrice);
});

// ==== Statistika ====

test("xabarlar va noyob mijozlar hisoblanadi", async () => {
  const u = await newUser("stats@x.uz");
  eng.recordMessage(u, "whatsapp", "555", "salom");
  eng.recordMessage(u, "whatsapp", "555", "narx?");
  eng.recordMessage(u, "instagram", "777", "buyurtma beraman");
  const s = eng.statsSummary(u);
  assert.strictEqual(s.messages, 3);
  assert.strictEqual(s.customers, 2);
  assert.strictEqual(s.channels.whatsapp, 2);
  assert.strictEqual(s.orders, 1); // "buyurtma" so'zi
});

test("mijozlar ro'yxati (CRM) yangilanadi va eng yangisi tepada", async () => {
  const u = await newUser("crm@x.uz");
  eng.recordMessage(u, "whatsapp", "111", "birinchi");
  eng.recordMessage(u, "instagram", "222", "ikkinchi");
  eng.recordMessage(u, "whatsapp", "111", "yana yozdim");
  const leads = eng.recentLeads(u);
  assert.strictEqual(leads[0].chatKey, "111");
  assert.strictEqual(leads[0].count, 2);
  assert.strictEqual(leads.length, 2);
});

// ==== Operator chaqirish ====

test("operator so'zi handoff sifatida aniqlanadi", () => {
  assert.strictEqual(eng.isHandoffRequest("menga operator kerak"), true);
  assert.strictEqual(eng.isHandoffRequest("narxi qancha"), false);
});

test("handoff chatni qo'lda rejimga o'tkazadi va hal qilinadi", async () => {
  const u = await newUser("handoff@x.uz");
  eng.startHandoff(u, "whatsapp", "999");
  assert.strictEqual(eng.isManual(u, "999"), true);
  assert.strictEqual(eng.pendingHandoffs(u).length, 1);

  const id = eng.pendingHandoffs(u)[0].id;
  eng.resolveHandoff(u, id);
  assert.strictEqual(eng.isManual(u, "999"), false);
  assert.strictEqual(eng.pendingHandoffs(u).length, 0);
});

// ==== Xabar dedup ====

test("takroriy webhook xabari aniqlanadi", () => {
  assert.strictEqual(isDuplicate("msg-1"), false);
  assert.strictEqual(isDuplicate("msg-1"), true);
  assert.strictEqual(isDuplicate("msg-2"), false);
  assert.strictEqual(isDuplicate(""), false);
});

// ==== Parol o'zgartirish ====

test("to'g'ri joriy parol bilan parol o'zgaradi", async () => {
  const u = await newUser("pw@x.uz");
  const bad = await changePassword(u, "notogri", "yangiparol");
  assert.ok(bad.error);
  const ok = await changePassword(u, "parol123", "yangiparol");
  assert.ok(ok.ok);
  const loggedIn = await login("pw@x.uz", "yangiparol");
  assert.ok(loggedIn.token);
});

// ==== Instagram OAuth ====

test("OAuth kalitlarsiz o'chiq bo'ladi", () => {
  assert.strictEqual(oauth.oauthAvailable, false);
});

test("authUrl to'g'ri Instagram manzilini quradi", () => {
  const url = oauth.authUrl("test-state");
  assert.match(url, /instagram\.com\/oauth\/authorize/);
  assert.match(url, /state=test-state/);
  assert.match(url, /response_type=code/);
  assert.match(url, /instagram_business_manage_messages/);
  assert.match(url, /instagram_business_manage_comments/);
});

test("redirect URI Instagram callback'iga qaraydi", () => {
  assert.match(oauth.redirectUri, /\/connect\/instagram\/callback$/);
});

// ==== Login brute-force himoyasi ====

test("5 marta xato parol kiritilsa akkaunt vaqtincha bloklanadi", async () => {
  await newUser("lock@x.uz");
  for (let i = 0; i < 5; i++) await login("lock@x.uz", "notogri");
  const res = await login("lock@x.uz", "parol123");
  assert.match(res.error, /urinish/);
});


