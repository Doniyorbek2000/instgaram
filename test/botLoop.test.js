import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.FREE_MODE = "false";

const { isBotLoop, FAST_MS } = await import("../src/botLoop.js");
const { register } = await import("../src/auth.js");
const { processMessage } = await import("../src/respond.js");
const { isManual } = await import("../src/engagement.js");

const at = (ms) => new Date(ms).toISOString();

test("odam tezligidagi suhbat tsikl emas", () => {
  const now = Date.now();
  const h = [
    { role: "user", text: "narxi?", at: at(now - 120000) },
    { role: "assistant", text: "100 ming", at: at(now - 118000) },
    { role: "user", text: "yetkazasizmi?", at: at(now - 60000) },
    { role: "assistant", text: "ha", at: at(now - 58000) },
  ];
  assert.strictEqual(isBotLoop(h, now), false);
});

test("bot javobidan keyin 3 marta ketma-ket 5 soniya ichida javob — tsikl", () => {
  const now = Date.now();
  const h = [
    { role: "user", text: "Salom! Qanday yordam bera olaman?", at: at(now - 20000) },
    { role: "assistant", text: "Assalomu alaykum!", at: at(now - 18000) },
    { role: "user", text: "Eshitaman!", at: at(now - 17000) },
    { role: "assistant", text: "Savolingiz bormi?", at: at(now - 15000) },
    { role: "user", text: "Qanday yordam kerak?", at: at(now - 14000) },
    { role: "assistant", text: "Rahmat!", at: at(now - 2000) },
  ];
  assert.strictEqual(isBotLoop(h, now), true);
  assert.strictEqual(isBotLoop(h, now + FAST_MS + 1000), false, "joriy xabar sekin kelsa — tsikl emas");
  assert.strictEqual(isBotLoop(h.slice(0, 4).concat(h[5]), now), false, "faqat 2 ta tez javob");
});

test("tsiklda bot jim bo'ladi va suhbat operatorga o'tadi", async () => {
  const { user: t } = await register("loop@x.uz", "parol1234", "Loop");
  const now = Date.now();
  t.chats = {
    "ig:77": [
      { role: "user", text: "Salom", at: at(now - 9000) },
      { role: "assistant", text: "Assalomu alaykum", at: at(now - 8000) },
      { role: "user", text: "Eshitaman", at: at(now - 7000) },
      { role: "assistant", text: "Yordam kerakmi?", at: at(now - 6000) },
      { role: "user", text: "Qanday yordam?", at: at(now - 5000) },
      { role: "assistant", text: "Rahmat", at: at(now - 1000) },
    ],
  };
  const r = await processMessage(t, "instagram", "77", { text: "Arzimaydi! Yana savol bormi?" });
  assert.strictEqual(r.reply, null);
  assert.strictEqual(isManual(t, "ig:77"), true);
  assert.strictEqual(t.chats["ig:77"].at(-1).text, "Arzimaydi! Yana savol bormi?", "xabar inbox'da ko'rinadi");
});
