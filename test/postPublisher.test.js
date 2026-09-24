import test from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
rmSync(dataDir, { recursive: true, force: true });

const { register } = await import("../src/auth.js");
const { updateUser, findUserById } = await import("../src/db.js");
const { checkAndPublishScheduledPosts } = await import("../src/postPublisher.js");

// Bu holatlar haqiqiy Graph API'ga chaqiruv qilinmasdan oldin qaytariladi —
// tarmoqsiz, deterministik tekshirish mumkin.

test("carousel — noto'g'ri sonli rasm URL (masalan 1 ta) rad etiladi (ulangan akkaunt bilan ham)", async () => {
  const { user } = await register("carousel@x.uz", "parol123", "Test");
  const past = new Date(Date.now() - 60000).toISOString();
  await updateUser(user.id, {
    meta: { ...(user.meta || {}), igUserId: "fake_ig_id", igAccessToken: "fake_token" },
    scheduledPosts: [{ id: "p1", type: "carousel", mediaUrls: ["https://x.com/a.jpg"], publishAt: past, status: "pending" }],
  });

  await checkAndPublishScheduledPosts();

  const updated = await findUserById(user.id);
  assert.strictEqual(updated.scheduledPosts[0].status, "failed");
  assert.match(updated.scheduledPosts[0].error, /2 dan 10 gacha/);
});

test("Instagram ulanmagan foydalanuvchi uchun aniq xato qaytadi", async () => {
  const { user } = await register("notconnected@x.uz", "parol123", "Test");
  const past = new Date(Date.now() - 60000).toISOString();
  await updateUser(user.id, {
    scheduledPosts: [{ id: "p2", type: "image", mediaUrl: "https://x.com/a.jpg", publishAt: past, status: "pending" }],
  });

  await checkAndPublishScheduledPosts();

  const updated = await findUserById(user.id);
  assert.strictEqual(updated.scheduledPosts[0].status, "failed");
  assert.match(updated.scheduledPosts[0].error, /ulanmagan/i);
});

test("uzoq vaqt 'processing' holatida qolgan post vaqt tugagani sababli 'failed' bo'ladi", async () => {
  const { user } = await register("timeout@x.uz", "parol123", "Test");
  const longAgo = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 daqiqa oldin
  await updateUser(user.id, {
    meta: { ...(user.meta || {}), igUserId: "fake_ig_id", igAccessToken: "fake_token" },
    scheduledPosts: [{
      id: "p3",
      type: "reel",
      mediaUrl: "https://x.com/a.mp4",
      publishAt: longAgo,
      status: "processing",
      containerId: "fake_container",
      processingStartedAt: longAgo,
    }],
  });

  await checkAndPublishScheduledPosts();

  const updated = await findUserById(user.id);
  assert.strictEqual(updated.scheduledPosts[0].status, "failed");
  assert.match(updated.scheduledPosts[0].error, /[Vv]aqt tugadi/);
});

test("kelajakdagi (hali muddati kelmagan) post 'pending' holatida qoladi", async () => {
  const { user } = await register("future@x.uz", "parol123", "Test");
  const future = new Date(Date.now() + 3600000).toISOString();
  await updateUser(user.id, {
    scheduledPosts: [{ id: "p4", type: "image", mediaUrl: "https://x.com/a.jpg", publishAt: future, status: "pending" }],
  });

  await checkAndPublishScheduledPosts();

  const updated = await findUserById(user.id);
  assert.strictEqual(updated.scheduledPosts[0].status, "pending");
});
