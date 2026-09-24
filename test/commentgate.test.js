/**
 * Komment "+" → Direct → obuna tekshiruvi → material: to'liq zanjir,
 * Meta Graph API fetch orqali taqlid qilinadi.
 */
import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });
process.env.GEMINI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";

const { register } = await import("../src/auth.js");
const { ensureFlows, findFlow } = await import("../src/flows.js");
const { buildTemplate } = await import("../src/flowTemplates.js");
const { handleInstagramEntry } = await import("../src/handlers/instagram.js");
const { FOLLOW_RECHECK_MS } = await import("../src/services/instagram.js");
const { ensureRules } = await import("../src/rules.js");
const { getContactMeta } = await import("../src/contacts.js");
FOLLOW_RECHECK_MS.value = 0;

// ---- Meta API taqlidi ----
const meta = { follows: {}, consent: {}, rejectQuickRepliesInPrivate: false };
let calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ method: opts.method || "GET", path: u.pathname, body });
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
  if (!opts.method || opts.method === "GET") {
    const id = u.pathname.split("/").pop();
    // Meta profilni mijoz Direct'da javob bermaguncha bermaydi
    if (!meta.consent[id]) return json(400, { error: { message: "User consent is required", code: 230 } });
    return json(200, { id, username: id, name: "Aziza", is_user_follow_business: Boolean(meta.follows[id]) });
  }
  if (body?.recipient?.comment_id && body.message?.quick_replies && meta.rejectQuickRepliesInPrivate) {
    return json(400, { error: { message: "quick_replies not supported" } });
  }
  return json(200, { id: "ok", message_id: "mid.ok", recipient_id: body?.recipient?.id || "" });
};

const posts = () => calls.filter((c) => c.method === "POST");
const sentTexts = () => posts().filter((c) => c.path.endsWith("/messages")).map((c) => c.body);

const { user: tenant } = await register("gate@test.uz", "parol123", "Guli Shop");
tenant.meta = { ...(tenant.meta || {}), igUserId: "biz1", igAccessToken: "tok", igUsername: "guli_shop" };
tenant.rules = [];
const flow = buildTemplate("plus_gate");
flow.enabled = true;
ensureFlows(tenant).list.push(flow);

let seq = 0;
const comment = (from, text) =>
  handleInstagramEntry(tenant, { id: "biz1", changes: [{ field: "comments", value: { id: `c${++seq}`, text, from: { id: from, username: from }, media: { id: "post1" } } }] });
const tap = (from, payload, text = "") =>
  handleInstagramEntry(tenant, { id: "biz1", messaging: [{ sender: { id: from }, recipient: { id: "biz1" }, message: { mid: `m${++seq}`, text, quick_reply: { payload } } }] });
const type = (from, text) =>
  handleInstagramEntry(tenant, { id: "biz1", messaging: [{ sender: { id: from }, recipient: { id: "biz1" }, message: { mid: `m${++seq}`, text } }] });

test("\"+\" komment: ochiq javob + Direct'da salom va tekshirish tugmasi", async () => {
  calls = [];
  await comment("u1", "+");
  const reply = posts().find((c) => c.path.endsWith("/replies"));
  assert.ok(reply, "kommentga ochiq javob yozildi");
  assert.match(reply.body.message, /Direct/);
  const dm = sentTexts().find((b) => b.recipient.comment_id);
  assert.ok(dm, "private reply yuborildi");
  assert.match(dm.message.text, /Assalomu alaykum, @u1!/);
  assert.match(dm.message.text, /obuna bo'lganingizni tekshiraman/);
  assert.strictEqual(dm.message.quick_replies[0].title, "Tekshirish ✅");
  assert.match(dm.message.quick_replies[0].payload, /^FLOW:/);
  assert.strictEqual(sentTexts().length, 1, "boshqa xabar ketmadi");
});

test("obuna bo'lmagan: obuna bo'lishni so'raydi, profil havolasi va tugma bilan", async () => {
  calls = [];
  meta.consent.u1 = true; // mijoz tugmani bosdi — suhbat ochildi
  const payload = `FLOW:${flow.id}:c1`;
  await tap("u1", payload, "Tekshirish ✅");
  const msg = sentTexts().pop();
  assert.strictEqual(msg.recipient.id, "u1");
  assert.match(msg.message.text, /hali sahifamizga obuna bo'lmagansiz/);
  assert.match(msg.message.text, /instagram\.com\/guli_shop/);
  assert.strictEqual(msg.message.quick_replies[0].title, "Obuna bo'ldim ✅");
  assert.ok(!getContactMeta(tenant, "ig:u1").tags?.includes("obunachi"));
});

test("obuna bo'lgach \"Obuna bo'ldim\" → qayta tekshiradi va materialni yuboradi", async () => {
  calls = [];
  meta.follows.u1 = true;
  await tap("u1", `FLOW:${flow.id}:c1`, "Obuna bo'ldim ✅");
  const all = JSON.stringify(sentTexts());
  assert.match(all, /obunangiz tasdiqlandi/);
  assert.match(all, /example\.uz\/material/);
  assert.ok(getContactMeta(tenant, "ig:u1").tags.includes("obunachi"));
  assert.strictEqual(findFlow(tenant, flow.id).stats.conversions, 1);
});

test("tugma o'rniga qo'lda \"obuna boldim\" yozsa ham ishlaydi", async () => {
  meta.consent.u2 = true;
  await comment("u2", "+ menga ham");
  await tap("u2", `FLOW:${flow.id}:c1`, "Tekshirish ✅"); // obuna emas → "Obuna bo'ldim" tugmasi
  meta.follows.u2 = true;
  calls = [];
  await type("u2", "obuna boldim");
  assert.match(JSON.stringify(sentTexts()), /obunangiz tasdiqlandi/);
});

test("Meta private reply'da tugmani qabul qilmasa — raqamli variant, \"1\" yozsa davom etadi", async () => {
  meta.rejectQuickRepliesInPrivate = true;
  calls = [];
  await comment("u3", "+");
  const dm = sentTexts().filter((b) => b.recipient.comment_id).pop();
  assert.ok(!dm.message.quick_replies);
  assert.match(dm.message.text, /1\. Tekshirish ✅/);
  meta.rejectQuickRepliesInPrivate = false;
  meta.consent.u3 = true;
  meta.follows.u3 = true;
  calls = [];
  await type("u3", "1");
  assert.match(JSON.stringify(sentTexts()), /obunangiz tasdiqlandi/);
});

test("\"+\"siz komment flow'ni ishga tushirmaydi", async () => {
  calls = [];
  await comment("u4", "zo'r post");
  assert.ok(!sentTexts().some((b) => b.recipient.comment_id && /tekshiraman/.test(b.message.text)));
});

test("Tezkor qoida (obuna shart): bitta tugmali private reply, bosilganda tekshiradi", async () => {
  ensureFlows(tenant).list = [];
  ensureRules(tenant).push({
    id: "r1", type: "comment_to_dm", enabled: true, keyword: "kurs", matchType: "contains",
    requireFollow: true, privateReply: "Mana kurs havolasi: https://example.uz/kurs",
    notFollowingMessage: "Salom {name|do'stim}! Kursni olish uchun obuna bo'ling va tugmani bosing 👇", notFollowingButton: "Obuna bo'ldim ✅",
    publicReplies: ["Direct'ga yubordim"],
  });
  calls = [];
  await comment("u5", "kurs");
  const dms = sentTexts();
  assert.strictEqual(dms.length, 1, "faqat bitta xabar (private reply)");
  assert.ok(dms[0].recipient.comment_id);
  assert.match(dms[0].message.text, /Salom @u5!/);
  assert.strictEqual(dms[0].message.quick_replies[0].payload, "CHECK_FOLLOW:r1");

  meta.consent.u5 = true;
  calls = [];
  await tap("u5", "CHECK_FOLLOW:r1", "Obuna bo'ldim ✅");
  assert.match(JSON.stringify(sentTexts()), /hali sahifamizga obuna bo'lmabsiz[\s\S]*instagram\.com\/guli_shop/);

  meta.follows.u5 = true;
  calls = [];
  await tap("u5", "CHECK_FOLLOW:r1", "Obuna bo'ldim ✅");
  assert.match(JSON.stringify(sentTexts()), /example\.uz\/kurs/);

  // Obunachi komment yozsa — tekshiruvsiz darhol material
  calls = [];
  await comment("u5", "kurs");
  const direct = sentTexts().find((b) => b.recipient.comment_id);
  assert.match(direct.message.text, /example\.uz\/kurs/);
});
