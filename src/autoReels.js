/**
 * Avto-Reels: har kuni belgilangan vaqtlarda (sukut bo'yicha 10:00 va 19:00) AI biznes haqida
 * yangi Reels ssenariy yozadi, server kadrlarni o'zi chizadi (mediatekadagi rasmlar yoki rangli fon
 * + ekrandagi matn), ovoz qo'shib MP4 yasaydi va Instagram'ga joylaydi.
 *
 * Sozlama: tenant.settings.autoReels = { enabled, times: ["HH:MM", ...], lang }
 * Bajarilgan vaqtlar: tenant.autoReelsDone = ["YYYY-MM-DD HH:MM", ...] — bir vaqt ikki marta chiqmasin.
 */
import crypto from "node:crypto";
import path from "node:path";
import { listUsers, persist } from "./db.js";
import { generateText, aiBlockReason } from "./ai.js";
import { zonedParts } from "./templating.js";
import { renderTextFrames, renderSlideshow } from "./videoMaker.js";
import { synthesize, ttsAvailable } from "./tts.js";
import { saveUpload, uploadsDir } from "./mediaStore.js";
import { TOOLS, MAX_ITEMS, systemPrompt, queueReelPost } from "./web/content_ui.js";

export const DEFAULT_TIMES = ["10:00", "19:00"];
export const MAX_TIMES = 4;
// Vaqtdan keyin shu oraliqda ishga tushmasa (server o'chiq edi) — o'sha kun o'tkazib yuboriladi
const SLOT_WINDOW_MIN = 180;
const MAX_SCENES = 8;
const DEFAULT_SCENE_SEC = 3;

export const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));

/** Hozir bajarilishi kerak bo'lgan vaqt kaliti ("YYYY-MM-DD HH:MM") yoki null. */
export function dueSlot(u, now = new Date()) {
  const cfg = u.settings?.autoReels;
  if (!cfg?.enabled) return null;
  const { date, minutes } = zonedParts(u, now);
  const done = new Set(u.autoReelsDone || []);
  for (const t of (cfg.times?.length ? cfg.times : DEFAULT_TIMES).filter(isTime)) {
    const [h, m] = t.split(":").map(Number);
    const since = minutes - (h * 60 + m);
    const key = `${date} ${t}`;
    if (since >= 0 && since < SLOT_WINDOW_MIN && !done.has(key)) return key;
  }
  return null;
}

/** "0-3s" → 3; tushunarsiz bo'lsa sukut. */
export function sceneSeconds(time) {
  const m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/.exec(String(time || ""));
  const sec = m ? Number(m[2]) - Number(m[1]) : 0;
  return sec > 0 ? sec : DEFAULT_SCENE_SEC;
}

async function writeScript(u) {
  const recent = (u.content?.items || []).filter((it) => it.tool === "reels").slice(0, 10).map((it) => it.title);
  const topic = `Choose ONE fresh, specific topic yourself (a product, a benefit, a customer problem it solves, a useful tip or an objection). Do not repeat these recent topics: ${recent.join("; ") || "-"}`;
  const prompt = `${TOOLS.reels.build({ topic, goal: "sales", duration: 30, tone: "friendly" })} Use at most ${MAX_SCENES} scenes; every scene must have a short onScreenText (max 8 words).`;
  return generateText(u, systemPrompt(u, u.settings.autoReels.lang, TOOLS.reels.schema), prompt, { json: true, maxOutputTokens: 4096, temperature: 0.9 });
}

/** Bitta Reels: ssenariy → kadrlar → MP4 → mediateka → Instagram navbati. */
export async function makeAutoReel(u) {
  const data = await writeScript(u);
  const scenes = (Array.isArray(data?.scenes) ? data.scenes : []).slice(0, MAX_SCENES);
  if (!scenes.length) throw new Error("AI ssenariysida kadrlar yo'q");
  const images = (u.mediaLibrary || []).filter((m) => m.type === "image");
  const offset = images.length ? crypto.randomInt(images.length) : 0;
  const frames = await renderTextFrames(
    scenes.map((s, i) => ({
      text: s.onScreenText || s.voice || "",
      imageFile: images.length ? path.join(uploadsDir, images[(offset + i) % images.length].file) : null,
    }))
  );
  const voiceText = scenes.map((s) => String(s.voice || "").trim()).filter(Boolean).join(" ");
  const audio = ttsAvailable && voiceText ? await synthesize(voiceText) : null;
  const mp4 = await renderSlideshow({ frames, durations: scenes.map((s) => sceneSeconds(s.time)), audio });
  const title = String(data.title || "Avto-Reels").slice(0, 80);
  const saved = saveUpload(u, mp4, "video/mp4", `Reels — ${title}.mp4`);
  if (saved.error) throw new Error(saved.error);

  const now = new Date();
  const item = {
    id: `ct_${now.getTime().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    tool: "reels",
    title,
    input: { topic: "Avto-Reels", auto: true },
    data,
    video: { status: "ready", url: saved.url, file: saved.file, voice: Boolean(audio), at: now.toISOString() },
    at: now.toISOString(),
  };
  u.content ||= {};
  u.content.items = [item, ...(u.content.items || [])].slice(0, MAX_ITEMS);
  return queueReelPost(u, item, now, undefined, "auto");
}

let busy = false;

/** Rejalashtiruvchi chaqiradi: vaqti kelgan barcha bizneslar uchun Reels yasab joylaydi. */
export async function runAutoReels(now = new Date()) {
  if (busy) return; // video yasash bir necha daqiqa olishi mumkin — keyingi tur ustiga chiqmasin
  busy = true;
  try {
    for (const u of await listUsers()) {
      const slot = dueSlot(u, now);
      if (!slot) continue;
      // Ishni boshlashdan OLDIN belgilaymiz: xato bo'lsa ham o'sha vaqt qayta-qayta urinilmasin (kredit isrofi)
      u.autoReelsDone = [slot, ...(u.autoReelsDone || [])].slice(0, 2 * MAX_TIMES);
      const block = !u.meta?.igUserId ? "Instagram ulanmagan" : await aiBlockReason(u);
      try {
        if (block) throw new Error(block);
        const post = await makeAutoReel(u);
        u.autoReelsLast = { at: new Date().toISOString(), slot, status: post.status, error: post.error || "" };
      } catch (err) {
        console.error(`[Avto-Reels] ${u.businessName || u.email}:`, err.message);
        u.autoReelsLast = { at: new Date().toISOString(), slot, status: "failed", error: err.message };
      }
      await persist(u);
    }
  } finally {
    busy = false;
  }
}
