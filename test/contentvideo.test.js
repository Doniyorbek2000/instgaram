import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegAvailable } from "../src/videoMaker.js";

test("Reels ssenariy → video yasash → Instagram'ga joylash navbatiga", { skip: !(await ffmpegAvailable()) && "ffmpeg o'rnatilmagan" }, async () => {
  const express = (await import("express")).default;
  const { contentRouter } = await import("../src/web/content_ui.js");
  const { register } = await import("../src/auth.js");
  const { user } = await register("reelsvideo@test.uz", "parol123", "Reels Shop");
  user.content = { items: [{ id: "ct_test1", tool: "reels", title: "Kuzgi kolleksiya", data: { scenes: [{ time: "0-1s", onScreenText: "A" }], caption: "Yangi!", hashtags: ["kiyim", "#moda"] }, at: new Date().toISOString() }] };

  const dir = mkdtempSync(path.join(os.tmpdir(), "cv-test-"));
  const jpgFile = path.join(dir, "f.jpg");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=green:s=1080x1920", "-frames:v", "1", jpgFile]);
  const jpg = readFileSync(jpgFile);

  const real = globalThis.fetch;
  const graphCalls = [];
  globalThis.fetch = async (url, opts) => {
    if (!/graph\.(facebook|instagram)\.com/.test(String(url))) return real(url, opts);
    graphCalls.push({ url: String(url), body: opts?.body ? String(opts.body) : "" });
    const body = String(url).includes("/media?") || (opts?.method === "POST" && String(url).endsWith("/media")) ? { id: "container1" } : { status_code: "IN_PROGRESS" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(contentRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const sendFrames = (buf) => {
    const fd = new FormData();
    fd.append("frames", new Blob([buf], { type: "image/jpeg" }), "f0.jpg");
    fd.append("durations", "[1]");
    return real(`${base}/content/ct_test1/video`, { method: "POST", body: fd }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  };
  const publish = () => real(`${base}/content/ct_test1/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  try {
    assert.strictEqual((await sendFrames(Buffer.from("not a jpeg"))).status, 400, "JPEG bo'lmagan kadr rad etiladi");
    assert.strictEqual((await publish()).status, 400, "video yo'q — joylab bo'lmaydi");

    const started = await sendFrames(jpg);
    assert.strictEqual(started.status, "rendering");
    let video = {};
    for (let i = 0; i < 60; i++) {
      video = (await real(`${base}/content/ct_test1/video`).then((r) => r.json())).video;
      if (video.status !== "rendering") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.strictEqual(video.status, "ready", video.error);
    assert.ok(user.mediaLibrary.some((m) => m.file === video.file && m.type === "video"), "mediatekaga saqlandi");

    assert.strictEqual((await publish()).status, 400, "Instagram ulanmagan");
    user.meta = { ...user.meta, igUserId: "1789", igAccessToken: "tok" };
    const pub = await publish();
    assert.strictEqual(pub.ok, true, pub.error);
    const post = user.scheduledPosts[0];
    assert.strictEqual(post.type, "reel");
    assert.strictEqual(post.mediaUrl, video.url);
    assert.strictEqual(post.caption, "Yangi!\n\n#kiyim #moda");
    assert.ok(graphCalls.some((c) => c.body.includes("REELS")), "Meta'ga REELS konteyneri so'raldi");
  } finally {
    globalThis.fetch = real;
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
