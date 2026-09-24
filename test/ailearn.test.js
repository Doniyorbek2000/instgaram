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
