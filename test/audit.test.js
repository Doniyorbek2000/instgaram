import test from "node:test";
import assert from "node:assert";
import { rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";

const { register } = await import("../src/auth.js");
const { pushChat, loadHistory, recentHistory, deleteHistory, compactIdleChats, CHAT_CACHE, flushArchive } = await import("../src/chatStore.js");
const { diffColumns } = await import("../src/pgdb.js");
const { createOrder, ensureShop } = await import("../src/shop.js");
const { handleShopPayme, handleShopClick, clickSign, shopPaymentsRouter } = await import("../src/shopPayments.js");
const { securityHeaders } = await import("../src/securityHeaders.js");
const { isDuplicate, loadSeenEvents, flushSeenEvents } = await import("../src/dedup.js");

const { user } = await register("audit@test.uz", "parol123", "Audit Shop");

test("suhbat tarixi: kesh cheklangan, arxivda hammasi saqlanadi", async () => {
  const key = "ig:777";
  for (let i = 0; i < 150; i++) pushChat(user, key, { role: i % 2 ? "assistant" : "user", text: `xabar ${i}` });
  assert.strictEqual(user.chats[key].length, CHAT_CACHE);
  assert.strictEqual(recentHistory(user, key).length, 16);
  assert.strictEqual(recentHistory(user, key).at(-1).text, "xabar 149");
  const page1 = await loadHistory(user, key, { limit: 100 });
  assert.strictEqual(page1.total, 150);
  assert.strictEqual(page1.messages.length, 100);
  assert.ok(page1.hasMore);
  assert.strictEqual(page1.messages[0].text, "xabar 50");
  const all = await loadHistory(user, key, { limit: 500 });
  assert.strictEqual(all.messages.length, 150);
  assert.ok(!all.hasMore);
  assert.strictEqual(all.messages[0].text, "xabar 0");
  await deleteHistory(user.id, key);
  assert.strictEqual((await loadHistory(user, key)).total, CHAT_CACHE, "arxiv o'chdi, faqat kesh qoldi");
});

test("arxivdan oldingi (eski) kesh xabarlari tarixda yo'qolmaydi", async () => {
  user.chats["tg:5"] = [{ role: "user", text: "eski", at: "2024-01-01T00:00:00.000Z" }];
  pushChat(user, "tg:5", { role: "assistant", text: "yangi" });
  const h = await loadHistory(user, "tg:5");
  assert.deepStrictEqual(h.messages.map((m) => m.text), ["eski", "yangi"]);
});

test("jim suhbatlar keshi qisqaradi", () => {
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  user.chats["wa:1"] = Array.from({ length: 30 }, (_, i) => ({ role: "user", text: String(i), at: old }));
  assert.ok(compactIdleChats(user) >= 1);
  assert.strictEqual(user.chats["wa:1"].length, 4);
  assert.strictEqual(user.chats["wa:1"].at(-1).text, "29");
});

test("PostgreSQL: faqat o'zgargan ustunlar yoziladi", () => {
  const u = { id: "x", settings: { a: 1 }, chats: {}, meta: { pageId: "1" } };
  const snap = { settings: JSON.stringify({ a: 1 }), chats: "{}", meta: JSON.stringify({ pageId: "1" }) };
  assert.deepStrictEqual(diffColumns(u, snap), []);
  u.settings.a = 2;
  u.meta.igUserId = "5";
  assert.deepStrictEqual(diffColumns(u, snap).map((c) => c.col).sort(), ["meta", "settings"]);
});

test("takroriy webhook ID'lari faylda saqlanadi va qayta yuklanadi", async () => {
  assert.strictEqual(isDuplicate("mid.abc"), false);
  assert.strictEqual(isDuplicate("mid.abc"), true);
  const file = flushSeenEvents();
  assert.ok(JSON.parse(readFileSync(file, "utf8")).some(([id]) => id === "mid.abc"));
  assert.ok((await loadSeenEvents()) >= 1);
});

test("xavfsizlik sarlavhalari", async () => {
  const app = express();
  app.use(securityHeaders);
  app.get("/x", (_q, r) => r.send("ok"));
  app.get("/w/1.js", (_q, r) => r.send("ok"));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + "/x", { headers: { "x-forwarded-proto": "https" } });
    assert.strictEqual(r.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.strictEqual(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.match(r.headers.get("strict-transport-security"), /max-age=31536000/);
    const w = await fetch(base + "/w/1.js");
    assert.strictEqual(w.headers.get("x-frame-options"), null, "widget boshqa saytlarga joylanadi");
  } finally {
    server.close();
  }
});

function shopWithOrder() {
  const shop = ensureShop(user);
  shop.settings.payme = { merchantId: "a".repeat(24), account: "order_id", key: "PAYME_SECRET" };
  shop.settings.click = { serviceId: "123", merchantId: "456", secretKey: "CLICK_SECRET" };
  return { order: createOrder(user, "", [{ name: "Ko'ylak", price: 150000, qty: 2 }]) };
}

test("Payme: do'kon buyurtmasi avtomatik to'landi bo'ladi", async () => {
  const { order } = shopWithOrder();
  assert.strictEqual(order.status, "awaiting_payment");
  const account = { order_id: String(order.num) };
  const bad = await handleShopPayme(user, { id: 1, method: "CheckPerformTransaction", params: { amount: 100, account } });
  assert.strictEqual(bad.error.code, -31001);
  const noCode = await handleShopPayme(user, { id: 2, method: "CheckPerformTransaction", params: { amount: 30000000, account } });
  assert.strictEqual(noCode.result.allow, true);
  assert.strictEqual(noCode.result.detail, undefined, "MXIK yo'q — chek tafsiloti yuborilmaydi");
  ensureShop(user).settings.fiscal = { ikpu: "10305008002000000", packageCode: "1545643", vatPercent: 12 };
  const chk = await handleShopPayme(user, { id: 2, method: "CheckPerformTransaction", params: { amount: 30000000, account } });
  assert.strictEqual(chk.result.detail.items[0].count, 2);
  assert.strictEqual(chk.result.detail.items[0].price, 15000000);
  assert.strictEqual(chk.result.detail.items[0].code, "10305008002000000");
  const cr = await handleShopPayme(user, { id: 3, method: "CreateTransaction", params: { id: "tx1", time: Date.now(), amount: 30000000, account } });
  assert.strictEqual(cr.result.state, 1);
  const again = await handleShopPayme(user, { id: 4, method: "CreateTransaction", params: { id: "tx2", time: Date.now(), amount: 30000000, account } });
  assert.strictEqual(again.error.code, -31099, "bitta buyurtmaga ikkinchi tranzaksiya yo'q");
  const pf = await handleShopPayme(user, { id: 5, method: "PerformTransaction", params: { id: "tx1" } });
  assert.strictEqual(pf.result.state, 2);
  assert.strictEqual(ensureShop(user).orders.find((o) => o.id === order.id).status, "paid");
  assert.strictEqual(ensureShop(user).orders.find((o) => o.id === order.id).paidVia, "Payme");
  const ct = await handleShopPayme(user, { id: 6, method: "CheckTransaction", params: { id: "tx1" } });
  assert.strictEqual(ct.result.state, 2);
  const st = await handleShopPayme(user, { id: 7, method: "GetStatement", params: { from: 0, to: Date.now() + 1000 } });
  assert.strictEqual(st.result.transactions[0].account.order_id, String(order.num));
  const cancel = await handleShopPayme(user, { id: 8, method: "CancelTransaction", params: { id: "tx1", reason: 5 } });
  assert.strictEqual(cancel.result.state, -2);
  assert.strictEqual(ensureShop(user).orders.find((o) => o.id === order.id).status, "cancelled");
});

test("Payme endpoint: noto'g'ri kalit rad etiladi", async () => {
  const app = express();
  app.use(express.json());
  app.use(shopPaymentsRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const call = (key) => fetch(`${base}/pay/payme/${user.id}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`Paycom:${key}`).toString("base64") }, body: JSON.stringify({ id: 1, method: "CheckTransaction", params: { id: "nope" } }) }).then((r) => r.json());
    assert.strictEqual((await call("xato")).error.code, -32504);
    assert.strictEqual((await call("PAYME_SECRET")).error.code, -31003);
  } finally {
    server.close();
  }
});

test("Click: imzo tekshiriladi, Complete buyurtmani to'laydi", async () => {
  const { order } = shopWithOrder();
  const base = { click_trans_id: "9001", service_id: "123", click_paydoc_id: "1", merchant_trans_id: String(order.num), amount: "300000.00", sign_time: "2026-09-24 10:00:00" };
  const prep = { ...base, action: "0" };
  assert.strictEqual((await handleShopClick(user, { ...prep, sign_string: "bad" })).error, -1);
  const p = await handleShopClick(user, { ...prep, sign_string: clickSign(prep, "CLICK_SECRET", 0) });
  assert.strictEqual(p.error, 0);
  assert.ok(p.merchant_prepare_id);
  const comp = { ...base, action: "1", error: "0", merchant_prepare_id: String(p.merchant_prepare_id) };
  const c = await handleShopClick(user, { ...comp, sign_string: clickSign(comp, "CLICK_SECRET", 1) });
  assert.strictEqual(c.error, 0);
  assert.strictEqual(ensureShop(user).orders.find((o) => o.id === order.id).status, "paid");
  const twice = await handleShopClick(user, { ...comp, sign_string: clickSign(comp, "CLICK_SECRET", 1) });
  assert.strictEqual(twice.error, -4);
  const wrongSum = { ...base, click_trans_id: "9002", amount: "1.00", action: "0" };
  assert.strictEqual((await handleShopClick(user, { ...wrongSum, sign_string: clickSign(wrongSum, "CLICK_SECRET", 0) })).error, -2);
});

test.after(() => flushArchive());
