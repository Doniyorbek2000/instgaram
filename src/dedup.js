// Meta ba'zan bitta webhook xabarni bir necha marta (ba'zan soatlar o'tib) yuboradi.
// Ko'rilgan ID'lar xotirada tekshiriladi (tez, sinxron) va bazaga ham yoziladi —
// server qayta ishga tushsa ham takroriy javob yuborilmaydi.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as pg from "./pgdb.js";

const seen = new Map(); // id -> vaqt (ms)
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 50000;

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const filePath = path.join(dataDir, "seen-events.json");

function prune(now = Date.now()) {
  for (const [key, ts] of seen) if (now - ts > TTL_MS) seen.delete(key);
  while (seen.size > MAX) seen.delete(seen.keys().next().value);
}

let fileTimer = null;

/** JSON rejimida ko'rilgan ID'larni darhol faylga yozadi. */
export function flushSeenEvents() {
  if (fileTimer) clearTimeout(fileTimer);
  fileTimer = null;
  try {
    prune();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(filePath + ".tmp", JSON.stringify([...seen]), "utf8");
    renameSync(filePath + ".tmp", filePath);
  } catch (err) {
    console.error("[Dedup] saqlashda xato:", err.message);
  }
  return filePath;
}

function saveFileSoon() {
  if (fileTimer) return;
  fileTimer = setTimeout(flushSeenEvents, 2000);
  fileTimer.unref?.();
}

/** Server ishga tushganda oxirgi 24 soatdagi ID'larni yuklaydi. */
export async function loadSeenEvents() {
  const now = Date.now();
  try {
    const rows = pg.isPgReady() ? await pg.recentSeen(TTL_MS) : existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : [];
    for (const [id, ts] of rows) if (now - ts <= TTL_MS && !seen.has(id)) seen.set(id, ts);
  } catch (err) {
    console.error("[Dedup] yuklashda xato:", err.message);
  }
  return seen.size;
}

/** Xabar allaqachon ko'rilgan bo'lsa true (o'tkazib yuborish kerak) qaytaradi. */
export function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();
  if (seen.size > MAX) prune(now);
  const prev = seen.get(id);
  if (prev && now - prev < TTL_MS) return true;
  seen.set(id, now);
  if (pg.isPgReady()) pg.markSeen(id, TTL_MS).catch((err) => console.error("[Dedup] bazaga yozishda xato:", err.message));
  else saveFileSoon();
  return false;
}
