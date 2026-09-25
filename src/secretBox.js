/**
 * Maxfiy qiymatlarni (Meta/Telegram tokenlari, to'lov kalitlari) bazada va zaxira
 * nusxalarda shifrlangan holda saqlash — AES-256-GCM.
 *
 * Kalit: .env → DATA_ENCRYPTION_KEY (istalgan uzun tasodifiy satr, masalan
 * `openssl rand -hex 32`). Kalit bo'lmasa qiymatlar avvalgidek ochiq saqlanadi
 * (server ishga tushishda ogohlantiriladi). Kalitni YO'QOTMANG: usiz shifrlangan
 * tokenlarni tiklab bo'lmaydi (bizneslar Instagram'ni qayta ulashi kerak bo'ladi).
 *
 * Format: "enc:v1:<base64(iv[12] | tag[16] | shifrmatn)>". Eski (ochiq) qiymatlar
 * o'qishda o'zgarmay qaytadi va keyingi saqlashda shifrlanadi.
 */
import "./env.js";
import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function keyFrom(raw) {
  return raw ? crypto.createHash("sha256").update(String(raw)).digest() : null;
}

let key = keyFrom(process.env.DATA_ENCRYPTION_KEY);

/** Testlar uchun: kalitni almashtirish. */
export function setEncryptionKey(raw) {
  key = keyFrom(raw);
}

export const encryptionEnabled = () => Boolean(key);
export const isEncrypted = (v) => typeof v === "string" && v.startsWith(PREFIX);

export function encrypt(value) {
  if (!key || typeof value !== "string" || !value || isEncrypted(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

const FILE_MAGIC = Buffer.from("OBXENC1\n");

/** Fayl (zaxira nusxa) uchun: MAGIC | iv | tag | shifrmatn. Kalit bo'lmasa null. */
export function encryptBuffer(buf) {
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), body]);
}

export const isEncryptedBuffer = (buf) => buf.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC);

export function decryptBuffer(buf) {
  if (!key) throw new Error("DATA_ENCRYPTION_KEY o'rnatilmagan");
  const o = FILE_MAGIC.length;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(o, o + 12));
  decipher.setAuthTag(buf.subarray(o + 12, o + 28));
  return Buffer.concat([decipher.update(buf.subarray(o + 28)), decipher.final()]);
}

let warned = false;
export function decrypt(value) {
  if (!isEncrypted(value)) return value;
  try {
    if (!key) throw new Error("DATA_ENCRYPTION_KEY o'rnatilmagan");
    const buf = Buffer.from(value.slice(PREFIX.length), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch (err) {
    if (!warned) {
      warned = true;
      console.error(`[Shifrlash] ❌ Maxfiy qiymatni ochib bo'lmadi (${err.message}) — DATA_ENCRYPTION_KEY to'g'riligini tekshiring`);
    }
    return "";
  }
}

// Qaysi ustunning qaysi maydonlari maxfiy (nuqta bilan ajratilgan yo'l)
export const SECRET_PATHS = {
  meta: ["igAccessToken", "pageAccessToken", "whatsappToken"],
  settings: ["telegramBotToken"],
  shop: ["settings.payme.key", "settings.click.secretKey"],
  integrations: ["sms.password", "sms.token", "email.pass", "crm.amo.token", "crm.bitrix.webhookUrl"],
};

function mapPaths(obj, paths, fn) {
  if (!obj || typeof obj !== "object") return obj;
  const out = structuredClone(obj);
  for (const p of paths) {
    const parts = p.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) {
      node = node?.[part];
      if (!node || typeof node !== "object") break;
    }
    const last = parts[parts.length - 1];
    if (node && typeof node === "object" && typeof node[last] === "string") node[last] = fn(node[last]);
  }
  return out;
}

/** Ustun qiymatini bazaga yozishdan oldin: maxfiy maydonlar shifrlanadi (asl obyekt o'zgarmaydi). */
export function sealColumn(column, value) {
  const paths = SECRET_PATHS[column];
  return paths ? mapPaths(value, paths, encrypt) : value;
}

/** Bazadan o'qilgan ustun qiymati: maxfiy maydonlar ochiladi. */
export function openColumn(column, value) {
  const paths = SECRET_PATHS[column];
  return paths ? mapPaths(value, paths, decrypt) : value;
}
