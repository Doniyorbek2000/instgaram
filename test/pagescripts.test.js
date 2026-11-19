import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import express from "express";

process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

// Sahifa HTML'i server tomonda template literal ichida yoziladi: u yerda "\n" kabi
// escape'lar brauzerga haqiqiy qator ko'chishi bo'lib boradi va butun <script> blokini
// SyntaxError bilan o'ldiradi (sahifadagi barcha tugmalar jimgina ishlamay qoladi).
const { register } = await import("../src/auth.js");
const { web } = await import("../src/web/routes.js");
const { aiSettingsRouter } = await import("../src/web/ai_settings_ui.js");

const { user } = await register("scripts@test.uz", "parol123", "Skript Test");
user.businessInfo = "Narx: 100 000 so'm\nManzil: Chust";

const app = express();
app.use((req, _res, next) => { req.user = user; next(); });
app.use(web);
app.use(aiSettingsRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

function inlineScripts(html) {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs = ""]) => !/\bsrc=|application\/json/i.test(attrs))
    .map(([, , body]) => body);
}

for (const path of ["/dashboard", "/account", "/billing", "/ai-settings"]) {
  test(`${path}: barcha inline skriptlar xatosiz parse bo'ladi`, async () => {
    const res = await fetch(base + path, { redirect: "manual" });
    assert.strictEqual(res.status, 200);
    const scripts = inlineScripts(await res.text());
    scripts.forEach((code, i) => {
      assert.doesNotThrow(() => new vm.Script(code), `${path} skript #${i + 1}`);
    });
  });
}
