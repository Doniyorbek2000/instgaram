// Har bir test faylining BIRINCHI importi. Testlar hech qachon haqiqiy muhitga tegmasligi kerak:
//  - .env yuklanmaydi (NODE_ENV=test) — production Postgres, BASE_URL, tokenlar ishlatilmaydi;
//  - ma'lumotlar har fayl uchun alohida vaqtinchalik papkada (loyihaning data/ papkasi o'chirilmaydi).
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "obunext-test-"));
for (const key of ["PG_HOST", "PG_PORT", "PG_USER", "PG_PASS", "PG_DB", "DATA_ENCRYPTION_KEY", "BASE_URL", "ADMIN_HOST", "ADMIN_LOGIN", "ADMIN_PASSWORD", "GEMINI_MODEL", "AI_MODEL", "IG_EXTRA_SCOPES", "LOG_FORMAT"]) {
  delete process.env[key];
}

process.on("exit", () => {
  try {
    rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  } catch {
    /* vaqtinchalik papka — o'chmasa ham zarar yo'q */
  }
});
