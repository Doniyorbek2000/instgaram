import "./_setup.js";
import test from "node:test";
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { planDurations, buildArgs, renderSlideshow, ffmpegAvailable } from "../src/videoMaker.js";

test("kadr davomiyliklari: 1–10 s oralig'ida, ovoz uzun bo'lsa cho'ziladi, jami 90 s dan oshmaydi", () => {
  assert.deepStrictEqual(planDurations([3, "x", 0.2, 50]), [3, 3, 1, 10]);
  assert.deepStrictEqual(planDurations([2, 2], 9.4), [5, 5], "ovoz 9.4 s + 0.6 s zaxira");
  const long = planDurations(Array(12).fill(10));
  assert.ok(Math.abs(long.reduce((a, b) => a + b, 0) - 90) < 0.1);
});

test("ffmpeg argumentlari: ovoz bo'lmasa jim audio trek qo'shiladi (Reels audio trek talab qiladi)", () => {
  const silent = buildArgs({ frameFiles: ["a.jpg", "b.jpg"], durations: [2, 3], audioFile: null, outFile: "o.mp4" });
  assert.ok(silent.includes("anullsrc=r=44100:cl=stereo"));
  const fc = silent[silent.indexOf("-filter_complex") + 1];
  assert.match(fc, /\[0:v\].*d=60.*\[v0\]/);
  assert.match(fc, /\[1:v\].*d=90.*\[v1\]/);
  assert.match(fc, /concat=n=2:v=1:a=0/);
  assert.match(fc, /\[2:a\]apad\[a\]/);
  assert.strictEqual(silent[silent.indexOf("-t", silent.indexOf("-filter_complex")) + 1], "5");

  const voiced = buildArgs({ frameFiles: ["a.jpg"], durations: [4], audioFile: "v.mp3", outFile: "o.mp4" });
  assert.ok(!voiced.includes("anullsrc=r=44100:cl=stereo"));
  assert.strictEqual(voiced[voiced.indexOf("v.mp3") - 1], "-i");
});

test("haqiqiy render: 2 kadr → 9:16 MP4 (H.264 + AAC)", { skip: !(await ffmpegAvailable()) && "ffmpeg o'rnatilmagan" }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "vm-test-"));
  try {
    const frames = ["red", "blue"].map((c) => {
      const f = path.join(dir, `${c}.jpg`);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=${c}:s=1080x1920`, "-frames:v", "1", f]);
      return readFileSync(f);
    });
    const mp4 = await renderSlideshow({ frames, durations: [1, 1] });
    assert.strictEqual(mp4.subarray(4, 8).toString(), "ftyp");
    const out = path.join(dir, "out.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "pipe:0", "-c", "copy", out], { input: mp4 });
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", out], { encoding: "utf8" });
    assert.match(probe, /h264,1080,1920/);
    assert.match(probe, /aac/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
