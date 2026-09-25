/**
 * Serverga SSH orqali buyruq yuborish — deploy va tekshiruv skriptlari uchun umumiy.
 *
 * Kirish: SSH_KEY_PATH (tavsiya etiladi) yoki SSH_PASSWORD. Qiymatlar faqat .env'da.
 *
 * Ishlatish:
 *   node scripts/ssh.js status        — konteynerlar, /health, oxirgi loglar
 *   node scripts/ssh.js logs [N]      — bot konteyneri loglari (oxirgi N qator)
 *   node scripts/ssh.js live          — https://obunext.uz sarlavhalari
 *   node scripts/ssh.js users         — bizneslar ro'yxati (email, nom, sana)
 *   node scripts/ssh.js ssl-renew     — certbot sertifikatlarini sinov tariqasida yangilash
 *   node scripts/ssh.js "<buyruq>"    — ixtiyoriy buyruq
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Client } from "ssh2";

// .env process.env'ga YUKLANMAYDI — faqat shu yerda o'qiladi. Aks holda deploy ichida
// ishga tushadigan `npm test` lokal .env qiymatlarini meros qilib olardi.
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
export const localEnv = { ...(existsSync(envFile) ? dotenv.parse(readFileSync(envFile)) : {}), ...pick(process.env, /^(SSH_|DEPLOY_)/) };

function pick(obj, re) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => re.test(k)));
}

export const REMOTE_DIR = localEnv.DEPLOY_DIR || "/opt/instagram";
export const APP_CONTAINER = localEnv.DEPLOY_CONTAINER || "instagram-bot-1";

export function connect() {
  const { SSH_HOST, SSH_KEY_PATH, SSH_PASSWORD, SSH_KEY_PASSPHRASE, SSH_PORT, SSH_USER } = localEnv;
  if (!SSH_HOST || (!SSH_KEY_PATH && !SSH_PASSWORD)) {
    console.error("❌ .env da SSH_HOST va SSH_KEY_PATH (yoki SSH_PASSWORD) to'ldirilmagan (.env.example ga qarang).");
    process.exit(1);
  }
  const auth = SSH_KEY_PATH
    ? { privateKey: readFileSync(SSH_KEY_PATH), passphrase: SSH_KEY_PASSPHRASE || undefined }
    : { password: SSH_PASSWORD };
  const conn = new Client();
  return new Promise((resolve, reject) =>
    conn
      .on("ready", () => resolve(conn))
      .on("error", reject)
      .connect({
        host: SSH_HOST,
        port: Number(SSH_PORT || 22),
        username: SSH_USER || "root",
        readyTimeout: 60000,
        ...auth,
      })
  );
}

/** Buyruqni bajaradi: { code, out } (stdout+stderr). `stream: true` — natijani darhol chiqaradi. */
export function exec(conn, cmd, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, s) => {
      if (err) return reject(err);
      let out = "";
      const onData = (d) => {
        out += d;
        if (stream) process.stdout.write(d);
      };
      s.on("close", (code) => resolve({ code, out })).on("data", onData).stderr.on("data", onData);
    });
  });
}

const PRESETS = {
  status: () => `docker ps --format '{{.Names}}\t{{.Status}}'; echo; curl -s http://127.0.0.1:${localEnv.PORT || 3015}/health; echo; docker logs --tail 30 ${APP_CONTAINER} 2>&1`,
  logs: (n = 200) => `docker logs --tail ${Number(n) || 200} ${APP_CONTAINER} 2>&1`,
  live: () => "curl -sI https://obunext.uz",
  users: () =>
    `docker exec -i ${APP_CONTAINER} node --input-type=module -e "const { listUsers } = await import('./src/db.js'); const u = await listUsers(); console.table(u.map((x) => ({ email: x.email, biznes: x.businessName, yaratilgan: String(x.createdAt).slice(0, 10) }))); process.exit(0);"`,
  "ssl-renew": () => "certbot renew --dry-run",
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, ...args] = process.argv.slice(2);
  if (!name) {
    console.log(`Buyruqlar: ${Object.keys(PRESETS).join(", ")} yoki "<ixtiyoriy buyruq>"`);
    process.exit(0);
  }
  const cmd = PRESETS[name] ? PRESETS[name](...args) : [name, ...args].join(" ");
  const conn = await connect();
  const { code } = await exec(conn, cmd, { stream: true });
  conn.end();
  process.exitCode = code || 0;
}
