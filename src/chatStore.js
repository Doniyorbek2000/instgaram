/**
 * Suhbat tarixi.
 *
 *  - tenant.chats[key] — faqat OXIRGI xabarlar keshi (Inbox ro'yxati, AI konteksti,
 *    24 soatlik oyna hisobi). Butun biznes qatori har xabarda saqlanadi, shuning uchun
 *    kesh kichik tutiladi.
 *  - To'liq tarix arxivda: PostgreSQL rejimida `messages` jadvali, JSON rejimida
 *    data/messages/<biznes>/<suhbat>.jsonl fayllari. Hech narsa o'chirilmaydi.
 */
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import * as pg from "./pgdb.js";

export const CHAT_CACHE = 60; // faol suhbatda keshlanadigan xabarlar
export const AI_CONTEXT = 16; // AI'ga beriladigan oxirgi xabarlar
const IDLE_KEEP = 4; // 14 kundan beri jim suhbatda keshda qoladiganlar
const IDLE_MS = 14 * 86400000;

const archiveDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "messages");
const safeId = (v) => String(v || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "_";
const chatFile = (tenantId, key) => path.join(archiveDir, safeId(tenantId), crypto.createHash("sha1").update(String(key)).digest("hex").slice(0, 32) + ".jsonl");

const fileChains = new Map();
function appendLines(file, lines) {
  const prev = fileChains.get(file) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, lines, "utf8");
    });
  fileChains.set(file, next);
  next.finally(() => fileChains.get(file) === next && fileChains.delete(file)).catch(() => {});
  return next;
}

/** Arxivga yozish tugashini kutadi (testlar va o'chirishdan oldin). */
export async function flushArchive() {
  await Promise.allSettled([...fileChains.values()]);
}

function archive(tenant, key, entries) {
  if (!tenant?.id || !entries.length) return Promise.resolve();
  const job = pg.isPgReady()
    ? pg.archiveMessages(tenant.id, key, entries)
    : appendLines(chatFile(tenant.id, key), entries.map((e) => JSON.stringify(e) + "\n").join(""));
  return job.catch((err) => console.error(`[Arxiv] ${key}:`, err.message));
}

function listOf(tenant, key) {
  tenant.chats ||= {};
  const raw = tenant.chats[key];
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.messages)) return raw.messages; // eski obyekt formati
  return (tenant.chats[key] = []);
}

let pushes = 0;

/**
 * Suhbatga xabar(lar) qo'shadi: keshga (oxirgi CHAT_CACHE ta) va arxivga.
 * Kesh massivining o'zi o'zgartiriladi (havolalar saqlanadi).
 */
export function pushChat(tenant, key, ...entries) {
  const now = new Date().toISOString();
  const items = entries.filter((e) => e && e.role).map((e) => ({ ...e, text: String(e.text ?? ""), at: e.at || now }));
  if (!items.length) return listOf(tenant, key);
  const list = listOf(tenant, key);
  list.push(...items);
  if (list.length > CHAT_CACHE) list.splice(0, list.length - CHAT_CACHE);
  archive(tenant, key, items);
  if (++pushes % 200 === 0) compactIdleChats(tenant);
  return list;
}

/** Uzoq vaqt jim turgan suhbatlarning keshini qisqartiradi (arxivda hammasi bor). */
export function compactIdleChats(tenant, now = Date.now()) {
  let trimmed = 0;
  for (const raw of Object.values(tenant.chats || {})) {
    const list = Array.isArray(raw) ? raw : raw?.messages;
    if (!Array.isArray(list) || list.length <= IDLE_KEEP) continue;
    const last = Date.parse(list[list.length - 1]?.at || 0) || 0;
    if (now - last > IDLE_MS) {
      list.splice(0, list.length - IDLE_KEEP);
      trimmed++;
    }
  }
  return trimmed;
}

/** AI uchun oxirgi xabarlar. */
export function recentHistory(tenant, key, n = AI_CONTEXT) {
  const raw = tenant.chats?.[key];
  const list = Array.isArray(raw) ? raw : raw?.messages || [];
  return list.slice(-n);
}

async function readArchive(tenant, key, limit) {
  if (pg.isPgReady()) return pg.loadMessages(tenant.id, key, limit);
  let text = "";
  try {
    text = await readFile(chatFile(tenant.id, key), "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const all = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      all.push(JSON.parse(line));
    } catch {
      /* chala yozilgan qator */
    }
  }
  return { messages: all.slice(-limit), total: all.length };
}

/**
 * Suhbatning to'liq tarixi (oxirgi `limit` ta). Arxiv paydo bo'lishidan oldingi
 * (eski) xabarlar keshdan qo'shiladi.
 * Qaytaradi: { messages, total, hasMore }
 */
export async function loadHistory(tenant, key, { limit = 100 } = {}) {
  const lim = Math.max(1, Math.min(5000, Number(limit) || 100));
  const cached = recentHistory(tenant, key, CHAT_CACHE);
  await flushArchive();
  let arch;
  try {
    arch = await readArchive(tenant, key, lim);
  } catch (err) {
    console.error(`[Arxiv] o'qishda xato (${key}):`, err.message);
    return { messages: cached.slice(-lim), total: cached.length, hasMore: false };
  }
  let messages = arch.messages;
  let total = arch.total;
  if (arch.total <= lim) {
    // Arxiv to'liq o'qildi — arxivdan oldingi eski kesh xabarlarini boshiga qo'shamiz
    const firstAt = messages[0]?.at || "￿";
    const legacy = cached.filter((m) => String(m.at || "") < firstAt && !messages.some((x) => x.at === m.at && x.text === m.text));
    messages = [...legacy, ...messages];
    total += legacy.length;
  }
  return { messages: messages.slice(-lim), total, hasMore: total > lim };
}

/** Bitta suhbat arxivini (key) yoki biznesning butun arxivini (key yo'q) o'chiradi. */
export async function deleteHistory(tenantId, key = null) {
  await flushArchive();
  if (pg.isPgReady()) return pg.deleteMessages(tenantId, key);
  const target = key == null ? path.join(archiveDir, safeId(tenantId)) : chatFile(tenantId, key);
  await rm(target, { recursive: true, force: true });
}
