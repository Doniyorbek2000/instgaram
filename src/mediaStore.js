/**
 * Media kutubxonasi: biznes yuklagan rasm/video/audio/hujjatlar.
 *
 * Fayllar data/uploads/ ga tasodifiy nom bilan saqlanadi va /u/<fayl> orqali
 * ochiq beriladi — Instagram/WhatsApp/Telegram serverlari faylni shu URL'dan
 * o'zi yuklab oladi (Meta API fayl emas, havola qabul qiladi). Nom 128-bit
 * tasodifiy bo'lgani uchun havolani taxmin qilib bo'lmaydi.
 *
 * tenant.mediaLibrary = [{ id, file, url, type, mime, name, size, at }]
 */
import crypto from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync, existsSync, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { persist } from "./db.js";

export const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "uploads");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_LIBRARY = 300;

/** Ruxsat etilgan turlar: mime → [media turi, kengaytma] */
export const ALLOWED = {
  "image/jpeg": ["image", "jpg"],
  "image/png": ["image", "png"],
  "image/gif": ["image", "gif"],
  "image/webp": ["image", "webp"],
  "video/mp4": ["video", "mp4"],
  "video/quicktime": ["video", "mov"],
  "audio/mpeg": ["audio", "mp3"],
  "audio/mp4": ["audio", "m4a"],
  "audio/aac": ["audio", "aac"],
  "audio/ogg": ["audio", "ogg"],
  "application/pdf": ["file", "pdf"],
  "application/msword": ["file", "doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["file", "docx"],
  "application/vnd.ms-excel": ["file", "xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["file", "xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["file", "pptx"],
  "application/zip": ["file", "zip"],
  "text/plain": ["file", "txt"],
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(ALLOWED).map(([mime, [, ext]]) => [ext, mime]));
const FILE_RE = /^[a-f0-9]{32}\.[a-z0-9]{2,5}$/;

/** Fayl mazmunining boshidagi "sehrli baytlar" e'lon qilingan turga mosmi (soxta kengaytmadan himoya). */
function magicMatches(buf, mime) {
  const hex = buf.subarray(0, 12).toString("hex");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/png") return hex.startsWith("89504e47");
  if (mime === "image/gif") return hex.startsWith("47494638");
  if (mime === "image/webp") return hex.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP";
  if (mime === "application/pdf") return buf.subarray(0, 5).toString() === "%PDF-";
  if (mime.includes("openxmlformats") || mime === "application/zip") return hex.startsWith("504b0304");
  if (mime === "video/mp4" || mime === "video/quicktime" || mime === "audio/mp4") return buf.subarray(4, 8).toString() === "ftyp";
  return true; // mp3/aac/ogg/doc/xls/txt — turli sarlavhalar, mime'ga ishonamiz
}

export function publicMediaUrl(file) {
  return `${config.baseUrl || ""}/u/${file}`;
}

/** Faylni saqlaydi va kutubxonaga qo'shadi. Qaytaradi: yozuv yoki { error }. */
export function saveUpload(tenant, buffer, mime, originalName = "") {
  const kind = ALLOWED[mime];
  if (!kind) return { error: "Bu fayl turi qo'llab-quvvatlanmaydi (rasm, video, audio, PDF, Office, ZIP)" };
  if (!buffer?.length) return { error: "Fayl bo'sh" };
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: "Fayl 25 MB dan katta" };
  if (!magicMatches(buffer, mime)) return { error: "Fayl mazmuni uning turiga mos emas" };

  mkdirSync(uploadsDir, { recursive: true });
  const file = `${crypto.randomBytes(16).toString("hex")}.${kind[1]}`;
  writeFileSync(path.join(uploadsDir, file), buffer);

  const item = {
    id: file.split(".")[0],
    file,
    url: publicMediaUrl(file),
    type: kind[0],
    mime,
    name: String(originalName || file).replace(/[\r\n"]/g, "").slice(0, 120),
    size: buffer.length,
    at: new Date().toISOString(),
  };
  tenant.mediaLibrary = [item, ...(tenant.mediaLibrary || [])].slice(0, MAX_LIBRARY);
  persist(tenant);
  return item;
}

export function deleteUpload(tenant, id) {
  const item = (tenant.mediaLibrary || []).find((m) => m.id === id);
  if (!item) return false;
  tenant.mediaLibrary = tenant.mediaLibrary.filter((m) => m.id !== id);
  const p = path.join(uploadsDir, item.file);
  if (FILE_RE.test(item.file) && existsSync(p)) {
    try {
      unlinkSync(p);
    } catch (err) {
      console.error("[Media] faylni o'chirib bo'lmadi:", err.message);
    }
  }
  persist(tenant);
  return true;
}

/** /u/:file — ochiq berish (Express handler). */
export function serveUpload(req, res, next) {
  const file = String(req.params.file || "");
  if (!FILE_RE.test(file)) return next();
  const p = path.join(uploadsDir, file);
  if (!existsSync(p)) return next();
  const mime = MIME_BY_EXT[file.split(".").pop()] || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", statSync(p).size);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Brauzerda HTML/skript sifatida bajarilmasin — faqat media sifatida
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  if (ALLOWED[mime]?.[0] === "file") res.setHeader("Content-Disposition", "inline");
  createReadStream(p).pipe(res);
}

/** Flow/broadcast'dan kelgan media obyektini tekshiradi va tozalaydi. */
export function sanitizeMedia(m) {
  if (!m || typeof m !== "object") return null;
  const type = ["image", "video", "audio", "file", "post"].includes(m.type) ? m.type : "";
  if (!type) return null;
  if (type === "post") {
    const postId = String(m.postId || "").trim();
    if (!/^[0-9_]{5,40}$/.test(postId)) return null;
    return { type, postId, permalink: /^https:\/\/(www\.)?instagram\.com\//.test(m.permalink || "") ? String(m.permalink).slice(0, 300) : "", name: String(m.name || "").slice(0, 120) };
  }
  const url = String(m.url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url) && !/^\/u\/[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(url)) return null;
  return { type, url: url.slice(0, 1000), name: String(m.name || "").slice(0, 120) };
}

/** Nisbiy /u/... havolani to'liq URL'ga aylantiradi (Meta serverlari uchun). */
export function absoluteMediaUrl(url) {
  return url.startsWith("/u/") ? `${config.baseUrl || ""}${url}` : url;
}
