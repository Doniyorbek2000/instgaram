import "./env.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Loyiha ildizi (src/ ning yuqorisi). */
export const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Ish ma'lumotlari papkasi: db.json (JSON rejimi), yuklangan media, suhbat arxivi.
 * Testlar DATA_DIR'ni vaqtinchalik papkaga yo'naltiradi — haqiqiy data/ ga tegilmaydi.
 */
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, "data"));
