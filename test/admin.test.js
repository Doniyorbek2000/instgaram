import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
delete process.env.ADMIN_LOGIN;
delete process.env.ADMIN_PASSWORD;
process.env.FREE_MODE = "false";

const { register, login, attachUser } = await import("../src/auth.js");
const { adminRouter } = await import("../src/admin/routes.js");
const { findUserById, createOrder, listOrders } = await import("../src/db.js");
const { botEnabled } = await import("../src/credits.js");

const { user: biz } = await register("biznes@test.uz", "parol123", "Guli Shop");
const { user: other } = await register("boshqa@test.uz", "parol123", "=HYPERLINK(1)");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(adminRouter);
app.get("/whoami", attachUser, (req, res) => res.json({ id: req.user?.id || null }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

let cookie = "";
const form = (o) => new URLSearchParams(o).toString();
const post = (p, body = {}, headers = {}) => fetch(base + p, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", cookie, ...headers }, body: form(body) });
const get = (p) => fetch(base + p, { redirect: "manual", headers: { cookie } });

test("sessiyasiz admin sahifalari yopiq", async () => {
  const r = await get("/admin");
  assert.strictEqual(r.status, 302);
  assert.match(r.headers.get("location"), /^\/admin\/login/);
  assert.strictEqual((await get("/admin/login")).status, 200);
  assert.strictEqual((await post("/admin/businesses/x/block", { on: "1" })).status, 401);
});

test("noto'g'ri parol rad etiladi, to'g'risi bilan kiriladi (telefon har xil formatda)", async () => {
  const bad = await post("/admin/login", { login: "+998 94 939 22 50", password: "xato" }, { "x-forwarded-for": "10.0.0.9" });
  assert.strictEqual(bad.status, 401);
  assert.match(await bad.text(), /Login yoki parol noto/);
  const ok = await post("/admin/login", { login: "+998 (94) 939-22-50", password: "949392250Adm" });
  assert.strictEqual(ok.status, 302);
  assert.strictEqual(ok.headers.get("location"), "/admin");
  const set = ok.headers.get("set-cookie");
  assert.match(set, /^adm=.+; Path=\/admin; HttpOnly; SameSite=Strict/);
  cookie = set.split(";")[0];
  const dash = await get("/admin");
  assert.strictEqual(dash.status, 200);
  const html = await dash.text();
  assert.match(html, /Bizneslar/);
  assert.match(html, /Dastlabki parol ishlatilmoqda/);
});

test("5 ta xato urinishdan so'ng IP bloklanadi", async () => {
  for (let i = 0; i < 5; i++) await post("/admin/login", { login: "998949392250", password: `x${i}` }, { "x-forwarded-for": "10.0.0.77" });
  const r = await post("/admin/login", { login: "998949392250", password: "949392250Adm" }, { "x-forwarded-for": "10.0.0.77" });
  assert.strictEqual(r.status, 401);
  assert.match(await r.text(), /Juda ko/);
});

test("barcha bo'limlar ochiladi", async () => {
  for (const p of ["/admin", "/admin/businesses", "/admin/businesses?q=guli&status=trial&sort=name", `/admin/businesses/${biz.id}`, "/admin/payments", "/admin/plans", "/admin/ai", "/admin/announce", "/admin/audit", "/admin/system", "/admin/security"]) {
    const r = await get(p);
    assert.strictEqual(r.status, 200, p);
  }
  const list = await (await get("/admin/businesses?q=guli")).text();
  assert.match(list, /Guli Shop/);
  assert.ok(!list.includes("boshqa@test.uz"));
});

test("CSV eksport formula injectiondan himoyalangan", async () => {
  const r = await get("/admin/businesses.csv");
  assert.match(r.headers.get("content-disposition"), /attachment/);
  const text = await r.text();
  assert.match(text, /"'=HYPERLINK\(1\)"/);
});

test("obuna, kredit, izoh va tokenlar", async () => {
  await post(`/admin/businesses/${biz.id}/subscription`, { action: "30", plan: "pro" });
  let u = await findUserById(biz.id);
  assert.strictEqual(u.subscription.status, "active");
  assert.strictEqual(u.subscription.plan, "pro");
  assert.ok(Date.parse(u.subscription.expiresAt) > Date.now() + 29 * 86400000);
  await post(`/admin/businesses/${biz.id}/subscription`, { action: "until", until: "2099-12-31", plan: "business" });
  u = await findUserById(biz.id);
  assert.match(u.subscription.expiresAt, /^2099-12-31/);
  const past = await post(`/admin/businesses/${biz.id}/subscription`, { action: "until", until: "2001-01-01" });
  assert.match(decodeURIComponent(past.headers.get("location")), /Kelajakdagi/);
  await post(`/admin/businesses/${biz.id}/credits`, { credits: "500" });
  assert.strictEqual((await findUserById(biz.id)).aiUsage.bonus, 500);
  await post(`/admin/businesses/${biz.id}/note`, { note: "VIP mijoz" });
  assert.strictEqual((await findUserById(biz.id)).meta.adminNote, "VIP mijoz");
  await post(`/admin/businesses/${biz.id}/meta`, { igAccessToken: "IGAAxyz123", pageId: "" });
  assert.strictEqual((await findUserById(biz.id)).meta.igAccessToken, "IGAAxyz123");
  const page = await (await get(`/admin/businesses/${biz.id}`)).text();
  assert.ok(!page.includes("IGAAxyz123"), "token sahifada ochiq ko'rinmaydi");
});

test("bloklash: bot to'xtaydi, panelga kirish yopiladi", async () => {
  const s = await login("biznes@test.uz", "parol123");
  assert.ok(s.token);
  await post(`/admin/businesses/${biz.id}/block`, { on: "1" });
  const u = await findUserById(biz.id);
  assert.strictEqual(u.meta.blocked, true);
  assert.strictEqual(botEnabled(u), false);
  assert.match((await login("biznes@test.uz", "parol123")).error, /bloklangan/);
  const who = await (await fetch(`${base}/whoami`, { headers: { cookie: `sid=${s.token}` } })).json();
  assert.strictEqual(who.id, null);
  await post(`/admin/businesses/${biz.id}/block`, { on: "0" });
  assert.ok((await login("biznes@test.uz", "parol123")).token);
});

test("kabinetga kirish (impersonate) va vaqtinchalik parol", async () => {
  const r = await post(`/admin/businesses/${biz.id}/impersonate`);
  assert.strictEqual(r.headers.get("location"), "/dashboard");
  const sid = r.headers.get("set-cookie").match(/sid=([a-f0-9]+)/)[1];
  const who = await (await fetch(`${base}/whoami`, { headers: { cookie: `sid=${sid}` } })).json();
  assert.strictEqual(who.id, biz.id);
  const rp = await post(`/admin/businesses/${biz.id}/reset-password`);
  const tmp = new URL(base + rp.headers.get("location")).searchParams.get("tmp");
  assert.ok(tmp && tmp.length >= 8);
  assert.ok((await login("biznes@test.uz", tmp)).token);
  assert.ok((await login("biznes@test.uz", "parol123")).error);
});

test("to'lovni qo'lda tasdiqlash obunani faollashtiradi", async () => {
  const o = await createOrder({ userId: other.id, plan: "start", days: 30, amount: 99000 });
  await post(`/admin/payments/${o.id}/confirm`);
  assert.strictEqual((await listOrders()).find((x) => x.id === o.id).status, "paid");
  assert.strictEqual((await findUserById(other.id)).subscription.status, "active");
  const again = await post(`/admin/payments/${o.id}/confirm`);
  assert.match(decodeURIComponent(again.headers.get("location")), /allaqachon/);
});

test("e'lon, audit jurnali", async () => {
  await post("/admin/announce", { enabled: "on", text: "Yangi funksiya: Do'kon!", level: "ok", link: "javascript:alert(1)" });
  const { platformSettings } = await import("../src/credits.js");
  const a = platformSettings().announcement;
  assert.strictEqual(a.text, "Yangi funksiya: Do'kon!");
  assert.strictEqual(a.link, "", "xavfli havola qabul qilinmaydi");
  const audit = await (await get("/admin/audit")).text();
  assert.match(audit, /Bloklandi/);
  assert.match(audit, /Kabinetga kirildi/);
  assert.match(audit, /Muvaffaqiyatsiz kirish/);
});

test("biznesni o'chirish faqat email tasdig'i bilan", async () => {
  const wrong = await post(`/admin/businesses/${other.id}/delete`, { confirm: "notogri" });
  assert.match(decodeURIComponent(wrong.headers.get("location")), /mos kelmadi/);
  assert.ok(await findUserById(other.id));
  await post(`/admin/businesses/${other.id}/delete`, { confirm: "BOSHQA@test.uz" });
  assert.strictEqual(await findUserById(other.id), null);
});

test("parolni o'zgartirish: eski sessiya va eski parol ishlamaydi", async () => {
  const weak = await post("/admin/security", { login: "+998949392250", current: "949392250Adm", next: "short1", next2: "short1" });
  assert.match(decodeURIComponent(weak.headers.get("location")), /kamida 10/);
  const r = await post("/admin/security", { login: "+998949392250", current: "949392250Adm", next: "YangiParol2026", next2: "YangiParol2026" });
  assert.strictEqual(r.headers.get("location"), "/admin/login");
  assert.strictEqual((await get("/admin")).status, 302, "eski sessiya bekor");
  assert.strictEqual((await post("/admin/login", { login: "998949392250", password: "949392250Adm" }, { "x-forwarded-for": "10.1.1.1" })).status, 401);
  const ok = await post("/admin/login", { login: "998949392250", password: "YangiParol2026" }, { "x-forwarded-for": "10.1.1.1" });
  assert.strictEqual(ok.status, 302);
  cookie = ok.headers.get("set-cookie").split(";")[0];
  assert.ok(!(await (await get("/admin")).text()).includes("Dastlabki parol"));
});
