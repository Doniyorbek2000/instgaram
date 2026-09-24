import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import * as pg from "./pgdb.js";


const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data"
);
const dbPath = path.join(dataDir, "db.json");

const TRIAL_DAYS = 3;

let db = { users: [], sessions: {}, platform: { prices: {} }, orders: {}, paymeTx: {} };

if (existsSync(dbPath)) {
  try {
    db = JSON.parse(readFileSync(dbPath, "utf8"));
    db.users ||= [];
    db.sessions ||= {};
    db.platform ||= { prices: {} };
    db.platform.prices ||= {};
    db.orders ||= {};
    db.paymeTx ||= {};
    db.users.forEach(normalizeUser);
  } catch {
    console.error("db.json o'qib bo'lmadi — yangi baza yaratiladi");
  }
}

/** Eski yozuvlarga yangi maydonlar qo'shilishini ta'minlaydi */
function normalizeUser(u) {
  u.meta ||= {};
  u.meta.igAccessToken ??= ""; // Instagram Login tokeni
  u.subscription ||= {
    plan: "start",
    status: "trial",
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
    expiresAt: null,
  };
  u.settings ||= { voiceReplies: false, telegramChatId: "" };
  if (u.settings.telegramChatId === undefined) u.settings.telegramChatId = "";
  u.stats ||= {
    messages: 0,
    customers: {},
    channels: { instagram: 0, facebook: 0, whatsapp: 0 },
    days: {},
    orders: 0,
  };
  u.handoffs ||= [];
  u.manualChats ||= {};
  u.leads ||= []; // oxirgi mijozlar (mini-CRM)
  u.chats ||= {}; // suhbat tarixi: chatKey -> [{role, text, time}]
  u.rules ||= []; // Avtomatlashtirish qoidalari (Comment-to-DM, story mention, keywords)
  u.scheduledPosts ||= []; // Rejalashtirilgan postlar
  u.broadcasts ||= []; // Ommaviy xabarlar tarixi
  u.growth ||= {}; // Referal statistikasi, o'yin natijalari (O'sish Vositalari)
  u.contactProfiles ||= {}; // IGSID -> {username, name, profilePic, fetchedAt} (Live Inbox uchun)
  u.gamification ||= {}; // Ballar tizimi: sozlamalar, ishtirokchilar, sovg'alar, viktorinalar
  u.forms ||= {}; // DM lid formalari: {list, sessions, submissions}
  u.contactMeta ||= {}; // chatKey -> {tags, note, fields}
  u.integrations ||= {}; // {webhookUrl, sheetsUrl, events}
  return u;
}

let isSaving = false;
let needsSave = false;

function save() {
  needsSave = true;
  if (isSaving) return;

  isSaving = true;
  setTimeout(async () => {
    while (needsSave) {
      needsSave = false;
      try {
        mkdirSync(dataDir, { recursive: true });
        const tmpPath = dbPath + ".tmp";
        const jsonStr = JSON.stringify(db, null, 2);
        writeFileSync(tmpPath, jsonStr, "utf8");
        if (existsSync(tmpPath)) {
          renameSync(tmpPath, dbPath);
        }
      } catch (err) {
        console.error("Baza atomik saqlashda xato:", err);
      }
    }
    isSaving = false;
  }, 40);
}

/** Boshqa modullar user obyektini o'zgartirgach saqlash uchun */
export async function persist(user) {
  save();
  if (user && user.id && pg.isPgReady()) {
    try {
      await pg.updateUser(user.id, user);
    } catch (e) {
      console.error("PostgreSQL persist error:", e.message);
    }
  }
}

// ==== Foydalanuvchilar ====

export async function createUser({ email, passwordHash, salt, businessName }) {
  if (pg.isPgReady()) {
    const u = await pg.createUser({ email, passwordHash, salt, businessName });
    if (u) return u;
  }
  const user = normalizeUser({
    id: crypto.randomUUID(),
    email: email.toLowerCase().trim(),
    passwordHash,
    salt,
    businessName: businessName || "",
    businessInfo: "",
    geminiApiKey: "",
    meta: { igAccessToken: "", pageAccessToken: "", pageId: "", igUserId: "", whatsappToken: "", whatsappPhoneNumberId: "" },
    createdAt: new Date().toISOString(),
  });
  db.users.push(user);
  save();
  return user;
}

export async function findUserByEmail(email) {
  if (pg.isPgReady()) {
    const u = await pg.findUserByEmail(email);
    if (u !== undefined) return u;
  }
  const e = String(email || "").toLowerCase().trim();
  return db.users.find((u) => u.email === e) || null;
}

export async function findUserById(id) {
  if (pg.isPgReady()) {
    const u = await pg.findUserById(id);
    if (u !== undefined) return u;
  }
  return db.users.find((u) => u.id === id) || null;
}

/** Barcha foydalanuvchilar ro'yxati (admin uchun) */
export async function listUsers() {
  if (pg.isPgReady()) return pg.listUsers();
  return db.users.slice();
}

export async function updateUser(id, patch) {
  if (pg.isPgReady()) {
    const u = await pg.updateUser(id, patch);
    if (u !== undefined) return u;
  }
  const user = db.users.find((u) => u.id === id);
  if (!user) return null;
  if (patch.meta) { user.meta = { ...user.meta, ...patch.meta }; delete patch.meta; }
  Object.assign(user, patch);
  save();
  return user;
}

/**
 * Kiruvchi webhookni qaysi foydalanuvchiga tegishli ekanini topadi.
 * kind: "ig" | "page" | "whatsapp", platformId: Meta yuborgan ID
 */
export async function findUserByPlatformId(kind, platformId) {
  if (pg.isPgReady()) {
    const u = await pg.findUserByPlatformId(kind, platformId);
    if (u !== undefined) return u;
  }
  const id = String(platformId || "");
  if (!id) return null;
  const users = db.users || [];
  const found = users.find((u) => {
    if (kind === "ig") return u.meta?.igUserId === id || u.meta?.pageId === id;
    if (kind === "page") return u.meta?.pageId === id || u.meta?.igUserId === id;
    if (kind === "whatsapp") return u.meta?.whatsappPhoneNumberId === id || u.meta?.whatsappPhoneId === id;
    return false;
  });
  if (found) return found;
  if (kind === "ig") {
    return users.find((u) => u.meta?.igAccessToken) || null;
  }
  return null;
}

// ==== Sessiyalar ====

export async function createSession(userId) {
  if (pg.isPgReady()) {
    const tok = await pg.createSession(userId);
    if (tok) return tok;
  }
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { userId, createdAt: Date.now() };
  save();
  return token;
}

export async function getSessionUser(token) {
  if (pg.isPgReady()) {
    const u = await pg.getSessionUser(token);
    if (u !== undefined) return u;
  }
  const session = token && db.sessions[token];
  if (!session) return null;
  if (Date.now() - session.createdAt > 30 * 24 * 60 * 60 * 1000) {
    delete db.sessions[token];
    save();
    return null;
  }
  return db.users.find((u) => u.id === session.userId) || null;
}

export async function deleteSession(token) {
  if (pg.isPgReady()) { await pg.deleteSession(token); return; }
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    save();
  }
}

/**
 * Foydalanuvchining barcha sessiyalarini bekor qiladi (exceptToken saqlanadi).
 * Parol o'zgarganda o'g'irlangan/eski sessiyalar ishlashda davom etmasligi uchun.
 */
export async function deleteUserSessions(userId, exceptToken = null) {
  if (pg.isPgReady()) { await pg.deleteUserSessions(userId, exceptToken); return; }
  let changed = false;
  for (const [token, session] of Object.entries(db.sessions)) {
    if (session.userId === userId && token !== exceptToken) {
      delete db.sessions[token];
      changed = true;
    }
  }
  if (changed) save();
}

// ==== Platforma sozlamalari (tarif narxlari) ====

/** Admin o'zgartirgan tarif narxlari (planId -> so'm). Bo'sh bo'lsa default ishlatiladi. */
export async function getPlanPrices() {
  if (pg.isPgReady()) return pg.getPlanPrices();
  return { ...db.platform.prices };
}

export async function setPlanPrices(prices) {
  if (pg.isPgReady()) return pg.setPlanPrices(prices);
  db.platform.prices = { ...db.platform.prices, ...prices };
  save();
  return db.platform.prices;
}

// ==== To'lov buyurtmalari (Payme) ====

/** Yangi to'lov buyurtmasi yaratadi. amount — so'mda. */
export async function createOrder({ userId, plan, days, amount }) {
  if (pg.isPgReady()) {
    const o = await pg.createOrder({ userId, plan, days, amount });
    if (o) return o;
  }
  const id = crypto.randomBytes(12).toString("hex");
  const order = { id, userId, plan, days, amount, status: "pending", createdAt: Date.now() };
  db.orders[id] = order;
  save();
  return order;
}

export async function findOrder(id) {
  if (pg.isPgReady()) return pg.findOrder(id);
  return db.orders[String(id || "")] || null;
}

export async function updateOrder(id, patch) {
  if (pg.isPgReady()) return pg.updateOrder(id, patch);
  const o = db.orders[id];
  if (!o) return null;
  Object.assign(o, patch);
  save();
  return o;
}

// ==== Payme tranzaksiyalari ====
// paymeTx: paymeTransactionId -> { id, orderId, state, amount, create_time, perform_time, cancel_time, reason }

export async function findPaymeTx(paymeId) {
  if (pg.isPgReady()) return pg.findPaymeTx(paymeId);
  return db.paymeTx[String(paymeId || "")] || null;
}

export async function findPaymeTxByOrder(orderId) {
  if (pg.isPgReady()) return pg.findPaymeTxByOrder(orderId);
  return Object.values(db.paymeTx).find((t) => t.orderId === orderId) || null;
}

export async function savePaymeTx(tx) {
  if (pg.isPgReady()) return pg.savePaymeTx(tx);
  db.paymeTx[tx.id] = tx;
  save();
  return tx;
}

export async function listPaymeTx({ from, to } = {}) {
  if (pg.isPgReady()) return pg.listPaymeTx({ from, to });
  return Object.values(db.paymeTx).filter(
    (t) => (from == null || t.create_time >= from) && (to == null || t.create_time <= to)
  );
}

export async function getPlatformGeminiKey() {
  if (pg.isPgReady()) return pg.getPlatformGeminiKey();
  return process.env.GEMINI_API_KEY || "";
}

export async function setPlatformGeminiKey(key) {
  if (pg.isPgReady()) await pg.setPlatformGeminiKey(key);
  process.env.GEMINI_API_KEY = key;
}
