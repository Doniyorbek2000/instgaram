import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
delete process.env.ANTHROPIC_API_KEY;
process.env.GEMINI_API_KEY = "";
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const { AI_QUOTA, CREDIT_PACKS, getCreditPacks, consumeAi, aiQuota } = await import("../src/credits.js");
const { creditsFor, ttsCredits, usdCost, recordAiCost, monthCost, netRevenue, toSom } = await import("../src/aiCost.js");
const { generateReply, classifyIntent, buildSystemPrompt } = await import("../src/ai.js");

const { user } = await register("cost@test.uz", "parol123", "Cost Shop");

test("tariflar: zararli kvotalar tuzatilgan", async () => {
  assert.strictEqual(AI_QUOTA.trial, 100);
  assert.strictEqual(AI_QUOTA.business, 6000);
  const packs = await getCreditPacks();
  assert.ok(!packs.some((p) => p.id === "c10000"), "eski 10 000 paket sotuvda yo'q");
  assert.strictEqual(packs.find((p) => p.id === "c8000").credits, 8000);
  assert.strictEqual(CREDIT_PACKS.c10000.credits, 10000, "eski buyurtmalar to'g'ri yakunlanadi");
});

test("kredit token hajmiga qarab: oddiy javob ≈1, video ko'p", () => {
  assert.ok(creditsFor(3300, 150) <= 1, "odatiy javob 1 kreditdan oshmaydi");
  assert.ok(creditsFor(35000, 300) > 5, "video + katta baza ko'p kredit");
  assert.ok(creditsFor(600, 2) < 0.2, "qoida tanlash — kasr kredit");
  assert.ok(ttsCredits(600) > 1);
  assert.ok(usdCost("gemini-3.6-flash", 1e6, 0) > usdCost("gemini-3.5-flash-lite", 1e6, 0));
  assert.ok(usdCost("claude-3-5-sonnet", 1e6, 0) >= 3);
});

test("kasr kreditlar yig'ilib yechiladi", () => {
  const before = aiQuota(user).used;
  for (let i = 0; i < 9; i++) consumeAi(user, 0.1);
  assert.strictEqual(aiQuota(user).used, before, "0.9 — hali butun emas");
  consumeAi(user, 0.1);
  assert.strictEqual(aiQuota(user).used, before + 1);
  assert.ok(Math.abs(monthCost(user).credits - 1) < 1e-9);
});

test("xarajat yoziladi; o'z kaliti platformaga xarajatsiz", () => {
  const t = { id: "x", aiUsage: {} };
  const usd = recordAiCost(t, { kind: "reply", model: "gemini-3.5-flash-lite", inTok: 3300, outTok: 150 });
  assert.ok(usd > 0.001 && usd < 0.002);
  recordAiCost(t, { kind: "reply", model: "gemini-3.5-flash-lite", inTok: 3300, outTok: 150, ownKey: true });
  recordAiCost(t, { kind: "tts", ttsChars: 600 });
  const c = monthCost(t);
  assert.strictEqual(c.calls, 3);
  assert.strictEqual(c.own, 1);
  assert.ok(c.kinds.tts.usd > 0);
  assert.ok(toSom(usd) > 10 && toSom(usd) < 30);
  assert.ok(Math.abs(netRevenue(112000) - (100000 - 2240)) < 1);
});

test("matnsiz (media) xabarda butun baza emas, ko'pi bilan ~6000 belgi yuboriladi", () => {
  const big = Array.from({ length: 200 }, (_, i) => `Bo'lim ${i}: ${"mahsulot haqida ma'lumot ".repeat(10)}`).join("\n");
  const sp = buildSystemPrompt({ businessName: "X", businessInfo: big, settings: {} }, "", true);
  assert.ok(big.length > 40000);
  assert.ok(sp.length < 6000 + 6000, `prompt ${sp.length}`);
});

function mockGemini(inTok, outTok, text = "Salom! Narxi 100 000 so'm.") {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("generativelanguage")) return real(url);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok } }), { status: 200 });
  };
  return () => { globalThis.fetch = real; };
}

test("AI javob: oddiy — 1 kredit, og'ir video — ko'p kredit, xarajat yoziladi", async () => {
  user.geminiApiKey = "test-key-own"; // tarmoqqa chiqmaydi (mock)
  let restore = mockGemini(3000, 120);
  const before = aiQuota(user).used;
  try {
    await generateReply(user, "ig:1", { text: "narxi qancha?" });
  } finally { restore(); }
  assert.strictEqual(aiQuota(user).used, before + 1);
  restore = mockGemini(40000, 200);
  try {
    await generateReply(user, "ig:2", { text: "", media: [{ mimeType: "video/mp4", data: "AAAA" }] });
  } finally { restore(); }
  assert.ok(aiQuota(user).used >= before + 1 + 6, `used ${aiQuota(user).used}`);
  const c = monthCost(user);
  assert.ok(c.kinds.reply.calls >= 2);
  assert.strictEqual(c.own, 2, "o'z kaliti bilan — platforma to'lamaydi");
  assert.strictEqual(c.usd, 0);
});

test("AI qoida tanlash ham hisobga olinadi (kasr)", async () => {
  const restore = mockGemini(500, 1, "1");
  try {
    const r = await classifyIntent(user, "narx qancha", [{ name: "narx so'rash" }, { name: "manzil" }]);
    assert.strictEqual(r.name, "narx so'rash");
  } finally { restore(); }
  assert.strictEqual(monthCost(user).kinds.classify.calls, 1);
  assert.ok(monthCost(user).credits % 1 !== 0, "kasr kredit yig'ilyapti");
});
