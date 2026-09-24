import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.BASE_URL = "https://obunext.test";

const { register } = await import("../src/auth.js");
const flows = await import("../src/flows.js");
const { processMessage } = await import("../src/respond.js");
const { resolveAudience } = await import("../src/broadcasts.js");
const { trackedUrl, recordClick, isPreviewBot } = await import("../src/links.js");
const { getContactMeta, setFields } = await import("../src/contacts.js");

const { user: t } = await register("gaps1@test.uz", "parol123", "Gaps");
t.rules = [];
const capture = () => {
  const sent = [];
  return { sent, ctx: { send: async (m) => { sent.push(m); return true; } } };
};
const add = (def) => {
  const f = flows.sanitizeFlow({ enabled: true, ...def });
  flows.ensureFlows(t).list.push(f);
  return f;
};

test("STOP — ommaviy xabarlardan chiqaradi, START — qaytaradi", async () => {
  const key = "tg:501";
  await processMessage(t, "telegram", "501", { text: "salom" });
  assert.ok(resolveAudience(t, { channel: "tg" }).includes(key));
  const r = await processMessage(t, "telegram", "501", { text: "STOP" });
  assert.match(r.reply, /chiqdingiz/);
  assert.ok(getContactMeta(t, key).optOut);
  assert.ok(!resolveAudience(t, { channel: "tg" }).includes(key));
  const r2 = await processMessage(t, "telegram", "501", { text: "Obunani bekor qilish!" });
  assert.match(r2.reply, /chiqdingiz/);
  const r3 = await processMessage(t, "telegram", "501", { text: "start" });
  assert.match(r3.reply, /Qaytganingizdan/);
  assert.ok(!getContactMeta(t, key).optOut);
  // /start Telegram buyrug'i opt-in emas va "stop" so'zi gap ichida bo'lsa ham ishlamaydi
  const r4 = await processMessage(t, "telegram", "501", { text: "avtobus stop qayerda" });
  assert.ok(!getContactMeta(t, key).optOut, String(r4.reply));
});

test("A/B test bloki ulush bo'yicha tanlaydi va statistikani yozadi", async () => {
  assert.strictEqual(flows.pickVariant([{ id: "a", weight: 0 }, { id: "b", weight: 10 }]).id, "b");
  assert.strictEqual(flows.pickVariant([{ id: "a", weight: 0 }]), null);
  assert.strictEqual(flows.pickVariant([{ id: "a", weight: 50 }, { id: "b", weight: 50 }], () => 0.1).id, "a");
  assert.strictEqual(flows.pickVariant([{ id: "a", weight: 50 }, { id: "b", weight: 50 }], () => 0.9).id, "b");
  const f = add({
    name: "AB", start: "s",
    nodes: [
      { id: "s", type: "split", variants: [{ id: "va", label: "A", weight: 100, next: "ma" }, { id: "vb", label: "B", weight: 0, next: "mb" }] },
      { id: "ma", type: "message", text: "Variant A" },
      { id: "mb", type: "message", text: "Variant B" },
    ],
  });
  const { sent, ctx } = capture();
  await flows.startFlow(t, "tg:601", f, ctx);
  assert.deepStrictEqual(sent.map((m) => m.text), ["Variant A"]);
  assert.strictEqual(f.stats.split.s.va, 1);
  assert.deepStrictEqual(flows.validateFlow(f, []).errors, []);
});

test("HTTP bloki: javobni o'zgaruvchiga yozadi, xato va ichki tarmoq tarmog'i", async () => {
  const key = "tg:701";
  setFields(t, key, { phone: "+998 90 123" });
  let seen;
  const fetchMock = async (url, opts) => {
    seen = { url, opts };
    return { status: 200, text: async () => JSON.stringify({ data: { status: "yo'lda", items: [{ price: 120000 }] } }) };
  };
  const node = { method: "POST", url: "https://api.shop.uz/orders?phone={phone}", headers: "Authorization: Bearer {phone}", body: '{"p":"{phone}"}', map: "holat = data.status\nnarx = data.items.0.price\nhammasi = data" };
  assert.strictEqual(await flows.runHttpNode(t, key, node, { fetch: fetchMock }), true);
  assert.strictEqual(seen.url, "https://api.shop.uz/orders?phone=%2B998%2090%20123");
  assert.strictEqual(seen.opts.headers.Authorization, "Bearer +998 90 123");
  assert.strictEqual(seen.opts.headers["Content-Type"], "application/json");
  const fl = getContactMeta(t, key).fields;
  assert.strictEqual(fl.holat, "yo'lda");
  assert.strictEqual(fl.narx, "120000");
  assert.strictEqual(fl.http_status, "200");
  assert.match(fl.hammasi, /items/);
  assert.strictEqual(await flows.runHttpNode(t, key, { url: "http://127.0.0.1:3000/admin" }, { fetch: fetchMock }), false);
  assert.strictEqual(getContactMeta(t, key).fields.http_status, "blocked");
  const fail = async () => ({ status: 500, text: async () => "err" });
  const f = add({
    name: "HTTP", start: "h",
    nodes: [
      { id: "h", type: "http", url: "https://api.shop.uz/x", next: "ok", fail: "no" },
      { id: "ok", type: "message", text: "OK {http_status}" },
      { id: "no", type: "message", text: "Xato {http_status}" },
    ],
  });
  const { sent, ctx } = capture();
  await flows.startFlow(t, key, f, { ...ctx, fetch: fail });
  assert.deepStrictEqual(sent.map((m) => m.text), ["Xato 500"]);
});

test("raqamli shartlar va hisoblash amali", async () => {
  const key = "tg:801";
  const f = add({
    name: "Math", start: "a",
    nodes: [
      { id: "a", type: "action", actions: [{ kind: "math", key: "jami", value: "=100" }, { kind: "math", key: "jami", value: "+{qoshimcha}" }, { kind: "math", key: "jami", value: "*2" }], next: "c" },
      { id: "c", type: "condition", conditions: [{ kind: "var", key: "jami", op: "gte", value: "300" }], yes: "y", no: "n" },
      { id: "y", type: "message", text: "Katta: {jami}" },
      { id: "n", type: "message", text: "Kichik: {jami}" },
    ],
  });
  setFields(t, key, { qoshimcha: "50" });
  const { sent, ctx } = capture();
  await flows.startFlow(t, key, f, ctx);
  assert.deepStrictEqual(sent.map((m) => m.text), ["Katta: 300"]);
  assert.strictEqual(flows.toNumber("12 500 so'm"), 12500);
  assert.strictEqual(flows.toNumber("abc"), null);
});

test("havola bosilishi: hisoblanadi, bot preview hisoblanmaydi, flow davom etadi", async () => {
  const key = "tg:901";
  const f = add({
    name: "Link", start: "m",
    nodes: [
      { id: "m", type: "message", text: "Katalog", buttons: [{ id: "b1", title: "Ochish", url: "https://shop.uz/katalog", next: "after" }] },
      { id: "after", type: "message", text: "Katalog yoqdimi?" },
    ],
  });
  const { sent, ctx } = capture();
  await flows.startFlow(t, key, f, ctx);
  const url = sent[0].options[0].url;
  assert.match(url, /^https:\/\/obunext\.test\/l\//);
  const id = url.split("/").pop();
  assert.strictEqual(trackedUrl(t, "https://shop.uz/katalog", { key, flowId: f.id, nodeId: "m", buttonId: "b1" }), url, "bir xil havola qayta yaratilmaydi");
  assert.ok(isPreviewBot("facebookexternalhit/1.1") && isPreviewBot("TelegramBot (like TwitterBot)") && !isPreviewBot("Mozilla/5.0 (iPhone) Instagram 300"));
  assert.strictEqual(await recordClick(t, id, { userAgent: "facebookexternalhit/1.1" }), "https://shop.uz/katalog");
  assert.strictEqual(t.trackedLinks[id].clicks, 0);
  assert.strictEqual(await recordClick(t, id, { userAgent: "Mozilla/5.0 (iPhone) Instagram" }), "https://shop.uz/katalog");
  await recordClick(t, id, { userAgent: "Mozilla/5.0 (iPhone) Instagram" });
  assert.strictEqual(t.trackedLinks[id].clicks, 2);
  assert.strictEqual(f.stats.clicks.b1, 2);
  assert.strictEqual(f.stats.uniqueClicks, 1);
  assert.strictEqual(getContactMeta(t, key).fields.last_click, "Ochish");
  assert.strictEqual(await recordClick(t, "yoq", {}), null);
});

test("ketma-ketlik: Telegram'da yuboriladi, Instagram'da oyna yopiq bo'lsa o'tkaziladi, STOP chiqaradi", async () => {
  const seqMod = await import("../src/sequences.js");
  const seq = seqMod.sanitizeSequence({
    name: "Drip", enabled: true,
    steps: [{ delayMin: 60, text: "1-xabar {name|do'stim}" }, { delayMin: 1440, text: "2-xabar", buttons: [{ title: "Sayt", url: "https://shop.uz" }] }],
  });
  seqMod.ensureSequences(t).list.push(seq);
  const now = Date.now();
  assert.ok(seqMod.subscribe(t, "tg:1001", seq.id, now));
  assert.ok(seqMod.subscribe(t, "ig:1002", seq.id, now)); // IG'da hech qachon yozmagan — oyna yopiq
  const sent = [];
  const send = async (_t, chan, id, text, opts) => { sent.push({ chan, id, text, opts }); return true; };
  assert.strictEqual(await seqMod.runTenantSequences(t, now + 30 * 60000, { send }), 0, "vaqti kelmagan");
  assert.strictEqual(await seqMod.runTenantSequences(t, now + 61 * 60000, { send }), 1);
  assert.deepStrictEqual(sent.map((s) => `${s.chan}:${s.text}`), ["tg:1-xabar do'stim"]);
  assert.strictEqual(seq.stats.skipped, 1, "IG qadami o'tkazildi");
  assert.strictEqual(seqMod.subscriptionsOf(t, "tg:1001")[0].step, 1);
  // 2-qadam: havola kuzatiladi; keyin ketma-ketlik tugaydi
  await seqMod.runTenantSequences(t, now + (61 + 1441) * 60000, { send });
  assert.match(sent[1].opts[0].url, /\/l\//);
  assert.strictEqual(seqMod.subscriptionsOf(t, "tg:1001").length, 0);
  assert.strictEqual(seq.stats.finished, 2);
  // STOP yozgan — obuna bo'lolmaydi va chiqariladi
  seqMod.subscribe(t, "tg:1003", seq.id, now);
  await processMessage(t, "telegram", "1003", { text: "stop" });
  assert.strictEqual(seqMod.subscriptionsOf(t, "tg:1003").length, 0);
  assert.strictEqual(seqMod.subscribe(t, "tg:1003", seq.id, now), false);
});
