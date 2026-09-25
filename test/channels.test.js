import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

const { splitText, clipText, clipBytes, buildWhatsAppInteractive, TEXT_LIMITS } = await import("../src/outbound.js");
const { parseWhatsAppMessage } = await import("../src/handlers/whatsapp.js");
const { telegramMessageText } = await import("../src/telegram.js");

test("uzun matn kanal limitidan oshmaydigan bo'laklarga, so'z o'rtasidan kesilmasdan bo'linadi", () => {
  const para = "Bu mahsulot haqida batafsil ma'lumot. ".repeat(40); // ~1500 belgi
  const parts = splitText(`${para}\n\n${para}`, TEXT_LIMITS.ig);
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.length <= TEXT_LIMITS.ig, `${p.length} > limit`);
  assert.strictEqual(parts.join(" ").replace(/\s+/g, " "), `${para} ${para}`.trim().replace(/\s+/g, " "));
  assert.deepStrictEqual(splitText("qisqa", 1000), ["qisqa"]);
  assert.deepStrictEqual(splitText("", 1000), []);
  assert.ok(clipText("a ".repeat(800), 1000).length <= 1000);
});

test("Telegram callback_data 64 BAYTdan oshmaydi (kirill/emoji bilan ham)", () => {
  const v = clipBytes("ТОВАР:".repeat(20) + "😀", 64);
  assert.ok(Buffer.byteLength(v, "utf8") <= 64);
  assert.strictEqual(clipBytes("SHOP:1", 64), "SHOP:1");
});

test("WhatsApp: 1–3 variant — tugmalar, 4–10 — ro'yxat, havola yoki 10+ — matn", () => {
  const opt = (n) => Array.from({ length: n }, (_, i) => ({ title: `Variant ${i + 1}`, payload: `P${i + 1}` }));
  const b = buildWhatsAppInteractive("Tanlang", opt(3));
  assert.strictEqual(b.type, "button");
  assert.deepStrictEqual(b.action.buttons[0], { type: "reply", reply: { id: "P1", title: "Variant 1" } });
  const l = buildWhatsAppInteractive("Tanlang", opt(7));
  assert.strictEqual(l.type, "list");
  assert.strictEqual(l.action.sections[0].rows.length, 7);
  assert.strictEqual(buildWhatsAppInteractive("x", opt(11)), null);
  assert.strictEqual(buildWhatsAppInteractive("x", [{ title: "Sayt", url: "https://a.uz" }]), null);
  assert.strictEqual(buildWhatsAppInteractive("x", [{ title: "A", payload: "S" }, { title: "B", payload: "S" }]), null, "takroriy id");
});

test("WhatsApp kiruvchi: tugma/ro'yxat javobi payload bo'ladi, lokatsiya va kontakt matnga aylanadi", () => {
  assert.deepStrictEqual(parseWhatsAppMessage({ type: "text", text: { body: "salom" } }), { text: "salom", payload: "", mediaId: "" });
  assert.deepStrictEqual(
    parseWhatsAppMessage({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "SHOP:cat", title: "Katalog" } } }),
    { text: "Katalog", payload: "SHOP:cat", mediaId: "" }
  );
  assert.strictEqual(parseWhatsAppMessage({ type: "interactive", interactive: { list_reply: { id: "P5", title: "5" } } }).payload, "P5");
  assert.strictEqual(parseWhatsAppMessage({ type: "button", button: { text: "Ha", payload: "YES" } }).payload, "YES");
  assert.match(parseWhatsAppMessage({ type: "location", location: { latitude: 41.3, longitude: 69.2, name: "Ofis" } }).text, /Ofis[\s\S]*41\.3,69\.2/);
  assert.match(parseWhatsAppMessage({ type: "contacts", contacts: [{ name: { formatted_name: "Ali" }, phones: [{ phone: "+998901234567" }] }] }).text, /Ali \+998901234567/);
  assert.strictEqual(parseWhatsAppMessage({ type: "image", image: { id: "M1", caption: "shu" } }).mediaId, "M1");
  assert.strictEqual(parseWhatsAppMessage({ type: "reaction", reaction: {} }), null);
  assert.strictEqual(parseWhatsAppMessage({ type: "sticker", sticker: { id: "S" } }), null);
});

test("Telegram: kontakt va lokatsiya matnga aylanadi", () => {
  assert.strictEqual(telegramMessageText({ text: "salom" }), "salom");
  assert.match(telegramMessageText({ contact: { first_name: "Vali", phone_number: "998901112233" } }), /Vali 998901112233/);
  assert.match(telegramMessageText({ location: { latitude: 40.1, longitude: 71.7 } }), /40\.1,71\.7/);
  assert.strictEqual(telegramMessageText({ sticker: {} }), "");
});
