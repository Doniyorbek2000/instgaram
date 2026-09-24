/**
 * Obunext — PostgreSQL Adapter Layer
 * 
 * adm-postgres (postgres:16-alpine) konteyneriga ulanadi.
 * JSON fayl bazasi bilan bir xil API ni ta'minlaydi — db.js bilan to'liq mos.
 * 
 * Ulanish: .env dagi PG_HOST/PG_PORT/PG_USER/PG_PASS/PG_DB orqali sozlanadi.
 *
 * Jadvallar:
 *   - users       : foydalanuvchilar (businessInfo, meta, stats, chats JSON)
 *   - sessions    : auth tokenlar
 *   - orders      : Payme buyurtmalar
 *   - payme_tx    : Payme tranzaksiyalar
 *   - platform    : global sozlamalar (tarif narxlari)
 */

import crypto from "node:crypto";

const PG_HOST = process.env.PG_HOST || "adm-postgres";
const PG_PORT = parseInt(process.env.PG_PORT || "5432", 10);
const PG_USER = process.env.PG_USER || "admin";
// Maxfiy — hech qanday fallback yo'q. .env da PG_PASS bo'lmasa, ulanish
// muvaffaqiyatsiz bo'lib, initPg() quyida avtomatik JSON-fayl bazaga o'tadi.
const PG_PASS = process.env.PG_PASS || "";
const PG_DB   = process.env.PG_DB   || "admai";

const TRIAL_DAYS = 3;

// ============================================================
// Minimal native PostgreSQL client (pg kutubxonasiz, socket orqali)
// Biz native fetch + pg wire protocol o'rniga node-postgres ga murojaat qilamiz
// Agar pg mavjud bo'lmasa — db.json fallback ishlaydi
// ============================================================
let pgPool = null;
let pgReady = false;
// PostgreSQL sozlangan (PG_PASS bor) bo'lsa-yu ulanmasa — bu JIDDIY holat: ma'lumotlar
// vaqtincha JSON faylga yoziladi. Admin panel va /health buni ochiq ko'rsatadi.
const pgState = { configured: Boolean(process.env.PG_PASS || process.env.PG_HOST), error: "", attempts: 0, connectedAt: "" };

async function initPg() {
  if (!pgState.configured) return;
  const tries = Math.max(1, Number(process.env.PG_CONNECT_RETRIES || 5));
  for (let i = 1; i <= tries; i++) {
    pgState.attempts = i;
    if (await connectOnce()) return;
    if (i < tries) await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** (i - 1))));
  }
  console.error("[Obunext] ❌ PostgreSQL'ga ulanib bo'lmadi — VAQTINCHA JSON fayl baza ishlatilmoqda! Sabab:", pgState.error);
}

async function connectOnce() {
  try {
    const { default: pg } = await import("pg");
    pgPool = new pg.Pool({
      host: PG_HOST,
      port: PG_PORT,
      user: PG_USER,
      password: PG_PASS,
      database: PG_DB,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pgPool.on("error", (err) => console.error("[PG Pool Error]", err.message));
    await pgPool.query("SELECT 1");
    await runMigrations();
    await loadAllUsers();
    pgReady = true;
    pgState.error = "";
    pgState.connectedAt = new Date().toISOString();
    console.log("[Obunext] ✅ PostgreSQL ulanish muvaffaqiyatli! Host:", PG_HOST);
    return true;
  } catch (err) {
    pgReady = false;
    pgState.error = err.message;
    try { await pgPool?.end(); } catch { /* yopilgan */ }
    pgPool = null;
    console.warn(`[Obunext] ⚠️  PostgreSQL ulanmadi (${pgState.attempts}-urinish):`, err.message);
    return false;
  }
}

/** Baza holati (admin panel, /health). */
export function dbStatus() {
  return { mode: pgReady ? "postgres" : "json", configured: pgState.configured, fallback: pgState.configured && !pgReady, error: pgState.error, attempts: pgState.attempts, connectedAt: pgState.connectedAt };
}

// Migrations (bir marta bajariladi, idempotent)
async function runMigrations() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      business_name TEXT DEFAULT '',
      business_info TEXT DEFAULT '',
      gemini_api_key TEXT DEFAULT '',
      meta JSONB DEFAULT '{}',
      settings JSONB DEFAULT '{}',
      subscription JSONB DEFAULT '{}',
      stats JSONB DEFAULT '{}',
      handoffs JSONB DEFAULT '[]',
      manual_chats JSONB DEFAULT '{}',
      leads JSONB DEFAULT '[]',
      chats JSONB DEFAULT '{}',
      rules JSONB DEFAULT '[]',
      scheduled_posts JSONB DEFAULT '[]',
      broadcasts JSONB DEFAULT '[]',
      growth JSONB DEFAULT '{}',
      contact_profiles JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- CREATE TABLE IF NOT EXISTS jadval allaqachon mavjud bo'lsa yangi ustunlarni
    -- qo'shmaydi — shuning uchun eski jadvallarga ustun qo'shish uchun ALTER TABLE kerak.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS broadcasts JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS growth JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_profiles JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS gamification JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS forms JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_meta JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS integrations JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS follow_ups JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS flows JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS team JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS content JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS media_library JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tg_business JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS api_tokens JSONB DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_usage JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sequences JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS shop JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS tracked_links JSONB DEFAULT '{}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS push_subs JSONB DEFAULT '[]';

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT,
      days INT,
      amount BIGINT,
      status TEXT DEFAULT 'pending',
      created_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS payme_tx (
      id TEXT PRIMARY KEY,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      state INT,
      amount BIGINT,
      create_time BIGINT,
      perform_time BIGINT,
      cancel_time BIGINT,
      reason INT
    );

    CREATE TABLE IF NOT EXISTS platform (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'
    );

    INSERT INTO platform(key, value) VALUES('prices', '{}') ON CONFLICT DO NOTHING;

    -- To'liq suhbat arxivi (users.chats'da faqat oxirgi xabarlar keshlanadi)
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_key TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      extra JSONB
    );
    CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(user_id, chat_key, id);

    -- Takroriy webhook hodisalari (restartdan keyin ham eslab qolinadi)
    CREATE TABLE IF NOT EXISTS seen_events (
      id TEXT PRIMARY KEY,
      at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seen_events_at_idx ON seen_events(at);

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS orders_user_id_idx   ON orders(user_id);
  `;
  await pgPool.query(sql);
}

// Singleton init — server tinglashni boshlashdan oldin `pgInit` kutiladi (index.js),
// aks holda ilk so'rovlar JSON bazaga tushib qolardi.
export const pgInit = initPg().catch((err) => { pgState.error = err.message; });

// ============================================================
// HELPER
// ============================================================
function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    salt: row.salt,
    businessName: row.business_name || "",
    businessInfo: row.business_info || "",
    geminiApiKey: row.gemini_api_key || "",
    meta: row.meta || {},
    settings: row.settings || {},
    subscription: row.subscription || {},
    stats: row.stats || {},
    handoffs: row.handoffs || [],
    manualChats: row.manual_chats || {},
    leads: row.leads || [],
    chats: row.chats || {},
    rules: row.rules || [],
    scheduledPosts: row.scheduled_posts || [],
    broadcasts: row.broadcasts || [],
    growth: row.growth || {},
    contactProfiles: row.contact_profiles || {},
    gamification: row.gamification || {},
    forms: row.forms || {},
    contactMeta: row.contact_meta || {},
    integrations: row.integrations || {},
    followUps: row.follow_ups || [],
    flows: row.flows || {},
    team: row.team || [],
    content: row.content || {},
    mediaLibrary: row.media_library || [],
    tgBusiness: row.tg_business || {},
    apiTokens: row.api_tokens || [],
    aiUsage: row.ai_usage || {},
    sequences: row.sequences || {},
    shop: row.shop || {},
    trackedLinks: row.tracked_links || {},
    pushSubs: row.push_subs || [],
    createdAt: row.created_at,
  };
}

// ============================================================
// IDENTITY MAP — har bir biznes xotirada BITTA obyekt sifatida yashaydi.
// Ilgari har so'rov bazadan yangi obyekt o'qirdi va persist() butun qatorni yozardi:
// parallel webhook + panel so'rovlari bir-birining o'zgarishini bosib ketardi
// ("lost update"). Endi barcha o'qishlar shu keshdagi obyektni qaytaradi, saqlashda
// esa faqat haqiqatan o'zgargan ustunlar yoziladi.
// Server bitta jarayonda ishlaydi (docker-compose: 1 ta app konteyner).
// ============================================================
const cache = new Map(); // id -> user
const snapshots = new Map(); // id -> { column: json }
let allLoaded = false;

function jsonOf(v) {
  return v === undefined ? "null" : JSON.stringify(v);
}

function remember(user) {
  const snap = {};
  for (const key of Object.keys(COL_MAP)) snap[key] = jsonOf(user[key]);
  snap.meta = jsonOf(user.meta);
  snapshots.set(user.id, snap);
}

function hydrate(row) {
  if (!row) return null;
  const hit = cache.get(row.id);
  if (hit) return hit;
  const user = normalizeUser(row);
  cache.set(user.id, user);
  remember(user);
  return user;
}

async function loadAllUsers() {
  const { rows } = await pgPool.query("SELECT * FROM users ORDER BY created_at DESC");
  cache.clear();
  snapshots.clear();
  for (const r of rows) hydrate(r);
  allLoaded = true;
}

function cachedUsers() {
  const t = (u) => new Date(u.createdAt || 0).getTime() || 0;
  return [...cache.values()].sort((a, b) => t(b) - t(a));
}

function defaultSubscription() {
  return {
    plan: "start",
    status: "trial",
    trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
    expiresAt: null,
  };
}

// ============================================================
// USERS
// ============================================================

export async function createUser({ email, passwordHash, salt, businessName }) {
  if (!pgReady) return null; // JSON fallback handles this
  const id = crypto.randomUUID();
  const subscription = defaultSubscription();
  const { rows } = await pgPool.query(
    `INSERT INTO users(id, email, password_hash, salt, business_name, subscription)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, email.toLowerCase().trim(), passwordHash, salt, businessName || "", JSON.stringify(subscription)]
  );
  return hydrate(rows[0]);
}

export async function findUserByEmail(email) {
  if (!pgReady) return null;
  const e = String(email || "").toLowerCase().trim();
  if (allLoaded) {
    for (const u of cache.values()) if (u.email === e) return u;
  }
  const { rows } = await pgPool.query("SELECT * FROM users WHERE email=$1", [e]);
  return hydrate(rows[0]);
}

export async function findUserById(id) {
  if (!pgReady) return null;
  const hit = cache.get(String(id || ""));
  if (hit) return hit;
  const { rows } = await pgPool.query("SELECT * FROM users WHERE id=$1", [id]);
  return hydrate(rows[0]);
}

/** Barcha bizneslar — xotiradagi keshdan (har daqiqalik rejalashtiruvchilar bazani yuklamaydi). */
export async function listUsers() {
  if (!pgReady) return [];
  if (!allLoaded) await loadAllUsers();
  return cachedUsers();
}

const COL_MAP = {
  email: "email",
  businessName: "business_name",
  businessInfo: "business_info",
  geminiApiKey: "gemini_api_key",
  passwordHash: "password_hash",
  salt: "salt",
  settings: "settings",
  subscription: "subscription",
  stats: "stats",
  handoffs: "handoffs",
  manualChats: "manual_chats",
  leads: "leads",
  chats: "chats",
  rules: "rules",
  scheduledPosts: "scheduled_posts",
  broadcasts: "broadcasts",
  growth: "growth",
  contactProfiles: "contact_profiles",
  gamification: "gamification",
  forms: "forms",
  contactMeta: "contact_meta",
  integrations: "integrations",
  followUps: "follow_ups",
  flows: "flows",
  team: "team",
  content: "content",
  mediaLibrary: "media_library",
  tgBusiness: "tg_business",
  apiTokens: "api_tokens",
  aiUsage: "ai_usage",
  sequences: "sequences",
  shop: "shop",
  trackedLinks: "tracked_links",
  pushSubs: "push_subs",
};
const TEXT_COLS = new Set(["email", "businessName", "businessInfo", "geminiApiKey", "passwordHash", "salt"]);

/**
 * Faqat o'zgargan ustunlarni aniqlaydi: sof funksiya (testlar uchun eksport).
 * Qaytaradi: [{ key, col, json }]
 */
export function diffColumns(user, snap = {}) {
  const out = [];
  for (const [key, col] of Object.entries({ ...COL_MAP, meta: "meta" })) {
    if (!(key in user)) continue;
    const json = jsonOf(user[key]);
    if (snap[key] !== json) out.push({ key, col, json });
  }
  return out;
}

// Bir biznes uchun yozuvlar ketma-ket bajariladi (tartib buzilmasin)
const writeChains = new Map();

/**
 * Biznesni saqlaydi. `patch` — keshdagi obyektning o'zi (persist) yoki qisman
 * o'zgarishlar ({ settings: ... }). Ikkala holatda ham keshdagi obyekt yangilanadi
 * va bazaga FAQAT o'zgargan ustunlar yoziladi.
 */
export async function updateUser(id, patch) {
  if (!pgReady) return null;
  let user = cache.get(id) || (await findUserById(id));
  if (!user) return null;
  if (patch && patch !== user) {
    const { meta, ...rest } = patch;
    if (meta) user.meta = { ...(user.meta || {}), ...meta };
    for (const key of Object.keys(rest)) if (key in COL_MAP) user[key] = rest[key];
  }
  const run = async () => {
    const snap = snapshots.get(id) || {};
    const changed = diffColumns(user, snap);
    if (!changed.length) return user;
    const sets = [];
    const vals = [];
    changed.forEach((c, i) => {
      sets.push(`${c.col} = $${i + 1}`);
      vals.push(TEXT_COLS.has(c.key) ? user[c.key] ?? "" : c.json);
    });
    vals.push(id);
    await pgPool.query(`UPDATE users SET ${sets.join(",")} WHERE id=$${vals.length}`, vals);
    for (const c of changed) snap[c.key] = c.json;
    snapshots.set(id, snap);
    return user;
  };
  const prev = writeChains.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(run);
  writeChains.set(id, next);
  try {
    return await next;
  } finally {
    if (writeChains.get(id) === next) writeChains.delete(id);
  }
}

export async function findUserByPlatformId(kind, platformId) {
  if (!pgReady) return null;
  const id = String(platformId || "");
  if (!id) return null;
  if (allLoaded) {
    const users = cachedUsers();
    const found = users.find((u) => {
      const m = u.meta || {};
      if (kind === "ig" || kind === "page") return m.igUserId === id || m.pageId === id;
      if (kind === "whatsapp") return m.whatsappPhoneNumberId === id || m.whatsappPhoneId === id;
      return false;
    });
    if (found) return found;
    if (kind === "ig") {
      const fb = users.find((u) => u.meta?.igAccessToken);
      if (fb) console.warn(`[findUserByPlatformId] ig=${id} uchun aniq moslik topilmadi — fallback orqali "${fb.businessName}" tanlandi`);
      return fb || null;
    }
    return null;
  }
  let q;
  if (kind === "ig") q = `SELECT * FROM users WHERE meta->>'igUserId' = $1 OR meta->>'pageId' = $1`;
  else if (kind === "page") q = `SELECT * FROM users WHERE meta->>'pageId' = $1 OR meta->>'igUserId' = $1`;
  else if (kind === "whatsapp") q = `SELECT * FROM users WHERE meta->>'whatsappPhoneNumberId' = $1 OR meta->>'whatsappPhoneId' = $1`;
  else return null;
  const { rows } = await pgPool.query(q, [id]);
  if (rows[0]) return hydrate(rows[0]);

  // Fallback: Agar platformId mos kelmasa, Instagram tokeni bor foydalanuvchini topish.
  // DIQQAT: bu >1 ulangan Instagram biznes bo'lganda noto'g'ri biznesga marshrutlash
  // xavfini tug'diradi (LIMIT 1, ORDER BY yo'q) — shuning uchun ishlatilganda log qilinadi.
  if (kind === "ig") {
    const fb = await pgPool.query(`SELECT * FROM users WHERE meta->>'igAccessToken' != '' AND meta->>'igAccessToken' IS NOT NULL LIMIT 1`);
    if (fb.rows[0]) {
      console.warn(`[findUserByPlatformId] ig=${id} uchun aniq moslik topilmadi — fallback orqali "${fb.rows[0].business_name}" tanlandi (2+ biznes ulangan bo'lsa xato marshrutlash xavfi bor)`);
      return hydrate(fb.rows[0]);
    }
  }
  return null;
}

// ============================================================
// SESSIONS
// ============================================================

export async function createSession(userId) {
  if (!pgReady) return null;
  const token = crypto.randomBytes(32).toString("hex");
  await pgPool.query(
    "INSERT INTO sessions(token, user_id, created_at) VALUES($1,$2,$3)",
    [token, userId, Date.now()]
  );
  return token;
}

export async function getSessionUser(token) {
  if (!pgReady) return null;
  if (!token) return null;
  const { rows } = await pgPool.query("SELECT * FROM sessions WHERE token=$1", [token]);
  if (!rows[0]) return null;
  if (Date.now() - rows[0].created_at > 30 * 24 * 60 * 60 * 1000) {
    await pgPool.query("DELETE FROM sessions WHERE token=$1", [token]);
    return null;
  }
  return findUserById(rows[0].user_id);
}

export async function deleteSession(token) {
  if (!pgReady || !token) return;
  await pgPool.query("DELETE FROM sessions WHERE token=$1", [token]);
}

/** Foydalanuvchining barcha sessiyalarini o'chiradi (exceptToken'dan tashqari) */
export async function deleteUserSessions(userId, exceptToken = null) {
  if (!pgReady || !userId) return;
  await pgPool.query(
    "DELETE FROM sessions WHERE user_id=$1 AND token IS DISTINCT FROM $2",
    [userId, exceptToken]
  );
}

// ============================================================
// PLATFORM SETTINGS (tarif narxlari)
// ============================================================

export async function getPlanPrices() {
  if (!pgReady) return {};
  const { rows } = await pgPool.query("SELECT value FROM platform WHERE key='prices'");
  return rows[0]?.value || {};
}

export async function setPlanPrices(prices) {
  if (!pgReady) return prices;
  const { rows } = await pgPool.query(
    `UPDATE platform SET value = value || $1 WHERE key='prices' RETURNING value`,
    [JSON.stringify(prices)]
  );
  return rows[0]?.value || prices;
}

export async function getPlatformSettings() {
  if (!pgReady) return {};
  const { rows } = await pgPool.query("SELECT value FROM platform WHERE key='settings'");
  return rows[0]?.value || {};
}

export async function setPlatformSettings(patch) {
  if (!pgReady) return {};
  const { rows } = await pgPool.query(
    `INSERT INTO platform(key, value) VALUES('settings', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = platform.value || $1::jsonb RETURNING value`,
    [JSON.stringify(patch || {})]
  );
  return rows[0]?.value || {};
}

export async function getPlatformGeminiKey() {
  if (!pgReady) return process.env.GEMINI_API_KEY || "";
  const { rows } = await pgPool.query("SELECT value FROM platform WHERE key='gemini_key'");
  return rows[0]?.value?.key || process.env.GEMINI_API_KEY || "";
}

export async function setPlatformGeminiKey(key) {
  if (!pgReady) return;
  await pgPool.query(
    `INSERT INTO platform(key, value) VALUES('gemini_key', $1::jsonb)
     ON CONFLICT(key) DO UPDATE SET value=$1::jsonb`,
    [JSON.stringify({ key })]
  );
}

// ============================================================
// ORDERS (Payme buyurtmalar)
// ============================================================

export async function createOrder({ userId, plan, days, amount }) {
  if (!pgReady) return null;
  const id = crypto.randomBytes(12).toString("hex");
  const now = Date.now();
  await pgPool.query(
    "INSERT INTO orders(id, user_id, plan, days, amount, status, created_at) VALUES($1,$2,$3,$4,$5,'pending',$6)",
    [id, userId, plan, days, amount, now]
  );
  return { id, userId, plan, days, amount, status: "pending", createdAt: now };
}

export async function listOrders({ limit = 500 } = {}) {
  if (!pgReady) return [];
  const { rows } = await pgPool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT $1", [Math.min(5000, Number(limit) || 500)]);
  return rows.map((r) => ({ id: r.id, userId: r.user_id, plan: r.plan, days: r.days, amount: Number(r.amount), status: r.status, createdAt: Number(r.created_at) }));
}

export async function deleteUser(id) {
  if (!pgReady) return false;
  const { rowCount } = await pgPool.query("DELETE FROM users WHERE id=$1", [String(id)]);
  cache.delete(String(id));
  snapshots.delete(String(id));
  return rowCount > 0;
}

export async function findOrder(id) {
  if (!pgReady) return null;
  const { rows } = await pgPool.query("SELECT * FROM orders WHERE id=$1", [String(id || "")]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, userId: r.user_id, plan: r.plan, days: r.days, amount: r.amount, status: r.status, createdAt: r.created_at };
}

// updateUser'dagi kabi aniq ustun ro'yxati (allowlist) — ilgari Object.keys(patch)
// TO'G'RIDAN-TO'G'RI SQL ustun nomi sifatida ishlatilardi (validatsiyasiz), bu esa
// haqiqiy production xatosiga olib keldi: payme.js `{ status: "paid", paymeId: tx.id }`
// yuborganda, "orders" jadvalida "paymeid" ustuni umuman yo'qligi sabab so'rov
// XATO bilan tugardi — bu esa Payme to'lovi HAQIQATAN amalga oshgan, lekin
// obuna hech qachon faollashtirilmagan holatga olib kelardi (chunki xato
// updateOrder()dan keyin turgan activate() chaqiruvini to'xtatib qo'yardi).
const ORDER_COL_MAP = { status: "status", plan: "plan", days: "days", amount: "amount" };

/**
 * `patch`dan faqat ORDER_COL_MAP'da ro'yxatdagi (haqiqiy jadval ustuniga mos)
 * maydonlarni oladi — noma'lum kalitlar (masalan eski "paymeId") jimgina
 * e'tiborsiz qoldiriladi, hech qachon xom SQL ustun nomi sifatida ishlatilmaydi.
 * Sof funksiya — Postgres ulanishisiz ham test qilinadi.
 */
export function buildOrderSetClause(patch, startIndex = 1) {
  const setClauses = [];
  const vals = [];
  let i = startIndex;
  for (const [key, col] of Object.entries(ORDER_COL_MAP)) {
    if (key in patch) {
      setClauses.push(`${col} = $${i++}`);
      vals.push(patch[key]);
    }
  }
  return { setClauses, vals, nextIndex: i };
}

export async function updateOrder(id, patch) {
  if (!pgReady) return null;

  const { setClauses, vals, nextIndex } = buildOrderSetClause(patch);
  if (setClauses.length === 0) return findOrder(id);

  vals.push(id);
  const { rows } = await pgPool.query(
    `UPDATE orders SET ${setClauses.join(",")} WHERE id=$${nextIndex} RETURNING *`,
    vals
  );
  const r = rows[0];
  return r ? { id: r.id, userId: r.user_id, plan: r.plan, days: r.days, amount: r.amount, status: r.status } : null;
}

// ============================================================
// PAYME TRANSACTIONS
// ============================================================

export async function findPaymeTx(paymeId) {
  if (!pgReady) return null;
  const { rows } = await pgPool.query("SELECT * FROM payme_tx WHERE id=$1", [String(paymeId || "")]);
  return rows[0] || null;
}

export async function findPaymeTxByOrder(orderId) {
  if (!pgReady) return null;
  const { rows } = await pgPool.query("SELECT * FROM payme_tx WHERE order_id=$1", [orderId]);
  return rows[0] || null;
}

export async function savePaymeTx(tx) {
  if (!pgReady) return tx;
  await pgPool.query(
    `INSERT INTO payme_tx(id, order_id, state, amount, create_time, perform_time, cancel_time, reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state, perform_time=EXCLUDED.perform_time,
       cancel_time=EXCLUDED.cancel_time, reason=EXCLUDED.reason`,
    [tx.id, tx.orderId || null, tx.state, tx.amount, tx.create_time, tx.perform_time || null, tx.cancel_time || null, tx.reason || null]
  );
  return tx;
}

export async function listPaymeTx({ from, to } = {}) {
  if (!pgReady) return [];
  let q = "SELECT * FROM payme_tx WHERE 1=1";
  const vals = [];
  if (from != null) { vals.push(from); q += ` AND create_time >= $${vals.length}`; }
  if (to   != null) { vals.push(to);   q += ` AND create_time <= $${vals.length}`; }
  const { rows } = await pgPool.query(q, vals);
  return rows;
}

// ============================================================
// SUHBAT ARXIVI
// ============================================================

export async function archiveMessages(userId, chatKey, entries) {
  if (!pgReady || !entries.length) return;
  const vals = [];
  const rows = entries.map((e, i) => {
    const b = i * 6;
    const { role, text, at, ...extra } = e;
    vals.push(userId, chatKey, String(role || "user"), String(text ?? ""), at || new Date().toISOString(), Object.keys(extra).length ? JSON.stringify(extra) : null);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
  });
  await pgPool.query(`INSERT INTO messages(user_id, chat_key, role, text, at, extra) VALUES ${rows.join(",")}`, vals);
}

/** Oxirgi `limit` ta xabar (eskidan yangiga) va jami soni. */
export async function loadMessages(userId, chatKey, limit = 100) {
  if (!pgReady) return { messages: [], total: 0 };
  const [{ rows }, count] = await Promise.all([
    pgPool.query("SELECT role, text, at, extra FROM messages WHERE user_id=$1 AND chat_key=$2 ORDER BY id DESC LIMIT $3", [userId, chatKey, limit]),
    pgPool.query("SELECT COUNT(*)::int AS n FROM messages WHERE user_id=$1 AND chat_key=$2", [userId, chatKey]),
  ]);
  const messages = rows.reverse().map((r) => ({ ...(r.extra || {}), role: r.role, text: r.text, at: new Date(r.at).toISOString() }));
  return { messages, total: count.rows[0]?.n || 0 };
}

export async function deleteMessages(userId, chatKey) {
  if (!pgReady) return;
  if (chatKey == null) await pgPool.query("DELETE FROM messages WHERE user_id=$1", [userId]);
  else await pgPool.query("DELETE FROM messages WHERE user_id=$1 AND chat_key=$2", [userId, chatKey]);
}

// ============================================================
// TAKRORIY HODISALAR (dedup)
// ============================================================

/** Yangi bo'lsa true (va yozib qo'yadi), avval ko'rilgan bo'lsa false. */
export async function markSeen(id, ttlMs) {
  if (!pgReady) return true;
  const now = Date.now();
  const { rowCount } = await pgPool.query(
    `INSERT INTO seen_events(id, at) VALUES($1,$2)
     ON CONFLICT(id) DO UPDATE SET at=EXCLUDED.at WHERE seen_events.at < $3`,
    [String(id), now, now - ttlMs]
  );
  if (Math.random() < 0.01) pgPool.query("DELETE FROM seen_events WHERE at < $1", [now - ttlMs]).catch(() => {});
  return rowCount > 0;
}

export async function recentSeen(ttlMs) {
  if (!pgReady) return [];
  const { rows } = await pgPool.query("SELECT id, at FROM seen_events WHERE at >= $1", [Date.now() - ttlMs]);
  return rows.map((r) => [r.id, Number(r.at)]);
}

// ============================================================
// pg ready check
// ============================================================
export function isPgReady() { return pgReady; }
