import test from "node:test";
import assert from "node:assert";
import { rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.BASE_URL = "https://bot.example.uz";
process.env.GEMINI_API_KEY = "";
process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const store = await import("../src/mediaStore.js");
const { buildMediaPayload } = await import("../src/outbound.js");
const flows = await import("../src/flows.js");
const bc = await import("../src/broadcasts.js");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PDF = Buffer.from("%PDF-1.7\n%test");

test("yuklash: tur va 'sehrli baytlar' tekshiriladi, ochiq havola qaytadi, o'chirish faylni ham o'chiradi", async () => {
  const { user: t } = await register("media@x.uz", "parol123", "M");
  const img = store.saveUpload(t, PNG, "image/png", "katalog.png");
  assert.strictEqual(img.type, "image");
  assert.match(img.url, /^https:\/\/bot\.example\.uz\/u\/[a-f0-9]{32}\.png$/);
  assert.ok(existsSync(path.join(store.uploadsDir, img.file)));
  assert.ok(store.saveUpload(t, PNG, "application/pdf", "soxta.pdf").error, "PNG'ni PDF deb yuklab bo'lmaydi");
  assert.ok(store.saveUpload(t, Buffer.from("<script>"), "text/html", "x.html").error, "HTML taqiqlangan");
  assert.strictEqual(store.saveUpload(t, PDF, "application/pdf", "qo'llanma.pdf").type, "file");
  assert.strictEqual(t.mediaLibrary.length, 2);
  assert.ok(store.deleteUpload(t, img.id));
  assert.ok(!existsSync(path.join(store.uploadsDir, img.file)));
});

test("sanitizeMedia: faqat http(s) yoki /u/ havolalar, post ID raqamli", () => {
  assert.strictEqual(store.sanitizeMedia({ type: "image", url: "javascript:alert(1)" }), null);
  assert.strictEqual(store.sanitizeMedia({ type: "exe", url: "https://a.uz/x.exe" }), null);
  assert.deepStrictEqual(store.sanitizeMedia({ type: "file", url: "https://a.uz/x.pdf", name: "X" }), { type: "file", url: "https://a.uz/x.pdf", name: "X" });
  assert.strictEqual(store.sanitizeMedia({ type: "post", postId: "abc" }), null);
  assert.strictEqual(store.sanitizeMedia({ type: "post", postId: "17912345678901234" }).postId, "17912345678901234");
});

test("har bir kanal uchun to'g'ri media so'rovi quriladi", () => {
  const pdf = { type: "file", url: "/u/0123456789abcdef0123456789abcdef.pdf", name: "Qo'llanma.pdf" };
  const ig = buildMediaPayload("ig", "1", pdf);
  assert.deepStrictEqual(ig.body.message.attachment, { type: "file", payload: { url: "https://bot.example.uz/u/0123456789abcdef0123456789abcdef.pdf", is_reusable: true } });
  const wa = buildMediaPayload("wa", "998", pdf, "Mana");
  assert.deepStrictEqual(wa.body.document, { link: "https://bot.example.uz/u/0123456789abcdef0123456789abcdef.pdf", caption: "Mana", filename: "Qo'llanma.pdf" });
  const tg = buildMediaPayload("tg", "55", { type: "image", url: "https://a.uz/p.png" }, "Katalog");
  assert.strictEqual(tg.method, "sendPhoto");
  assert.deepStrictEqual(tg.body, { chat_id: "55", photo: "https://a.uz/p.png", caption: "Katalog" });
  const fb = buildMediaPayload("fb", "7", { type: "video", url: "https://a.uz/v.mp4" });
  assert.strictEqual(fb.body.messaging_type, "RESPONSE");
  const post = buildMediaPayload("ig", "1", { type: "post", postId: "179", permalink: "https://www.instagram.com/p/X/" });
  assert.deepStrictEqual(post.body.message.attachment, { type: "MEDIA_SHARE", payload: { id: "179" } });
  assert.strictEqual(buildMediaPayload("tg", "1", { type: "post", postId: "179", permalink: "https://www.instagram.com/p/X/" }).fallbackText, "https://www.instagram.com/p/X/");
});

test("flow xabari: media avval yuboriladi; komment private reply'da havola matnga qo'shiladi", async () => {
  const { user: t } = await register("fmedia@x.uz", "parol123", "M");
  const flow = flows.sanitizeFlow({ enabled: true, start: "m", nodes: [{ id: "m", type: "message", text: "Mana qo'llanma", media: { type: "file", url: "https://a.uz/g.pdf", name: "Qo'llanma" } }] });
  flows.ensureFlows(t).list.push(flow);

  const sent = [];
  await flows.startFlow(t, "ig:1", flow, { send: async (m) => { sent.push(m); return true; } });
  assert.deepStrictEqual(sent.map((m) => (m.media ? `media:${m.media.url}` : `text:${m.text}`)), ["media:https://a.uz/g.pdf", "text:Mana qo'llanma"]);

  const viaComment = [];
  await flows.startFlow(t, "ig:2", flow, { commentId: "c1", send: async (m) => { viaComment.push(m); return true; } });
  assert.strictEqual(viaComment.length, 1);
  assert.strictEqual(viaComment[0].text, "Mana qo'llanma\n\nhttps://a.uz/g.pdf");
  assert.ok(viaComment[0].viaComment);
});

test("broadcast media + matn yuboradi; faqat media bo'lsa ham ishlaydi", async () => {
  const { user: t } = await register("bmedia@x.uz", "parol123", "M");
  t.chats = { "tg:9": [{ role: "user", text: "x", at: new Date().toISOString() }] };
  const data = bc.sanitizeBroadcast({ name: "Katalog", message: "", media: { type: "image", url: "https://a.uz/k.png", name: "k" } });
  const b = bc.createBroadcast(t, data);
  const media = [];
  const texts = [];
  await bc.runBroadcast(t, b.id, { delayMs: 0, send: async (...a) => { texts.push(a); return true; }, sendMediaFn: async (_t, chan, id, m) => { media.push(`${chan}:${id}:${m.url}`); return true; } });
  assert.deepStrictEqual(media, ["tg:9:https://a.uz/k.png"]);
  assert.strictEqual(texts.length, 0);
  assert.strictEqual(b.sentCount, 1);
});
