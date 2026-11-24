import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import { dueSlot, sceneSeconds } from "../src/autoReels.js";
import { wrapText, frameArgs, renderTextFrames, ffmpegAvailable } from "../src/videoMaker.js";

// 2026-11-24 10:30 Toshkent = 05:30 UTC
const at = (hhmm) => new Date(`2026-11-24T${hhmm}:00+05:00`);
const tenant = (extra = {}) => ({ settings: { autoReels: { enabled: true, times: ["10:00", "19:00"] } }, ...extra });

test("avto-Reels: vaqti kelgan slot qaytadi, bajarilgani yoki o'chirilgani — yo'q", () => {
  assert.strictEqual(dueSlot(tenant(), at("09:59")), null, "vaqtidan oldin");
  assert.strictEqual(dueSlot(tenant(), at("10:30")), "2026-11-24 10:00");
  assert.strictEqual(dueSlot(tenant({ autoReelsDone: ["2026-11-24 10:00"] }), at("10:30")), null, "bugun bajarilgan");
  assert.strictEqual(dueSlot(tenant(), at("14:00")), null, "3 soatdan ko'p o'tgan — o'tkazib yuboriladi");
  assert.strictEqual(dueSlot(tenant(), at("19:05")), "2026-11-24 19:00");
  assert.strictEqual(dueSlot({ settings: { autoReels: { enabled: false, times: ["10:00"] } } }, at("10:30")), null);
});

test("avto-Reels: kadr davomiyligi ssenariy vaqtidan olinadi", () => {
  assert.strictEqual(sceneSeconds("0-3s"), 3);
  assert.strictEqual(sceneSeconds("3 - 7.5s"), 4.5);
  assert.strictEqual(sceneSeconds("noaniq"), 3);
});

test("kadr matni qatorlarga bo'linadi, ko'pi bilan 6 qator", () => {
  assert.strictEqual(wrapText("Yangi kuzgi kolleksiya endi do'konimizda"), "Yangi kuzgi\nkolleksiya endi\ndo'konimizda");
  assert.strictEqual(wrapText("so'z ".repeat(60)).split("\n").length, 6);
});

test("kadr argumentlari: matn fayldan (%{} kengaytmasiz), Windows yo'li ekranlanadi", () => {
  const args = frameArgs({ textFile: "C:\\tmp\\t0.txt", imageFile: null, outFile: "o.jpg" });
  const vf = args[args.indexOf("-vf") + 1];
  assert.match(vf, /textfile='C\\:\/tmp\/t0\.txt'/);
  assert.match(vf, /expansion=none/);
  assert.ok(args.some((a) => a.startsWith("color=c=")), "rasm yo'q — rangli fon");
  const withImg = frameArgs({ textFile: "t.txt", imageFile: "img.png", outFile: "o.jpg" });
  assert.match(withImg[withImg.indexOf("-vf") + 1], /crop=1080:1920/);
});

test("haqiqiy kadr: matnli 1080×1920 JPEG", { skip: !(await ffmpegAvailable()) && "ffmpeg o'rnatilmagan" }, async () => {
  const [jpg] = await renderTextFrames([{ text: "Salom: 50% chegirma {test} 'qo'shtirnoq'" }]);
  assert.strictEqual(jpg[0], 0xff);
  assert.strictEqual(jpg[1], 0xd8);
});
