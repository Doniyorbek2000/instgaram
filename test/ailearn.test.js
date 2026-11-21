import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import { draftToKnowledge } from "../src/web/ai_learn_ui.js";
import { buildSystemPrompt } from "../src/ai.js";

test("AI tahlil natijasi o'qiladigan bilim bazasi matniga aylanadi", () => {
  const kb = draftToKnowledge({
    summary: "Toshkentdagi kiyim do'koni.",
    products: [{ name: "Kurtka", price: "450 000 so'm", details: "S-XXL" }, { name: "" }],
    contacts: { address: "Chilonzor 5", hours: "09:00-21:00" },
    faq: [{ q: "Yetkazib berasizmi?", a: "Ha, Toshkent bo'ylab" }],
  });
  assert.match(kb, /📌 BIZNES HAQIDA:\nToshkentdagi kiyim do'koni\./);
  assert.match(kb, /- Kurtka — 450 000 so'm: S-XXL/);
  assert.match(kb, /📍 Manzil: Chilonzor 5/);
  assert.match(kb, /S: Yetkazib berasizmi\?\nJ: Ha, Toshkent bo'ylab/);
  assert.doesNotMatch(kb, /Telefon/);
});

test("biznes uslubi AI tizim ko'rsatmasiga qo'shiladi", () => {
  const withStyle = buildSystemPrompt({ businessName: "X", businessInfo: "", settings: { aiStyle: "Doim 'siz' deb, 1 emoji" } }, "", true);
  assert.match(withStyle, /BIZNES USLUBI.*Doim 'siz' deb, 1 emoji/);
  assert.doesNotMatch(buildSystemPrompt({ businessName: "X", businessInfo: "", settings: {} }, "", true), /BIZNES USLUBI/);
});

test("/ai-learn/polish: erkin matnni AI orqali tartiblaydi, bo'sh matnni rad etadi", async () => {
  const express = (await import("express")).default;
  const { aiLearnRouter } = await import("../src/web/ai_learn_ui.js");
  const { register } = await import("../src/auth.js");
  const { user } = await register("polish@test.uz", "parol123", "Polish Shop");
  user.geminiApiKey = "test-key-own"; // tarmoqqa chiqmaydi (mock)

  const real = globalThis.fetch;
  let sentPrompt = "";
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes("generativelanguage")) return real(url, opts);
    sentPrompt = JSON.parse(opts.body).contents.at(-1).parts[0].text;
    const text = "```\n📌 BIZNES HAQIDA:\n- 10 kVت: 45 000 000 so'm\n```";
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }), { status: 200 });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(aiLearnRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => real(`${base}/ai-learn/polish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    const empty = await post({ text: "  " });
    assert.strictEqual(empty.status, 400);

    const ok = await post({ text: "narxi 45 mln" });
    assert.strictEqual(ok.ok, true);
    assert.match(sentPrompt, /narxi 45 mln/);
    assert.strictEqual(ok.text, "📌 BIZNES HAQIDA:\n- 10 kV: 45 000 000 so'm", "kod bloki va arab harfisiz");
  } finally {
    globalThis.fetch = real;
    server.close();
  }
});

test("/ai-learn/transcribe: ovozni Gemini'ga yuborib matn qaytaradi, ovozsiz so'rovni rad etadi", async () => {
  const express = (await import("express")).default;
  const { aiLearnRouter } = await import("../src/web/ai_learn_ui.js");
  const { register } = await import("../src/auth.js");
  const { user } = await register("voice@test.uz", "parol123", "Voice Shop");
  user.geminiApiKey = "test-key-own";

  const real = globalThis.fetch;
  let sentPart = null;
  globalThis.fetch = async (url, opts) => {
    if (!String(url).includes("generativelanguage")) return real(url, opts);
    sentPart = JSON.parse(opts.body).contents.at(-1).parts[0];
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: " narxi 45 mln " }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(aiLearnRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (type, body) => real(`${base}/ai-learn/transcribe`, { method: "POST", headers: { "Content-Type": type }, body }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    assert.strictEqual((await post("text/plain", "salom")).status, 400);
    assert.strictEqual((await post("audio/webm", new Uint8Array(0))).status, 400);

    const ok = await post("audio/webm;codecs=opus", new Uint8Array([1, 2, 3]));
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.text, "narxi 45 mln");
    assert.deepStrictEqual(sentPart.inline_data, { mime_type: "audio/webm", data: Buffer.from([1, 2, 3]).toString("base64") });
  } finally {
    globalThis.fetch = real;
    server.close();
  }
});
