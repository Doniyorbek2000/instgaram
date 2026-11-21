/**
 * Reels video yasash: kadr rasmlari (1080×1920 JPEG, brauzer chizadi) + ixtiyoriy
 * ovoz (MP3) → ffmpeg → Instagram Reels talabiga mos MP4 (H.264 + AAC, 30 fps).
 * Har kadrga sekin "zoom" (Ken Burns) va qisqa qorong'udan chiqish beriladi.
 *
 * ffmpeg serverda bo'lishi shart (Dockerfile o'rnatadi). Og'ir ish — bir vaqtda
 * MAX_JOBS tadan ortiq render qilinmaydi.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const W = 1080;
export const H = 1920;
const FPS = 30;
const MAX_JOBS = 2;
const MAX_TOTAL_SEC = 90;
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;

let running = 0;

function run(cmd, args, timeout = RENDER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd}: ${String(stderr || err.message).trim().split("\n").slice(-3).join(" ").slice(0, 300)}`));
      resolve(String(stdout));
    });
  });
}

let ffmpegChecked = null;
/** ffmpeg o'rnatilganmi (bir marta tekshiriladi). */
export function ffmpegAvailable() {
  ffmpegChecked ||= run("ffmpeg", ["-version"], 10000).then(() => true, () => false);
  return ffmpegChecked;
}

/** Kadr davomiyliklarini tartibga soladi: har biri 1–10 s, ovoz uzunroq bo'lsa unga cho'ziladi, jami ≤ 90 s. */
export function planDurations(durations, audioSec = 0) {
  let d = durations.map((x) => Math.min(10, Math.max(1, Number(x) || 3)));
  const sum = d.reduce((a, b) => a + b, 0);
  const target = Math.min(MAX_TOTAL_SEC, Math.max(sum, audioSec ? audioSec + 0.6 : 0));
  if (Math.abs(target - sum) > 0.01) d = d.map((x) => (x * target) / sum);
  return d.map((x) => Math.round(x * 100) / 100);
}

/** ffmpeg argumentlari (alohida — test qilish oson bo'lsin). */
export function buildArgs({ frameFiles, durations, audioFile, outFile }) {
  const total = durations.reduce((a, b) => a + b, 0);
  const args = ["-y", "-loglevel", "error"];
  frameFiles.forEach((f) => args.push("-i", f));
  if (audioFile) args.push("-i", audioFile);
  else args.push("-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=44100:cl=stereo");

  const chains = durations.map((sec, i) => {
    const frames = Math.max(1, Math.round(sec * FPS));
    // 1.5x kattalashtirib zoom — kichik o'lchamdagi zoompan "titrashi" sezilmasin
    return `[${i}:v]scale=${W * 1.5}:${H * 1.5},zoompan=z='min(zoom+0.0007,1.08)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},fade=t=in:st=0:d=0.3,setsar=1[v${i}]`;
  });
  const concat = `${durations.map((_, i) => `[v${i}]`).join("")}concat=n=${durations.length}:v=1:a=0,format=yuv420p[v]`;
  const audioIdx = frameFiles.length;
  args.push(
    "-filter_complex", [...chains, concat, `[${audioIdx}:a]apad[a]`].join(";"),
    "-map", "[v]", "-map", "[a]",
    "-t", String(total),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-movflags", "+faststart",
    outFile
  );
  return args;
}

async function audioDuration(file) {
  try {
    const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 15000);
    return Number.parseFloat(out) || 0;
  } catch {
    return 0;
  }
}

/**
 * frames: Buffer[] (JPEG), durations: soniyalar, audio: MP3 Buffer yoki null.
 * Qaytaradi: MP4 Buffer. Xatoda Error otadi (foydalanuvchiga ko'rsatsa bo'ladigan matn bilan).
 */
export async function renderSlideshow({ frames, durations, audio = null }) {
  if (!frames?.length) throw new Error("Kadrlar yo'q");
  if (!(await ffmpegAvailable())) throw new Error("Serverda ffmpeg o'rnatilmagan — video yasab bo'lmaydi");
  if (running >= MAX_JOBS) throw new Error("Server hozir boshqa videolarni yasayapti — bir daqiqadan keyin qayta urinib ko'ring");
  running++;
  const dir = await mkdtemp(path.join(os.tmpdir(), "reel-"));
  try {
    const frameFiles = await Promise.all(
      frames.map(async (buf, i) => {
        const f = path.join(dir, `f${i}.jpg`);
        await writeFile(f, buf);
        return f;
      })
    );
    let audioFile = null;
    let audioSec = 0;
    if (audio?.length) {
      audioFile = path.join(dir, "voice.mp3");
      await writeFile(audioFile, audio);
      audioSec = await audioDuration(audioFile);
    }
    const outFile = path.join(dir, "out.mp4");
    const planned = planDurations(frames.map((_, i) => durations[i]), audioSec);
    await run("ffmpeg", buildArgs({ frameFiles, durations: planned, audioFile, outFile }));
    return await readFile(outFile);
  } finally {
    running--;
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
