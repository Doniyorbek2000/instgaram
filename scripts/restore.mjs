#!/usr/bin/env node
/**
 * Zaxira nusxadan tiklash.
 *
 *   node scripts/restore.mjs backups/obunext-YYYYMMDD-HHMMSS-db.ndjson.gz
 *   node scripts/restore.mjs obunext-...-db.ndjson.gz.enc   (Telegram'dagi shifrlangan nusxa;
 *                                                          .env'da o'sha DATA_ENCRYPTION_KEY bo'lishi shart)
 *
 * PostgreSQL rejimida (.env'da PG_* bo'lsa) jadvallarga yoziladi — mavjud qatorlar
 * o'zgarmaydi (ON CONFLICT DO NOTHING; platforma sozlamalari esa zaxiradagisi bilan
 * almashtiriladi), ya'ni bo'sh bazaga to'liq tiklash uchun mo'ljallangan. JSON rejimida data/db.json qayta yoziladi (eskisi .bak bo'lib saqlanadi).
 * Fayllar (media, suhbat arxivi): tar -xzf backups/obunext-...-files.tar.gz -C <loyiha papkasi>
 *
 * Server to'xtatilgan holda ishga tushiring.
 */
import "../src/env.js";
import { createReadStream, existsSync, renameSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { DATA_DIR } from "../src/paths.js";
import { decryptBuffer, isEncryptedBuffer } from "../src/secretBox.js";

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error("Foydalanish: node scripts/restore.mjs <obunext-...-db.ndjson.gz[.enc]>");
  process.exit(1);
}

const pg = await import("../src/pgdb.js");
await pg.pgInit;

const head = readFileSync(file).subarray(0, 16);
const source = isEncryptedBuffer(head) ? Readable.from([decryptBuffer(readFileSync(file))]) : createReadStream(file);
const lines = createInterface({ input: source.pipe(createGunzip()), crlfDelay: Infinity });
const batches = {};
const counts = {};
let meta = null;
let current = null;

async function flush(table) {
  const rows = batches[table] || [];
  if (!rows.length) return;
  counts[table] = (counts[table] || 0) + (await pg.restoreRows(table, rows));
  batches[table] = [];
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const { t, r } = JSON.parse(line);
  if (t === "meta") {
    meta = r;
    console.log(`Zaxira: ${r.at} (${r.mode})`);
    continue;
  }
  if (t === "jsondb") {
    if (pg.isPgReady()) {
      console.error("Bu JSON rejimidagi zaxira, server esa PostgreSQL'ga ulangan. PG_* sozlamalarini vaqtincha olib tashlab, qayta ishga tushiring.");
      process.exit(1);
    }
    const dbFile = path.join(DATA_DIR, "db.json");
    mkdirSync(path.dirname(dbFile), { recursive: true });
    if (existsSync(dbFile)) renameSync(dbFile, `${dbFile}.bak-${Date.now()}`);
    writeFileSync(dbFile, JSON.stringify(r, null, 2));
    console.log(`✅ data/db.json tiklandi (${(r.users || []).length} biznes)`);
    continue;
  }
  if (!pg.isPgReady()) {
    console.error("Bu PostgreSQL zaxirasi — .env'da PG_* sozlamalarini kiriting.");
    process.exit(1);
  }
  // Jadval almashganda oldingisini to'liq yozamiz (bog'liqliklar tartibi saqlanadi)
  if (current && current !== t) await flush(current);
  current = t;
  (batches[t] ||= []).push(r);
  if (batches[t].length >= 500) await flush(t);
}
// Tartib muhim: avval users (boshqa jadvallar unga bog'langan)
for (const { name } of pg.BACKUP_TABLES) await flush(name);
if (meta?.mode === "postgres") console.log("✅ Tiklandi:", counts);
process.exit(0);
