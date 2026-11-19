import "./_setup.js";
import test from "node:test";
import assert from "node:assert";

process.env.REPORTS_BOT_TOKEN = process.env.REPORTS_BOT_TOKEN || "test-token-123";

// Telegram va Instagram Graph so'rovlarini ushlab qolamiz (tarmoqqa chiqmaydi)
const tgSent = [];
const graphCalls = [];
const JPEG = Buffer.from("ffd8ffe000104a464946000101", "hex");
const realFetch = globalThis.fetch;
const reply = (data) => ({ ok: true, status: 200, json: async () => data });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("api.telegram.org/file/")) return { ok: true, arrayBuffer: async () => JPEG };
  if (u.includes("api.telegram.org")) {
    const body = JSON.parse(opts.body || "{}");
    if (u.endsWith("/getFile")) return reply({ ok: true, result: { file_path: "photos/p.jpg" } });
    if (u.endsWith("/getMe")) return reply({ ok: true, result: { username: "testbot" } });
    tgSent.push(body);
    return reply({ ok: true, result: {} });
  }
  if (u.includes("graph.instagram.com")) {
    graphCalls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes("/media_publish")) return reply({ id: "PUBLISHED_1" });
    if (String(opts.body || "").includes("bad.jpg")) return { ok: false, status: 400, json: async () => ({ error: { message: "Only photo or video can be accepted as media type." } }) };
    if (u.includes("/media")) return reply({ id: "CONTAINER_1" });
    return reply({ status_code: "FINISHED" });
  }
  return realFetch(url, opts);
};

const { reportsBotRouter, incomingMedia, reportsLinkUrl, setupReportsBotWebhook } = await import("../src/reportsBot.js");
const { checkAndPublishScheduledPosts } = await import("../src/postPublisher.js");
const { createMediaContainer } = await import("../src/services/instagram.js");
const { register } = await import("../src/auth.js");
const { updateUser, findUserByEmail } = await import("../src/db.js");
const express = (await import("express")).default;

test("story konteyneri: rasm -> image_url, video -> video_url, caption yuborilmaydi", async () => {
  const tenant = { meta: { igUserId: "42", igAccessToken: "tok" } };
  graphCalls.length = 0;
  await createMediaContainer(tenant, { type: "story", mediaUrl: "https://x.uz/u/a.jpg", caption: "c" });
  await createMediaContainer(tenant, { type: "story", mediaUrl: "https://x.uz/u/b.mp4", caption: "c" });
  assert.deepStrictEqual(graphCalls[0].body, { media_type: "STORIES", image_url: "https://x.uz/u/a.jpg" });
  assert.deepStrictEqual(graphCalls[1].body, { media_type: "STORIES", video_url: "https://x.uz/u/b.mp4" });
});

test("incomingMedia: eng katta foto, video va hujjat-video", () => {
  assert.deepStrictEqual(incomingMedia({ photo: [{ file_id: "s", file_size: 1 }, { file_id: "L", file_size: 9 }] }), { fileId: "L", size: 9, mime: "image/jpeg" });
  assert.strictEqual(incomingMedia({ video: { file_id: "v", file_size: 5, mime_type: "video/mp4" } }).mime, "video/mp4");
  assert.strictEqual(incomingMedia({ text: "salom" }), null);
});

test("Telegram: rasm yuborish -> Story tanlash -> Instagram'ga joylanadi va natija xabar qilinadi", async () => {
  const { user } = await register("tgpost@x.uz", "parol123", "Post Biz");
  const chatId = 777888999;
  await updateUser(user.id, {
    meta: { ...(user.meta || {}), igUserId: "42", igAccessToken: "tok" },
    settings: { ...(user.settings || {}), reportsTelegramChatId: String(chatId), reportsLang: "uz" },
  });

  const app = express();
  app.use(express.json());
  app.use(reportsBotRouter);
  const server = app.listen(0);
  test.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const post = async (update) => {
    await realFetch(`${base}/telegram-reports/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) });
    await new Promise((r) => setTimeout(r, 60));
  };

  await post({ message: { chat: { id: chatId }, photo: [{ file_id: "F1", file_size: 1000 }], caption: "Yangi aksiya" } });
  assert.match(tgSent.at(-1).text, /qanday joylaymiz/);
  assert.deepStrictEqual(tgSent.at(-1).reply_markup.inline_keyboard[0].map((b) => b.callback_data), ["post:image", "post:story"]);

  graphCalls.length = 0;
  await post({ callback_query: { id: "q1", message: { chat: { id: chatId } }, data: "post:story" } });

  const fresh = await findUserByEmail("tgpost@x.uz");
  const p = fresh.scheduledPosts[0];
  assert.strictEqual(p.type, "story");
  assert.strictEqual(p.source, "telegram");
  assert.strictEqual(p.status, "published");
  assert.strictEqual(graphCalls.filter((c) => c.url.includes("/media_publish")).length, 1, "bir marta joylanadi");
  assert.match(tgSent.at(-1).text, /joylandi \(Story\)/);
});

test("Instagram rad etsa, haqiqiy sabab postda saqlanadi", async () => {
  const { user } = await register("tgerr@x.uz", "parol123", "Err Biz");
  await updateUser(user.id, {
    meta: { ...(user.meta || {}), igUserId: "42", igAccessToken: "tok" },
    scheduledPosts: [{ id: "p1", type: "image", mediaUrl: "https://x.uz/u/bad.jpg", caption: "", publishAt: new Date(Date.now() - 1000).toISOString(), status: "pending" }],
  });
  await checkAndPublishScheduledPosts();
  const fresh = await findUserByEmail("tgerr@x.uz");
  assert.strictEqual(fresh.scheduledPosts[0].status, "failed");
  assert.match(fresh.scheduledPosts[0].error, /Only photo or video/);
});

test("saytdagi havola (/start kod) telefonsiz bog'laydi, kod bir martalik", async () => {
  process.env.BASE_URL = "https://test.obunext.uz";
  await setupReportsBotWebhook();
  const { user } = await register("tglink@x.uz", "parol123", "Link Biz");
  const url = reportsLinkUrl(user);
  const code = url.match(/start=([a-f0-9]+)$/)?.[1];
  assert.ok(url.startsWith("https://t.me/testbot?start=") && code, url);
  assert.strictEqual(reportsLinkUrl(user), url, "muddati ko'p qolgan kod qayta ishlatiladi");

  const app = express();
  app.use(express.json());
  app.use(reportsBotRouter);
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const send = async (chatId, text) => {
    await realFetch(`${base}/telegram-reports/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: { chat: { id: chatId }, text } }) });
    await new Promise((r) => setTimeout(r, 60));
  };
  try {
    await send(4242, `/start ${code}`);
    let fresh = await findUserByEmail("tglink@x.uz");
    assert.strictEqual(fresh.settings.reportsTelegramChatId, "4242");
    assert.match(tgSent.at(-1).text, /Link Biz akkauntiga bog'landingiz/);

    // Ikkinchi odam xuddi shu kod bilan bog'lana olmaydi
    await send(5151, `/start ${code}`);
    fresh = await findUserByEmail("tglink@x.uz");
    assert.strictEqual(fresh.settings.reportsTelegramChatId, "4242");
  } finally {
    server.close();
  }
});
