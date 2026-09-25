import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

process.env.FREE_MODE = "false";

const { register } = await import("../src/auth.js");
const { findUserByPlatformId, updateUser, createSession, getSessionUser, deleteSession } = await import("../src/db.js");
const { hashSessionToken } = await import("../src/pgdb.js");
const box = await import("../src/secretBox.js");
const { TRIAL_DAYS } = await import("../src/trial.js");

test("mos kelmagan Instagram ID boshqa biznesga yo'naltirilmaydi", async () => {
  const { user: a } = await register("a@sec.uz", "parol1234", "A");
  await updateUser(a.id, { meta: { igUserId: "1784100000000001", igAccessToken: "TOKEN_A" } });
  assert.strictEqual((await findUserByPlatformId("ig", "1784100000000001"))?.id, a.id);
  assert.strictEqual(await findUserByPlatformId("ig", "1784199999999999"), null, "tokeni bor 'birinchi biznes'ga ketmasligi kerak");
  assert.strictEqual(await findUserByPlatformId("ig", ""), null);
});

test("sessiya tokeni bazada ochiq saqlanmaydi", async () => {
  const { user } = await register("s@sec.uz", "parol1234", "S");
  const token = await createSession(user.id);
  await new Promise((r) => setTimeout(r, 150)); // db.json diskka yozilsin
  const raw = readFileSync(`${process.env.DATA_DIR}/db.json`, "utf8");
  assert.ok(!raw.includes(token), "ochiq token faylda bo'lmasin");
  assert.ok(raw.includes(hashSessionToken(token)));
  assert.strictEqual((await getSessionUser(token))?.id, user.id);
  await deleteSession(token);
  assert.strictEqual(await getSessionUser(token), null);
});

test("shifrlash: qiymat va maxfiy maydonlar", () => {
  box.setEncryptionKey("test-kalit-123");
  const sealed = box.encrypt("EAAB-secret");
  assert.match(sealed, /^enc:v1:/);
  assert.notStrictEqual(box.encrypt("EAAB-secret"), sealed, "har safar yangi IV");
  assert.strictEqual(box.decrypt(sealed), "EAAB-secret");
  assert.strictEqual(box.decrypt("eski-ochiq-token"), "eski-ochiq-token", "eski qiymatlar o'qiladi");

  const meta = { igUserId: "1", igAccessToken: "IG", pageAccessToken: "", note: "x" };
  const col = box.sealColumn("meta", meta);
  assert.match(col.igAccessToken, /^enc:v1:/);
  assert.strictEqual(col.igUserId, "1");
  assert.strictEqual(col.pageAccessToken, "", "bo'sh qiymat shifrlanmaydi");
  assert.strictEqual(meta.igAccessToken, "IG", "asl obyekt o'zgarmaydi");
  assert.deepStrictEqual(box.openColumn("meta", col), meta);

  const shop = { settings: { payme: { key: "PK" }, click: { secretKey: "CK" } } };
  assert.deepStrictEqual(box.openColumn("shop", box.sealColumn("shop", shop)), shop);

  const file = box.encryptBuffer(Buffer.from("zaxira"));
  assert.ok(box.isEncryptedBuffer(file));
  assert.strictEqual(box.decryptBuffer(file).toString(), "zaxira");

  box.setEncryptionKey("boshqa-kalit");
  assert.strictEqual(box.decrypt(sealed), "", "noto'g'ri kalit bilan ochilmaydi");
  box.setEncryptionKey("");
});

test("bepul sinov muddati hamma joyda bir xil", async () => {
  const { user } = await register("t@sec.uz", "parol1234", "T");
  const days = (Date.parse(user.subscription.trialEndsAt) - Date.now()) / 86400000;
  assert.ok(Math.abs(days - TRIAL_DAYS) < 0.01);
  const i18n = readFileSync(new URL("../src/web/i18n.js", import.meta.url), "utf8");
  const mentioned = [...i18n.matchAll(/(\d+)[ -](?:kun|kunlik|дня|дней|day|days)\b[^"\n]{0,12}(?:bepul|бесплат|free)/gi)].map((m) => Number(m[1]));
  assert.ok(mentioned.length >= 3);
  assert.deepStrictEqual([...new Set(mentioned)], [TRIAL_DAYS], "i18n.js matnlari TRIAL_DAYS bilan mos bo'lsin");
});

test("parol kamida 8 belgi", async () => {
  assert.match((await register("p@sec.uz", "1234567", "P")).error, /8/);
});
