/**
 * Ommaviy xabarlar (ChatPlace "Broadcasts") — segmentlash, o'zgaruvchilar,
 * fon rejimida yuborish, rejalashtirish.
 *
 * Auditoriya: kanal + teglar (istalgani / barchasi) + istisno teg + faqat
 * oxirgi 24 soatda yozganlar (Meta Instagram/Messenger qoidasi).
 * Xabar: matn ({name} va boshqa o'zgaruvchilar bilan) + havola tugmalari
 * yoki xabar o'rniga flow'ni ishga tushirish.
 */
import crypto from "node:crypto";
import { persist, listUsers } from "./db.js";
import { sendReply, sendMedia, splitKey } from "./outbound.js";
import { sanitizeMedia } from "./mediaStore.js";
import { renderTemplate } from "./templating.js";
import { getContactMeta, lastInboundAt } from "./contacts.js";
import { isActive } from "./subscription.js";

const CHANNELS = new Set(["ig", "fb", "wa", "tg"]);
const WINDOW_MS = 24 * 60 * 60 * 1000;
const SEND_DELAY_MS = 120; // Meta/Telegram rate limitlariga tushmaslik uchun
const MAX_HISTORY = 100;

const running = new Set();

/** Biznesning barcha haqiqiy kontaktlari (ig:/fb:/wa:/tg: kalitlari). */
export function allContacts(tenant) {
  const keys = new Set([
    ...Object.keys(tenant.chats || {}),
    ...Object.keys(tenant.stats?.customers || {}),
    ...Object.keys(tenant.contactMeta || {}),
  ]);
  return [...keys].filter((k) => CHANNELS.has(splitKey(k).chan) && k.indexOf(":") > 0 && splitKey(k).id);
}

export { lastInboundAt };

const normTag = (t) => String(t || "").trim().toLowerCase().replace(/\s+/g, "-");
const tagList = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map(normTag).filter(Boolean);

/** Segment filtri bo'yicha qabul qiluvchilar. */
export function resolveAudience(tenant, filter = {}, now = Date.now()) {
  const channel = filter.channel && filter.channel !== "all" ? filter.channel : "";
  const tags = tagList(filter.tags);
  const exclude = tagList(filter.excludeTags);
  const tagMode = filter.tagMode === "all" ? "all" : "any";
  const only24h = filter.only24h !== false && filter.only24h !== "false";

  return allContacts(tenant).filter((key) => {
    const { chan } = splitKey(key);
    if (channel && chan !== channel) return false;
    const have = getContactMeta(tenant, key).tags;
    if (tags.length) {
      const ok = tagMode === "all" ? tags.every((t) => have.includes(t)) : tags.some((t) => have.includes(t));
      if (!ok) return false;
    }
    if (exclude.some((t) => have.includes(t))) return false;
    // Meta (Instagram, Messenger, WhatsApp) erkin xabarni faqat mijoz oxirgi 24 soatda
    // yozgan bo'lsa qabul qiladi. Telegram'da bunday cheklov yo'q.
    if (only24h && chan !== "tg" && now - lastInboundAt(tenant, key) > WINDOW_MS) return false;
    return true;
  });
}

export function sanitizeBroadcast(body = {}) {
  const buttons = String(body.buttons || "")
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("|");
      if (i < 0) return null;
      const title = line.slice(0, i).trim().slice(0, 20);
      const url = line.slice(i + 1).trim();
      return title && /^https?:\/\/\S+$/i.test(url) ? { title, url } : null;
    })
    .filter(Boolean)
    .slice(0, 3);
  const scheduledAt = body.scheduledAt ? Date.parse(body.scheduledAt) : NaN;
  return {
    name: String(body.name || "").trim().slice(0, 120),
    message: String(body.message || "").trim().slice(0, 2000),
    flowId: String(body.flowId || "").trim(),
    media: sanitizeMedia(body.media),
    buttons,
    filter: {
      channel: ["ig", "fb", "wa", "tg"].includes(body.channel) ? body.channel : "all",
      tags: tagList(body.tags),
      tagMode: body.tagMode === "all" ? "all" : "any",
      excludeTags: tagList(body.excludeTags),
      only24h: body.only24h !== "false",
    },
    scheduledAt: Number.isFinite(scheduledAt) && scheduledAt > Date.now() + 30000 ? new Date(scheduledAt).toISOString() : "",
  };
}

/** Yangi broadcast yozuvini yaratadi (rejalashtirilgan yoki darhol yuboriladigan). */
export function createBroadcast(tenant, data) {
  tenant.broadcasts ||= [];
  const b = {
    id: `bc_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
    ...data,
    channel: data.filter.channel,
    status: data.scheduledAt ? "scheduled" : "queued",
    total: 0,
    sentCount: 0,
    failedCount: 0,
    createdAt: new Date().toISOString(),
  };
  tenant.broadcasts.unshift(b);
  tenant.broadcasts = tenant.broadcasts.slice(0, MAX_HISTORY);
  persist(tenant);
  return b;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Broadcast'ni yuboradi (fon rejimida chaqiriladi). Har bir kontaktga xabar
 * alohida o'zgaruvchilar bilan tayyorlanadi. Natija (yuborildi/yetmadi) halol saqlanadi.
 * send — testlarda almashtiriladi.
 */
export async function runBroadcast(tenant, broadcastId, { send = sendReply, sendMediaFn = sendMedia, delayMs = SEND_DELAY_MS } = {}) {
  const b = (tenant.broadcasts || []).find((x) => x.id === broadcastId);
  if (!b || running.has(b.id) || b.status === "sending" || b.status === "completed") return b || null;
  running.add(b.id);
  try {
    const audience = resolveAudience(tenant, b.filter);
    b.status = "sending";
    b.total = audience.length;
    b.startedAt = new Date().toISOString();
    persist(tenant);

    let flow = null;
    if (b.flowId) {
      const { findFlow } = await import("./flows.js");
      flow = findFlow(tenant, b.flowId);
    }

    for (const key of audience) {
      const { chan, id } = splitKey(key);
      try {
        let ok;
        if (flow) {
          const { startFlow } = await import("./flows.js");
          const r = await startFlow(tenant, key, flow, send === sendReply ? {} : { send: async (m) => send(tenant, chan, id, m.text, m.options) });
          ok = r.status !== "empty";
        } else {
          if (b.media) await sendMediaFn(tenant, chan, id, b.media);
          ok = b.message ? await send(tenant, chan, id, renderTemplate(b.message, tenant, key), b.buttons || []) : Boolean(b.media);
        }
        if (ok) b.sentCount++;
        else b.failedCount++;
      } catch (err) {
        console.error(`[Broadcast] ${key}:`, err.message);
        b.failedCount++;
      }
      if ((b.sentCount + b.failedCount) % 20 === 0) persist(tenant); // progress ko'rinib tursin
      if (delayMs) await sleep(delayMs);
    }
    b.status = "completed";
    b.finishedAt = new Date().toISOString();
    persist(tenant);
    return b;
  } finally {
    running.delete(b.id);
  }
}

/** Rejalashtirilgan broadcast'larni ishga tushiradi (index.js da har daqiqada). */
export async function runDueBroadcasts(now = Date.now()) {
  for (const tenant of await listUsers()) {
    if (!isActive(tenant)) continue;
    for (const b of tenant.broadcasts || []) {
      if (b.status === "scheduled" && b.scheduledAt && Date.parse(b.scheduledAt) <= now) {
        runBroadcast(tenant, b.id).catch((err) => console.error("[Broadcast] rejalashtirilgan:", err.message));
      }
    }
  }
}
