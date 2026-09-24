/**
 * Kunlik zaxira nusxa.
 *
 *  - Ma'lumotlar bazasi: PostgreSQL jadvallari (yoki JSON rejimida db.json) →
 *    backups/obunext-<vaqt>-db.ndjson.gz
 *  - Fayllar: data/ papkasi (yuklangan media, suhbat arxivi) → backups/obunext-<vaqt>-files.tar.gz
 *  - Serverdan tashqariga: .env'da TELEGRAM_BOT_TOKEN va ADMIN_TELEGRAM_CHAT_ID bo'lsa,
 *    baza nusxasi (48 MB gacha) Telegram'ga hujjat bo'lib yuboriladi — server yo'qolsa ham nusxa qoladi.
 *  - Oxirgi BACKUP_KEEP (14) ta nusxa saqlanadi.
 *
 * Tiklash: `node scripts/restore.mjs backups/obunext-...-db.ndjson.gz` (README'ga qarang).
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as pg from "./pgdb.js";
import { getPlatformSettings, setPlatformSettings } from "./db.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const backupDir = process.env.BACKUP_DIR || path.join(root, "backups");
const dataDir = path.join(root, "data");
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const TG_LIMIT = 48 * 1024 * 1024;
export const BACKUP_NAME_RE = /^obunext-\d{8}-\d{6}-(db\.ndjson\.gz|files\.tar\.gz)$/;

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

function writeLines(file, producer) {
  return new Promise((resolve, reject) => {
    const gz = createGzip();
    const out = createWriteStream(file);
    gz.pipe(out);
    out.on("finish", resolve);
    out.on("error", reject);
    gz.on("error", reject);
    producer((obj) => new Promise((ok) => (gz.write(JSON.stringify(obj) + "\n") ? ok() : gz.once("drain", ok))))
      .then(() => gz.end())
      .catch((err) => {
        gz.destroy();
        reject(err);
      });
  });
}

async function dumpDatabase(file) {
  let rows = 0;
  await writeLines(file, async (write) => {
    await write({ t: "meta", r: { at: new Date().toISOString(), mode: pg.isPgReady() ? "postgres" : "json", version: 1 } });
    if (pg.isPgReady()) {
      for (const { name } of pg.BACKUP_TABLES) {
        rows += await pg.dumpTable(name, async (batch) => {
          for (const r of batch) await write({ t: name, r });
        });
      }
    } else {
      const dbFile = path.join(dataDir, "db.json");
      if (existsSync(dbFile)) {
        await write({ t: "jsondb", r: JSON.parse(readFileSync(dbFile, "utf8")) });
        rows = 1;
      }
    }
  });
  return rows;
}

function tarData(file) {
  return new Promise((resolve) => {
    if (!existsSync(dataDir)) return resolve(false);
    execFile("tar", ["-czf", file, "-C", root, "data"], { timeout: 10 * 60 * 1000 }, (err) => {
      if (err) console.error("[Zaxira] fayllar arxivi:", err.message);
      resolve(!err);
    });
  });
}

async function sendToTelegram(file, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return "sozlanmagan";
  const size = statSync(file).size;
  if (size > TG_LIMIT) return `katta (${Math.round(size / 1048576)} MB) — faqat serverda`;
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("document", new Blob([readFileSync(file)]), path.basename(file));
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
    const data = await res.json().catch(() => ({}));
    return data.ok ? "telegram" : `telegram xato: ${data.description || res.status}`;
  } catch (err) {
    return `telegram xato: ${err.message}`;
  }
}

export function listBackups() {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => BACKUP_NAME_RE.test(f))
    .map((f) => ({ name: f, size: statSync(path.join(backupDir, f)).size }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function rotate() {
  const groups = [...new Set(listBackups().map((b) => b.name.slice(0, "obunext-00000000-000000".length)))];
  for (const g of groups.slice(KEEP)) for (const b of listBackups().filter((x) => x.name.startsWith(g))) unlinkSync(path.join(backupDir, b.name));
}

let running = null;

/** Zaxira oladi. Qaytaradi: { at, files, rows, offsite } yoki { error } */
export function createBackup({ offsite = true } = {}) {
  if (running) return running;
  running = (async () => {
    const at = new Date();
    const base = `obunext-${stamp(at)}`;
    const result = { at: at.toISOString(), files: [], rows: 0, offsite: "" };
    try {
      mkdirSync(backupDir, { recursive: true });
      const dbFile = path.join(backupDir, `${base}-db.ndjson.gz`);
      result.rows = await dumpDatabase(dbFile);
      result.files.push({ name: path.basename(dbFile), size: statSync(dbFile).size });
      const filesFile = path.join(backupDir, `${base}-files.tar.gz`);
      if (await tarData(filesFile)) result.files.push({ name: path.basename(filesFile), size: statSync(filesFile).size });
      rotate();
      result.offsite = offsite ? await sendToTelegram(dbFile, `Obunext zaxira ${result.at.slice(0, 16).replace("T", " ")} · ${result.rows} qator`) : "o'chirilgan";
      console.log(`[Zaxira] ✅ ${result.files.map((f) => f.name).join(", ")} · tashqi: ${result.offsite}`);
    } catch (err) {
      result.error = err.message;
      console.error("[Zaxira] ❌", err.message);
      const { alertAdmin } = await import("./monitor.js");
      alertAdmin("backup", `Zaxira nusxa olinmadi: ${err.message}`);
    }
    await setPlatformSettings({ lastBackup: result }).catch(() => {});
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Oxirgi zaxira 24 soatdan eski bo'lsa — yangisini oladi (index.js da har soatda). */
export async function runDueBackup(now = Date.now()) {
  if (process.env.BACKUP_DISABLED === "true") return null;
  const last = ((await getPlatformSettings()) || {}).lastBackup;
  if (last?.at && now - Date.parse(last.at) < 23.5 * 3600000 && !last.error) return null;
  return createBackup();
}
