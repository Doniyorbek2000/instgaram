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

async function initPg() {
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
    pgReady = true;
    console.log("[Obunext] ✅ PostgreSQL ulanish muvaffaqiyatli! Host:", PG_HOST);
  } catch (err) {
    pgReady = false;
    console.warn("[Obunext] ⚠️  PostgreSQL ulanmadi — JSON fayl baza ishlatilmoqda:", err.message);
  }
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

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS orders_user_id_idx   ON orders(user_id);
  `;
  await pgPool.query(sql);
}

// Singleton init
initPg().catch(() => {});

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
  return normalizeUser(rows[0]);
}

export async function findUserByEmail(email) {
  if (!pgReady) return null;
  const e = String(email || "").toLowerCase().trim();
  const { rows } = await pgPool.query("SELECT * FROM users WHERE email=$1", [e]);
  return normalizeUser(rows[0]) || null;
}

export async function findUserById(id) {
  if (!pgReady) return null;
  const { rows } = await pgPool.query("SELECT * FROM users WHERE id=$1", [id]);
  return normalizeUser(rows[0]) || null;
}

export async function listUsers() {
  if (!pgReady) return [];
  const { rows } = await pgPool.query("SELECT * FROM users ORDER BY created_at DESC");
  return rows.map(normalizeUser);
}

export async function updateUser(id, patch) {
  if (!pgReady) return null;

  // Patch'dan meta o'qib olamiz — MUTATSIYA QILMASDAN. `delete patch.meta` xavfli
  // edi: persist(user) chaqirilganda `patch` aynan LIVE `user`/`tenant` obyektining
  // o'zi (klon emas) — shuning uchun `delete` shu topilgan tenant.meta'ni butun
  // amaldagi so'rov davomida (masalan webhook handler'da) DARHOL o'chirib
  // yuborardi, garchi quyidagi colMap sikli "meta" kalitini umuman ishlatmasa ham
  // (shuning uchun delete hech qanday amaliy maqsadga xizmat qilmagan, faqat zarar
  // keltirgan).
  const meta = patch.meta || undefined;

  const setClauses = [];
  const vals = [];
  let i = 1;

  const colMap = {
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

  for (const [key, col] of Object.entries(colMap)) {
    if (key in patch) {
      setClauses.push(`${col} = $${i++}`);
      vals.push(typeof patch[key] === "object" ? JSON.stringify(patch[key]) : patch[key]);
    }
  }

  if (meta) {
    setClauses.push(`meta = meta || $${i++}`);
    vals.push(JSON.stringify(meta));
  }

  if (setClauses.length === 0) return findUserById(id);
  vals.push(id);
  const { rows } = await pgPool.query(
    `UPDATE users SET ${setClauses.join(",")} WHERE id=$${i} RETURNING *`,
    vals
  );
  return normalizeUser(rows[0]) || null;
}

export async function findUserByPlatformId(kind, platformId) {
  if (!pgReady) return null;
  const id = String(platformId || "");
  if (!id) return null;
  let q;
  if (kind === "ig") q = `SELECT * FROM users WHERE meta->>'igUserId' = $1 OR meta->>'pageId' = $1`;
  else if (kind === "page") q = `SELECT * FROM users WHERE meta->>'pageId' = $1 OR meta->>'igUserId' = $1`;
  else if (kind === "whatsapp") q = `SELECT * FROM users WHERE meta->>'whatsappPhoneNumberId' = $1 OR meta->>'whatsappPhoneId' = $1`;
  else return null;
  const { rows } = await pgPool.query(q, [id]);
  if (rows[0]) {
    return normalizeUser(rows[0]);
  }

  // Fallback: Agar platformId mos kelmasa, Instagram tokeni bor foydalanuvchini topish.
  // DIQQAT: bu >1 ulangan Instagram biznes bo'lganda noto'g'ri biznesga marshrutlash
  // xavfini tug'diradi (LIMIT 1, ORDER BY yo'q) — shuning uchun ishlatilganda log qilinadi.
  if (kind === "ig") {
    const fb = await pgPool.query(`SELECT * FROM users WHERE meta->>'igAccessToken' != '' AND meta->>'igAccessToken' IS NOT NULL LIMIT 1`);
    if (fb.rows[0]) {
      console.warn(`[findUserByPlatformId] ig=${id} uchun aniq moslik topilmadi — fallback orqali "${fb.rows[0].business_name}" tanlandi (2+ biznes ulangan bo'lsa xato marshrutlash xavfi bor)`);
      return normalizeUser(fb.rows[0]);
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
// pg ready check
// ============================================================
export function isPgReady() { return pgReady; }
