import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import express from "express";
import { buildPhonePrompt } from "../src/ai.js";
import { recordCall, zadarmaHookRouter } from "../src/web/phone_ui.js";
import { register } from "../src/auth.js";
import { listUsers, persist } from "../src/db.js";

test("telefon ko'rsatmasi: to'liq baza, halollik va sotuv qoidalari, og'zaki uslub", () => {
  const prompt = buildPhonePrompt({ businessName: "Guli Store", businessInfo: "Ko'ylak — 150 000 so'm", settings: { aiStyle: "Doim 'siz' deb" } });
  assert.match(prompt, /Guli Store/);
  assert.match(prompt, /Ko'ylak — 150 000 so'm/);
  assert.match(prompt, /ENG MUHIM VA QAT'IY QOIDA/);
  assert.match(prompt, /SOTUV MAHORATI/);
  assert.match(prompt, /OG'ZAKI USLUB/);
  assert.match(prompt, /BIZNES USLUBI.*Doim 'siz' deb/);
});

test("qo'ng'iroq jurnali: faqat NOTIFY_END, raqam tozalanadi, takror yozilmaydi", () => {
  const u = { settings: {} };
  assert.strictEqual(recordCall(u, { event: "NOTIFY_START", caller_id: "+998901234567" }), null);
  const call = recordCall(u, { event: "NOTIFY_END", pbx_call_id: "in_1", caller_id: "+998 (90) 123-45-67<b>", duration: "75", disposition: "answered", is_recorded: "1" });
  assert.deepStrictEqual({ phone: call.phone, duration: call.duration, recorded: call.recorded }, { phone: "+998901234567", duration: 75, recorded: true });
  assert.strictEqual(recordCall(u, { event: "NOTIFY_END", pbx_call_id: "in_1", caller_id: "1" }), null, "Zadarma qayta yuborsa");
  assert.strictEqual(u.phone.calls.length, 1);
});

test("/zadarma/hook: noto'g'ri token — 404, zd_echo qaytariladi, NOTIFY_END yoziladi", async () => {
  const { user } = await register("phone@test.uz", "parol123", "Phone Shop");
  user.phone = { hookToken: "a".repeat(32) };
  await persist(user);

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(zadarmaHookRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/zadarma/hook`;
  try {
    assert.strictEqual((await fetch(`${base}/${"b".repeat(32)}?zd_echo=x`)).status, 404);
    const echo = await fetch(`${base}/${"a".repeat(32)}?zd_echo=abc123<script>`);
    assert.strictEqual(await echo.text(), "abc123script");

    const r = await fetch(`${base}/${"a".repeat(32)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ event: "NOTIFY_END", pbx_call_id: "in_9", caller_id: "998901112233", duration: "30", disposition: "answered" }),
    });
    assert.strictEqual(r.status, 200);
    const saved = (await listUsers()).find((u) => u.email === "phone@test.uz");
    assert.strictEqual(saved.phone.calls[0].phone, "998901112233");
  } finally {
    server.close();
  }
});
