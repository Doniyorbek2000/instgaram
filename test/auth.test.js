import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Test bazasini tozalab boshlaymiz
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });

// Admin email'ni ai.js/config o'qishidan oldin belgilaymiz
process.env.ADMIN_EMAILS = "boss@example.com";

const { register, login, isAdmin, loginOrRegisterWithGoogle } = await import("../src/auth.js");
const { findUserByPlatformId, updateUser, listUsers } = await import("../src/db.js");

test("ro'yxatdan o'tish va kirish ishlaydi", async () => {
  const reg = await register("test@example.com", "parol123", "Test Biznes");
  assert.ok(reg.user);
  assert.strictEqual(reg.user.businessName, "Test Biznes");

  const ok = await login("test@example.com", "parol123");
  assert.ok(ok.token);

  const bad = await login("test@example.com", "notogri");
  assert.ok(bad.error);
});

test("bir email ikki marta ro'yxatdan o'tolmaydi", async () => {
  const dup = await register("test@example.com", "parol123", "Boshqa");
  assert.ok(dup.error);
});

test("qisqa parol rad etiladi", async () => {
  const r = await register("new@example.com", "123", "X");
  assert.ok(r.error);
});

test("platforma ID bo'yicha biznes topiladi (webhook routing)", async () => {
  const { user } = await register("shop@example.com", "parol123", "Do'kon");
  await updateUser(user.id, {
    meta: {
      igUserId: "1784140001",
      pageId: "999888777",
      whatsappPhoneNumberId: "555444333",
    },
  });

  const byIg = await findUserByPlatformId("ig", "1784140001");
  const byPage = await findUserByPlatformId("page", "999888777");
  const byWa = await findUserByPlatformId("whatsapp", "555444333");
  const none = await findUserByPlatformId("ig", "yoq-id");

  assert.strictEqual(byIg?.id, user.id);
  assert.strictEqual(byPage?.id, user.id);
  assert.strictEqual(byWa?.id, user.id);
  assert.strictEqual(none, null);
});

test("admin faqat ADMIN_EMAILS ro'yxatidagilar bo'ladi", async () => {
  const { user: boss }  = await register("boss@example.com", "parol123", "Platforma");
  const { user: oddiy } = await register("oddiy@example.com", "parol123", "Do'kon 2");
  assert.strictEqual(isAdmin(boss), true);
  assert.strictEqual(isAdmin(oddiy), false);
});

test("admin barcha bizneslar ro'yxatini ko'ra oladi", async () => {
  const all = await listUsers();
  assert.ok(all.length >= 3);
});

test("Google orqali yangi email — yangi akkaunt yaratadi va googleId'ni saqlaydi", async () => {
  const r = await loginOrRegisterWithGoogle({ googleId: "g-111", email: "googler@example.com", name: "Googler Biz" });
  assert.ok(r.token);
  assert.strictEqual(r.user.email, "googler@example.com");
  assert.strictEqual(r.user.businessName, "Googler Biz");
  assert.strictEqual(r.user.meta.googleId, "g-111");
});

test("Google orqali mavjud (parol bilan ro'yxatdan o'tgan) email'ga kirsa — SHU akkauntga bog'lanadi, ikkilanmaydi", async () => {
  const { user: pwUser } = await register("linkme@example.com", "parol123", "Link Biznes");
  const r = await loginOrRegisterWithGoogle({ googleId: "g-222", email: "linkme@example.com", name: "Boshqa Nom" });
  assert.strictEqual(r.user.id, pwUser.id);
  assert.strictEqual(r.user.businessName, "Link Biznes"); // eski nom o'zgarmadi
  assert.strictEqual(r.user.meta.googleId, "g-222");

  const all = await listUsers();
  assert.strictEqual(all.filter((u) => u.email === "linkme@example.com").length, 1);
});

test("Google orqali kirishda parol tasodifiy bo'lgani uchun parol bilan kirib bo'lmaydi", async () => {
  const r = await loginOrRegisterWithGoogle({ googleId: "g-333", email: "onlygoogle@example.com", name: "Only Google" });
  assert.ok(r.token);
  const attempt = await login("onlygoogle@example.com", "parol123");
  assert.ok(attempt.error);
});

test("Google profilida email bo'lmasa xato qaytadi", async () => {
  const r = await loginOrRegisterWithGoogle({ googleId: "g-444", email: "", name: "Yo'q" });
  assert.ok(r.error);
});
