import test from "node:test";
import assert from "node:assert";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
rmSync(path.join(root, "data"), { recursive: true, force: true });
process.env.BACKUP_DIR = path.join(root, "data", "_test_backups");
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.ADMIN_TELEGRAM_CHAT_ID;

const { captureMail } = await import("../src/mailer.js");
const mails = [];
captureMail(mails);

const { register, login, requestPasswordReset, resetPasswordWithToken, sendEmailVerification, verifyEmailToken } = await import("../src/auth.js");
const { needsRefresh, refreshIgToken, runIgTokenRefresh } = await import("../src/igToken.js");
const { reminderStage, remindTenant } = await import("../src/lifecycle.js");
const { receiptDetail } = await import("../src/fiscal.js");
const { createBackup, listBackups } = await import("../src/backup.js");
const { alertAdmin, recentErrors } = await import("../src/monitor.js");
const { handlePayme } = await import("../src/payme.js");
const { savePlatformSettings } = await import("../src/credits.js");
const { createOrder } = await import("../src/db.js");

const { user } = await register("ops@test.uz", "parol123", "Ops Shop");
const DAY = 86400000;

test("parolni tiklash: havola emailga keladi, bir marta ishlaydi, eski sessiyalar yopiladi", async () => {
  assert.deepStrictEqual((await requestPasswordReset("yoq@test.uz", "https://x.uz")).channels, []);
  const r = await requestPasswordReset("OPS@test.uz", "https://x.uz");
  assert.deepStrictEqual(r.channels, ["email"]);
  const mail = mails.at(-1);
  assert.strictEqual(mail.to, "ops@test.uz");
  const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
  assert.ok(!JSON.stringify(user.meta).includes(token.split(".")[1]), "token ochiq saqlanmaydi");
  assert.strictEqual((await requestPasswordReset("ops@test.uz", "https://x.uz")).throttled, true, "1 daqiqada bir marta");
  assert.strictEqual((await resetPasswordWithToken(token, "123")).error.includes("6"), true);
  const ok = await resetPasswordWithToken(token, "yangiParol9");
  assert.ok(ok.ok && ok.token);
  assert.strictEqual((await resetPasswordWithToken(token, "boshqaParol9")).error, "invalid", "qayta ishlamaydi");
  assert.ok((await login("ops@test.uz", "yangiParol9")).token);
  assert.ok((await login("ops@test.uz", "parol123")).error);
  assert.strictEqual(user.meta.emailVerified, true);
});

test("email tasdiqlash", async () => {
  const { user: u2 } = await register("new@test.uz", "parol123", "New");
  assert.strictEqual(u2.meta.emailVerified, false);
  assert.ok(await sendEmailVerification(u2, "https://x.uz"));
  const token = decodeURIComponent(mails.at(-1).text.match(/token=([^\s]+)/)[1]);
  assert.strictEqual((await verifyEmailToken("x.y")), null);
  assert.strictEqual((await verifyEmailToken(token)).id, u2.id);
  assert.strictEqual(u2.meta.emailVerified, true);
});

test("Instagram token: muddati kelganda yangilanadi, xatoda egasi ogohlantiriladi", async () => {
  const now = Date.now();
  assert.strictEqual(needsRefresh({}, now), false);
  assert.strictEqual(needsRefresh({ igAccessToken: "a" }, now), true, "eski ulanish");
  assert.strictEqual(needsRefresh({ igAccessToken: "a", igTokenRefreshedAt: new Date(now - 3600000).toISOString() }, now), false, "24 soatdan yosh");
  assert.strictEqual(needsRefresh({ igAccessToken: "a", igTokenRefreshedAt: new Date(now - 8 * DAY).toISOString(), igTokenExpiresAt: new Date(now + 52 * DAY).toISOString() }, now), true);
  const t = { id: user.id, meta: { igAccessToken: "OLD" } };
  let calledUrl = "";
  const r = await refreshIgToken(t, { fetchFn: async (url) => { calledUrl = url; return new Response(JSON.stringify({ access_token: "NEW", expires_in: 5184000 })); } });
  assert.ok(r.ok);
  assert.match(calledUrl, /grant_type=ig_refresh_token/);
  assert.strictEqual(t.meta.igAccessToken, "NEW");
  assert.ok(Date.parse(t.meta.igTokenExpiresAt) > now + 59 * DAY);

  user.meta.igAccessToken = "BROKEN";
  delete user.meta.igTokenRefreshedAt;
  const n = await runIgTokenRefresh({ fetchFn: async () => new Response(JSON.stringify({ error: { message: "Session has expired" } }), { status: 400 }) });
  assert.strictEqual(n, 0);
  assert.match(user.meta.igTokenError, /expired/);
  assert.ok(user.meta.igTokenWarnedAt);
  user.meta.igAccessToken = "";
});

test("obuna eslatmalari: bosqichlar va bir martalik yuborish", async () => {
  const now = Date.now();
  const u = { id: "x", email: "e@test.uz", meta: {}, settings: { telegramChatId: "1" }, subscription: { status: "active", expiresAt: new Date(now + 2.5 * DAY).toISOString() } };
  assert.strictEqual(reminderStage(u, now), "d3");
  assert.strictEqual(reminderStage({ subscription: { status: "trial", trialEndsAt: new Date(now + 2.5 * DAY).toISOString() } }, now), null);
  assert.strictEqual(reminderStage({ subscription: { status: "trial", trialEndsAt: new Date(now + 0.5 * DAY).toISOString() } }, now), "d1");
  assert.strictEqual(reminderStage({ subscription: { status: "active", expiresAt: new Date(now - DAY).toISOString() } }, now), "ended");
  assert.strictEqual(reminderStage({ subscription: { status: "active", expiresAt: new Date(now - 10 * DAY).toISOString() } }, now), null);
  const tg = [];
  const deps = { sendTelegram: async (id, text) => tg.push(text), notifyPush: async () => {} };
  const ch = await remindTenant(u, now, deps);
  assert.deepStrictEqual(ch.sort(), ["email", "telegram"]);
  assert.match(tg[0], /3 kundan so'ng/);
  assert.deepStrictEqual(await remindTenant(u, now, deps), [], "takrorlanmaydi");
});

test("fiskal chek: MXIK bo'lmasa detail yuborilmaydi", async () => {
  assert.strictEqual(receiptDetail([{ title: "X", price: 1000, count: 1 }], {}), null);
  const d = receiptDetail([{ title: "X", price: 1000, count: 2 }], { ikpu: "10305008002000000", packageCode: "1545643", vatPercent: 12 });
  assert.deepStrictEqual(d.items[0], { title: "X", price: 100000, count: 2, code: "10305008002000000", package_code: "1545643", vat_percent: 12 });
  const order = await createOrder({ userId: user.id, plan: "start", days: 30, amount: 99000 });
  await savePlatformSettings({ fiscal: { ikpu: "10305008002000000", packageCode: "1545643", vatPercent: 12 } });
  const r = await handlePayme({ id: 1, method: "CheckPerformTransaction", params: { amount: 9900000, account: { order_id: order.id } } });
  assert.strictEqual(r.result.allow, true);
  assert.strictEqual(r.result.detail.items[0].code, "10305008002000000");
  assert.strictEqual(r.result.detail.items[0].price, 9900000);
});

test("zaxira nusxa: baza va fayllar arxivlanadi", async () => {
  await new Promise((r) => setTimeout(r, 200)); // db.json diskka yozilsin
  const r = await createBackup({ offsite: false });
  assert.ok(!r.error, r.error);
  const names = listBackups().map((b) => b.name);
  assert.ok(names.some((n) => n.endsWith("-db.ndjson.gz")));
  const dbFile = path.join(process.env.BACKUP_DIR, names.find((n) => n.endsWith("-db.ndjson.gz")));
  const lines = gunzipSync(readFileSync(dbFile)).toString().trim().split("\n").map((l) => JSON.parse(l));
  assert.strictEqual(lines[0].t, "meta");
  const jsondb = lines.find((l) => l.t === "jsondb");
  assert.ok(jsondb.r.users.some((u) => u.email === "ops@test.uz"));
  if (r.files.length > 1) assert.ok(existsSync(path.join(process.env.BACKUP_DIR, r.files[1].name)));
});

test("monitoring: xatolar yig'iladi, ogohlantirish takrorlanmaydi", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "t";
  process.env.ADMIN_TELEGRAM_CHAT_ID = "1";
  let sent = 0;
  const fetchFn = async () => { sent++; return new Response("{}"); };
  assert.strictEqual(await alertAdmin("test", "bir xil xato", { fetchFn }), true);
  assert.strictEqual(await alertAdmin("test", "bir xil xato", { fetchFn }), false);
  assert.strictEqual(sent, 1);
  assert.ok(recentErrors().length >= 2);
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.ADMIN_TELEGRAM_CHAT_ID;
});

test("parol tiklash sahifalari", async () => {
  const { web } = await import("../src/web/routes.js");
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(web);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.match(await (await fetch(base + "/login")).text(), /forgot-password/);
    assert.strictEqual((await fetch(base + "/forgot-password")).status, 200);
    const r = await fetch(base + "/forgot-password", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=nobody%40x.uz" });
    assert.match(await r.text(), /tiklash havolasi yuborildi/);
    assert.match(await (await fetch(base + "/reset-password?token=bad.token")).text(), /Yangi parol/);
    const bad = await fetch(base + "/reset-password", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "token=bad.token&password=abcdef12" });
    assert.match(await bad.text(), /eskirgan/);
  } finally {
    server.close();
  }
});
