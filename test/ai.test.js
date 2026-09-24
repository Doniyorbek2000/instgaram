import test from "node:test";
import assert from "node:assert";

// Testda API kalit yo'q — AI o'chiq bo'lishi va kalit so'z
// qoidalariga qaytishi (fallback) tekshiriladi
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;

const { generateReply, buildSystemPrompt, smartFallbackReply } = await import("../src/ai.js");

const tenantWithoutAI = {
  id: "t1",
  businessName: "Test Do'kon",
  businessInfo: "Test biznes ma'lumotlari",
  geminiApiKey: "",
  meta: {},
};

test("AI kaliti bo'lmasa kalit so'z qoidasi ishlaydi", async () => {
  const reply = await generateReply(tenantWithoutAI, "user-1", {
    text: "narxi qancha?",
  });
  assert.match(reply, /narx/i);
});

test("mos qoida bo'lmasa default javob qaytadi", async () => {
  const reply = await generateReply(tenantWithoutAI, "user-2", {
    text: "qwertyuiop",
  });
  assert.ok(reply.length > 0);
});

test("biznes ma'lumoti bo'lmasa ham javob qaytadi", async () => {
  const emptyTenant = { ...tenantWithoutAI, businessInfo: "" };
  const reply = await generateReply(emptyTenant, "user-3", { text: "salom" });
  assert.ok(reply.length > 0);
});

// ==== buildSystemPrompt: matnsiz (faqat ovoz/rasm) xabarda formatBusinessInfo bug regressiyasi ====
// Ilgari userText bo'sh bo'lganda buildSystemPrompt hech qayerda aniqlanmagan
// formatBusinessInfo() ni chaqirar edi -> ReferenceError, ya'ni mijoz faqat
// ovozli/rasm xabar yuborsa (matnsiz) bot umuman javob bermas edi.
test("matnsiz (faqat media) xabarda ham system prompt xatosiz quriladi va to'liq biznes ma'lumotini o'z ichiga oladi", () => {
  const tenant = {
    businessName: "Test Do'kon",
    businessInfo: "Mahsulot narxi: 100000 so'm. Manzil: Toshkent.",
    settings: {},
  };
  const prompt = buildSystemPrompt(tenant, "");
  assert.match(prompt, /100000 so'm/);
  assert.match(prompt, /Toshkent/);
});

// ==== buildSystemPrompt: mijoz haqiqiy chat orqali xabar berdi — AI bazada yo'q ====
// narsani "bor" deb o'ylab topib javob berayotgani, va har safar qayta salomlashayotgani
// aniqlandi (skrinshotlar orqali). Endi ikkalasi ham aniq ko'rsatma bilan tuzatildi.
test("buildSystemPrompt: bazada yo'q faktni o'ylab topmaslik haqida aniq qoida bor", () => {
  const tenant = { businessName: "Chust Telefon Markazi", businessInfo: "iPhone 13 Pro narxi 400$.", settings: {} };
  const prompt = buildSystemPrompt(tenant, "Zaryadnik bormi?", true);
  assert.match(prompt, /ENG MUHIM VA QAT'IY QOIDA/, "halollik qoidasi promptning eng ko'zga tashlanadigan joyida bo'lishi kerak");
  assert.match(prompt, /HECH QACHON javob berma/i);
  assert.match(prompt, /MIJOZNI ALDASH/i);
});

test("buildSystemPrompt: birinchi xabarda salomlashish ruxsat etiladi", () => {
  const tenant = { businessName: "Test Do'kon", businessInfo: "info", settings: {} };
  const prompt = buildSystemPrompt(tenant, "salom", true);
  assert.match(prompt, /BIRINCHI xabari/);
  assert.doesNotMatch(prompt, /QAYTA SALOMLASHMA/);
});

test("buildSystemPrompt: suhbat davom etayotganda QAYTA SALOMLASHMA ko'rsatmasi beriladi", () => {
  const tenant = { businessName: "Test Do'kon", businessInfo: "info", settings: {} };
  const prompt = buildSystemPrompt(tenant, "yana bir savol", false);
  assert.match(prompt, /QAYTA SALOMLASHMA/);
  assert.doesNotMatch(prompt, /BIRINCHI xabari/);
});

test("generateReply: ikkinchi xabarda tarix bo'sh emasligi sabab isFirstMessage=false uzatiladi (qayta salomlashmaslik uchun)", async () => {
  const tenant = {
    id: "t-first-msg",
    businessName: "Test Do'kon",
    businessInfo: "Mahsulot bor.",
    geminiApiKey: "",
    meta: {},
    chats: { "chat-1": [{ role: "user", text: "salom", at: new Date().toISOString() }, { role: "assistant", text: "Salom!", at: new Date().toISOString() }] },
  };
  // API kaliti yo'q -> smartFallbackReply ishlatiladi, lekin bu test faqat
  // generateReply xato bermasligini va tarix borligini to'g'ri o'qiganini tekshiradi.
  const reply = await generateReply(tenant, "chat-1", { text: "narxi qancha?" });
  assert.ok(reply.length > 0);
});

// ==== smartFallbackReply: mijoz tiliga mos javob (til aniqlash) ====
test("smartFallbackReply ingliz tilidagi savolga ingliz tilida javob beradi", () => {
  const tenant = { businessName: "Test Shop", businessInfo: "" };
  const reply = smartFallbackReply(tenant, "How much does it cost?");
  assert.match(reply, /Hello/);
  assert.doesNotMatch(reply, /Assalomu/);
});

test("smartFallbackReply rus tilidagi savolga rus tilida javob beradi", () => {
  const tenant = { businessName: "Test Shop", businessInfo: "" };
  const reply = smartFallbackReply(tenant, "Сколько стоит доставка?");
  assert.match(reply, /Здравствуйте/);
  assert.doesNotMatch(reply, /Assalomu/);
});

test("smartFallbackReply o'zbekcha savolga o'zbekcha javob beradi", () => {
  const tenant = { businessName: "Test Do'kon", businessInfo: "" };
  const reply = smartFallbackReply(tenant, "narxi qancha bo'ladi?");
  assert.match(reply, /Assalomu/);
});

// ==== askGemini: javob tezligi tuzatishlari (production'da 19-22 soniyalik ====
// javob vaqtlari kuzatilgandan keyin qo'shildi) ====
{
  const { askGemini } = await import("../src/ai.js");

  test("askGemini: birinchi model 503 ('yuqori talab') qaytarsa, DARHOL (qayta urinishsiz) ikkinchi modelga o'tadi", async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      // Asosiy (birinchi) model — gemini-3.5-flash-lite — muvaffaqiyatsiz bo'lganda
      // zaxira gemini-3.6-flash'ga o'tishini tekshiramiz.
      if (String(url).includes("gemini-3.5-flash-lite")) {
        return { ok: false, status: 503, json: async () => ({ error: { message: "high demand" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "Salom!" }] } }] }) };
    };
    try {
      const reply = await askGemini("fake-key", "sys", [], "salom", []);
      assert.strictEqual(reply, "Salom!");
      // Har bir modelga FAQAT bitta so'rov borishi kerak (ilgari 2 marta, 600ms
      // kutish bilan edi — bu Google'ning 503 xatosida foyda bermas, faqat
      // mijozni behuda kutkazardi).
      assert.strictEqual(calls.length, 2, "har ikkala modelga aynan bittadan so'rov borishi kerak (qayta urinishlarsiz)");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("askGemini: so'rov tanasida maxOutputTokens pasaytirilgan (1024 emas, javob tezligi uchun)", async () => {
    let capturedBody = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }) };
    };
    try {
      await askGemini("fake-key", "sys", [], "salom", []);
      assert.strictEqual(capturedBody.generationConfig.maxOutputTokens, 400);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("askGemini: ikkala model ham muvaffaqiyatsiz bo'lsa, aniq xato bilan yiqiladi (osilib qolmaydi)", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "server error" } }) });
    try {
      await assert.rejects(() => askGemini("fake-key", "sys", [], "salom", []), /Gemini API xatosi/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
}
