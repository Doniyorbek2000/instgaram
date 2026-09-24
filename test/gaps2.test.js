import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { register } = await import("../src/auth.js");
const crm = await import("../src/crm.js");
const ai = await import("../src/aiActions.js");
const shop = await import("../src/shop.js");
const gt = await import("../src/growthTools.js");
const msg = await import("../src/messaging.js");
const push = await import("../src/push.js");
const { processMessage } = await import("../src/respond.js");
const { getContactMeta, setFields } = await import("../src/contacts.js");

const { user: t } = await register("gaps2@test.uz", "parol123", "Guli Shop");
t.rules = [];

const jsonRes = (status, data) => ({ ok: status < 400, status, text: async () => JSON.stringify(data), json: async () => data });

test("amoCRM: bitim ochadi, keyingisida izoh qo'shadi", async () => {
  const errs = crm.saveCrmSettings(t, { crmType: "amocrm", amoDomain: "https://guli.amocrm.ru/leads", amoToken: "tok123", crmAuto_forms: "on" });
  assert.deepStrictEqual(errs, []);
  assert.strictEqual(crm.crmSettings(t).amo.domain, "guli.amocrm.ru");
  assert.strictEqual(crm.normalizeAmoDomain("guli"), "guli.amocrm.ru");
  assert.strictEqual(crm.normalizeAmoDomain("evil.com"), "");
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers.Authorization });
    if (url.endsWith("/leads/complex")) return jsonRes(200, [{ id: 555, contact_id: 9 }]);
    return jsonRes(200, {});
  };
  const r = await crm.pushCrmLead(t, { key: "ig:1", name: "Aziza", phone: "+998901234567", price: 150000, note: "Qizil ko'ylak", tags: ["vip"] }, { fetchFn });
  assert.deepStrictEqual(r, { ok: true, id: "555" });
  assert.strictEqual(calls[0].url, "https://guli.amocrm.ru/api/v4/leads/complex");
  assert.strictEqual(calls[0].auth, "Bearer tok123");
  const lead = calls[0].body[0];
  assert.strictEqual(lead.price, 150000);
  assert.strictEqual(lead._embedded.contacts[0].custom_fields_values[0].values[0].value, "+998901234567");
  assert.deepStrictEqual(lead._embedded.tags.map((x) => x.name), ["obunext", "vip"]);
  assert.match(calls[1].url, /\/leads\/555\/notes$/);
  assert.strictEqual(getContactMeta(t, "ig:1").crmLeadId, "555");
  calls.length = 0;
  const r2 = await crm.pushCrmLead(t, { key: "ig:1", title: "Yana buyurtma" }, { fetchFn });
  assert.strictEqual(r2.updated, true);
  assert.match(calls[0].url, /\/leads\/555\/notes$/);
});

test("Bitrix24: crm.lead.add va xato holati", async () => {
  assert.ok(crm.saveCrmSettings(t, { crmType: "bitrix24", bitrixUrl: "http://127.0.0.1/rest/1/x/" }).length, "ichki manzil rad etiladi");
  assert.deepStrictEqual(crm.saveCrmSettings(t, { crmType: "bitrix24", bitrixUrl: "https://guli.bitrix24.uz/rest/1/abc123" }), []);
  let body;
  const ok = await crm.pushCrmLead(t, { key: "tg:2", name: "Sardor", phone: "+998911112233" }, { fetchFn: async (url, o) => { body = { url, b: JSON.parse(o.body) }; return jsonRes(200, { result: 77 }); } });
  assert.deepStrictEqual(ok, { ok: true, id: "77" });
  assert.strictEqual(body.url, "https://guli.bitrix24.uz/rest/1/abc123/crm.lead.add.json");
  assert.strictEqual(body.b.fields.PHONE[0].VALUE, "+998911112233");
  const bad = await crm.pushCrmLead(t, { key: "tg:3" }, { fetchFn: async () => jsonRes(401, { error_description: "invalid" }) });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /Bitrix24: 401/);
  crm.saveCrmSettings(t, { crmType: "" });
});

test("AI amallari: blok ajratiladi, kontakt/teg/lid yoziladi, rozilik talabi", async () => {
  const reply = "Rahmat, Aziza! Menejer bog'lanadi.\n[[ACTIONS]]{\"name\":\"Aziza\",\"phone\":\"90 123 45 67\",\"tags\":[\"lid\",\"ko'ylak\"],\"lead\":true,\"summary\":\"Qizil ko'ylak buyurtma\"}[[/ACTIONS]]";
  const { text, actions } = ai.extractActions(reply);
  assert.strictEqual(text, "Rahmat, Aziza! Menejer bog'lanadi.");
  assert.strictEqual(actions.name, "Aziza");
  assert.deepStrictEqual(ai.extractActions("oddiy javob"), { text: "oddiy javob", actions: null });
  assert.strictEqual(ai.extractActions("javob [[ACTIONS]]{buzuq").text, "javob");
  const done = await ai.executeAiActions(t, "ig:50", actions, { channel: "instagram" });
  assert.ok(done.includes("fields") && done.includes("lead") && done.includes("tags"));
  const f = getContactMeta(t, "ig:50").fields;
  assert.strictEqual(f.name, "Aziza");
  assert.match(f.phone, /998901234567/);
  assert.ok(t.leads.some((l) => l.key === "ig:50"));
  // Rozilik yoqilgan — telefon rozilikdan oldin saqlanmaydi
  t.settings.ai = { ...(t.settings.ai || {}), askConsent: true };
  await ai.executeAiActions(t, "ig:51", { phone: "901234567", lead: true }, {});
  assert.ok(!getContactMeta(t, "ig:51").fields.phone);
  assert.match(ai.actionsPrompt(t, "ig:51"), /ROZILIK/);
  await ai.executeAiActions(t, "ig:51", { phone: "901234567", consent: true }, {});
  assert.ok(getContactMeta(t, "ig:51").fields.phone && getContactMeta(t, "ig:51").fields.consent);
  assert.ok(!/ROZILIK/.test(ai.actionsPrompt(t, "ig:51")));
  t.settings.ai.askConsent = false;
  t.settings.ai.actions = false;
  assert.strictEqual(ai.actionsPrompt(t, "ig:52"), "");
  assert.deepStrictEqual(await ai.executeAiActions(t, "ig:52", { name: "X" }), []);
  t.settings.ai.actions = true;
});

test("do'kon: katalog, buyurtma, Payme/Click havolalari, holat va savat eslatmasi", async () => {
  const s = shop.ensureShop(t);
  s.settings.payme.merchantId = "5f9a1b2c3d4e5f6a7b8c9d0e";
  s.settings.click = { serviceId: "123", merchantId: "456" };
  const p = shop.sanitizeProduct({ name: "Qizil ko'ylak", price: "150 000", image: "https://cdn.uz/k.jpg", active: true });
  s.products.push(p);
  assert.strictEqual(p.price, 150000);
  assert.match(shop.shopPrompt(t), /Qizil ko'ylak: 150 000 so'm/);
  const key = "tg:700";
  await processMessage(t, "telegram", "700", { text: "salom" });
  const r = await processMessage(t, "telegram", "700", { payload: `SHOP:BUY:${p.id}` });
  assert.match(r.reply, /Buyurtma №1001/);
  assert.match(r.reply, /150 000 so'm/);
  const links = r.quickReplies.filter((o) => o.url);
  assert.strictEqual(links.length, 2);
  const decoded = Buffer.from(links[0].url.split("/").pop(), "base64").toString();
  assert.strictEqual(decoded, "m=5f9a1b2c3d4e5f6a7b8c9d0e;ac.order_id=1001;a=15000000");
  assert.match(links[1].url, /my\.click\.uz\/services\/pay\?service_id=123&merchant_id=456&amount=150000&transaction_param=1001/);
  const order = shop.findOrder(t, 1001);
  assert.strictEqual(order.status, "awaiting_payment");
  assert.ok(getContactMeta(t, key).tags.includes("buyurtma"));
  // Savat eslatmasi: 60 daqiqadan so'ng bir marta
  const sent = [];
  const send = async (_t, chan, id, text, opts) => { sent.push({ chan, id, text, opts }); return true; };
  const created = Date.parse(order.createdAt);
  assert.strictEqual(await shop.runTenantCartReminders(t, created + 30 * 60000, { send }), 0);
  assert.strictEqual(await shop.runTenantCartReminders(t, created + 61 * 60000, { send }), 1);
  assert.match(sent[0].text, /№1001/);
  assert.strictEqual(await shop.runTenantCartReminders(t, created + 90 * 60000, { send }), 0, "faqat bir marta");
  // Holat: to'landi → mijozga xabar
  sent.length = 0;
  const st = await shop.setOrderStatus(t, order.id, "paid", { send });
  assert.strictEqual(st.delivered, true);
  assert.match(sent[0].text, /To'lov qabul qilindi! Buyurtma №1001/);
  // "katalog" deb yozsa — karusel (Telegram tokeni yo'q, lekin xato bermaydi)
  const k = await processMessage(t, "telegram", "700", { text: "Katalog" });
  assert.strictEqual(k.reply, null);
  const none = await processMessage(t, "telegram", "700", { payload: "SHOP:BUY:yoq" });
  assert.match(none.reply, /mavjud emas/);
});

test("flow: katalog bloki va to'lov havolasi amali", async () => {
  const flows = await import("../src/flows.js");
  const p = shop.ensureShop(t).products[0];
  const f = flows.sanitizeFlow({
    enabled: true, name: "Kurs", start: "c",
    nodes: [
      { id: "c", type: "catalog", text: "Mahsulotlar 👇", productIds: [p.id], next: "a" },
      { id: "a", type: "action", actions: [{ kind: "payment_link", key: "{narx}", value: "Kurs to'lovi" }] },
    ],
  });
  setFields(t, "tg:800", { narx: "250 000" });
  const out = [];
  await flows.startFlow(t, "tg:800", f, { send: async (m) => { out.push(m); return true; } });
  assert.strictEqual(out[0].text, "Mahsulotlar 👇");
  assert.strictEqual(out[1].carousel[0].title, "Qizil ko'ylak");
  assert.strictEqual(out[1].carousel[0].buttons[0].payload, `SHOP:BUY:${p.id}`);
  assert.match(out[2].text, /Kurs to'lovi — 250 000 so'm/);
  assert.ok(out[2].options.some((o) => /paycom/.test(o.url)));
});

test("o'sish vositalari: kanal havolalari, vidjet, QR", async () => {
  gt.saveContacts(t, { ig: "@guli_shop", tg: "https://t.me/guli_bot", wa: "+998 90 123 45 67", fb: "" });
  assert.strictEqual(gt.channelUrl(t, "ig", "flayer"), "https://ig.me/m/guli_shop?ref=flayer");
  assert.strictEqual(gt.channelUrl(t, "tg", "flayer"), "https://t.me/guli_bot?start=flayer");
  assert.strictEqual(gt.channelUrl(t, "wa", "salom"), "https://wa.me/998901234567?text=salom");
  assert.strictEqual(gt.channelUrl(t, "fb", "x"), "");
  const l = gt.createLink(t, { name: "Flayer", channel: "tg", code: "fl ayer!" });
  assert.strictEqual(l.code, "flayer");
  const svg = await gt.qrSvg("https://t.me/guli_bot?start=flayer");
  assert.match(svg, /^<svg/);
  const png = await gt.qrPng("x");
  assert.strictEqual(png.subarray(1, 4).toString(), "PNG");
  const w = gt.ensureTools(t).widget;
  w.enabled = true; w.greeting = "<b>Salom</b>";
  const js = gt.widgetScript(t);
  assert.match(js, /ig\.me\/m\/guli_shop/);
  assert.ok(!js.includes("<b>"), "HTML qochiriladi");
  assert.strictEqual(gt.slugify("Guli Shop!!"), "guli-shop");
});

test("SMS (Eskiz) va Email", async () => {
  assert.strictEqual(msg.normalizeUzPhone("+998 (90) 123-45-67"), "998901234567");
  assert.strictEqual(msg.normalizeUzPhone("901234567"), "998901234567");
  assert.strictEqual(msg.normalizeUzPhone("+7 999 123"), "");
  assert.strictEqual((await msg.sendSms(t, "901234567", "x")).ok, false, "sozlanmagan");
  msg.saveMessagingSettings(t, { smsEmail: "a@b.uz", smsPassword: "p", smsFrom: "4546" });
  const calls = [];
  let loginCount = 0;
  const fetchFn = async (url, opts) => {
    calls.push(url);
    if (url.endsWith("/auth/login")) { loginCount++; return jsonRes(200, { data: { token: `T${loginCount}` } }); }
    if (opts.headers.Authorization === "Bearer T1") return jsonRes(401, { message: "expired" });
    return jsonRes(200, { id: "sms1", status: "waiting" });
  };
  const r = await msg.sendSms(t, "+998901234567", "Buyurtma qabul qilindi", { fetchFn });
  assert.deepStrictEqual(r, { ok: true, id: "sms1" });
  assert.strictEqual(loginCount, 2, "eskirgan token yangilandi");
  assert.strictEqual((await msg.sendEmail(t, "a@b.uz", "s", "t")).ok, false, "SMTP sozlanmagan");
  msg.saveMessagingSettings(t, { smsEmail: "a@b.uz", smtpHost: "smtp.test.uz", smtpPort: "465", smtpSecure: "on", smtpUser: "u", smtpPass: "p", smtpFrom: "Guli <u@test.uz>" });
  const mails = [];
  const transport = { sendMail: async (m) => { mails.push(m); return { messageId: "1" }; } };
  assert.strictEqual((await msg.sendEmail(t, "mijoz@mail.uz", "Salom", "Matn", { transport })).ok, true);
  assert.strictEqual(mails[0].to, "mijoz@mail.uz");
  assert.strictEqual((await msg.sendEmail(t, "notanemail", "s", "t", { transport })).ok, false);
  assert.ok(msg.saveMessagingSettings(t, { smtpHost: "127.0.0.1" }).length);
});

test("Web Push: obuna saqlanadi, yaroqsizi o'chiriladi", async () => {
  assert.strictEqual(push.addSubscription(t, { endpoint: "http://x" }), false);
  assert.ok(push.addSubscription(t, { endpoint: "https://fcm.googleapis.com/a", keys: { p256dh: "k", auth: "a" } }, { by: "o@x.uz" }));
  assert.ok(push.addSubscription(t, { endpoint: "https://fcm.googleapis.com/b", keys: { p256dh: "k", auth: "a" } }));
  const got = [];
  const send = async (s, payload) => {
    if (s.endpoint.endsWith("/b")) { const e = new Error("gone"); e.statusCode = 410; throw e; }
    got.push(JSON.parse(payload));
  };
  assert.strictEqual(await push.pushToTenant(t, { title: "🚨 Operator", body: "ig:1" }, { send }), 1);
  assert.strictEqual(got[0].title, "🚨 Operator");
  assert.deepStrictEqual(t.pushSubs.map((s) => s.endpoint), ["https://fcm.googleapis.com/a"]);
  assert.ok((await push.vapidKeys()).publicKey.length > 40);
});

test("yangi sahifalar ochiladi", async () => {
  const { sequencesRouter } = await import("../src/web/sequences_ui.js");
  const { shopRouter } = await import("../src/web/shop_ui.js");
  const { growthToolsRouter } = await import("../src/web/growth_tools_ui.js");
  const { integrationsRouter } = await import("../src/web/integrations_ui.js");
  const { pushRouter } = await import("../src/web/push_ui.js");
  const { aiSettingsRouter } = await import("../src/web/ai_settings_ui.js");
  const { growthRouter } = await import("../src/web/growth_ui.js");
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.user = t; next(); });
  app.use(pushRouter, sequencesRouter, shopRouter, growthToolsRouter, integrationsRouter, aiSettingsRouter, growthRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const p of ["/sequences", "/shop", "/shop?tab=products", "/shop?tab=settings", "/growth-tools", "/integrations", "/ai-settings", "/growth?tab=menu", "/manifest.webmanifest", "/sw.js", `/w/${t.id}.js`]) {
      const r = await fetch(base + p);
      assert.strictEqual(r.status, 200, p);
    }
    const created = await fetch(`${base}/sequences/create`, { method: "POST", redirect: "manual" });
    const loc = created.headers.get("location");
    assert.match(loc, /^\/sequences\/seq_/);
    assert.strictEqual((await fetch(base + loc)).status, 200);
    const pg = gt.ensureTools(t).page;
    pg.enabled = true; pg.slug = "guli";
    const page = await fetch(`${base}/p/guli`);
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /t\.me\/guli_bot\?start=bio/);
    const l = gt.ensureTools(t).links[0];
    const g = await fetch(`${base}/g/${t.id}/${l.id}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 iPhone" } });
    assert.strictEqual(g.headers.get("location"), "https://t.me/guli_bot?start=flayer");
    assert.strictEqual(l.clicks, 1);
  } finally {
    server.close();
  }
});
