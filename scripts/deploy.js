/**
 * ADM AI — VPS Deploy Script
 * Loyiha fayllari SFTP orqali serverga yuklaydi
 * va docker-compose restart qiladi.
 * 
 * Ishlatish: node scripts/deploy.js
 */
import "dotenv/config";
import { Client } from "ssh2";
import { createReadStream, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localRoot = path.join(__dirname, "..");
const remoteRoot = "/opt/instagram";

const SSH_HOST = process.env.SSH_HOST;
const SSH_USER = process.env.SSH_USER || "root";
const SSH_PASS = process.env.SSH_PASSWORD;
if (!SSH_HOST || !SSH_PASS) {
  console.error("❌ .env da SSH_HOST va SSH_PASSWORD to'ldirilmagan (.env.example ga qarang).");
  process.exit(1);
}


// Yuklanmaydigan papkalar/fayllar
const SKIP = new Set(["node_modules", ".git", "data", ".env"]);

function collectFiles(dir, base = "") {
  const entries = readdirSync(dir);
  const files = [];
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const full = path.join(dir, e);
    const rel = base ? `${base}/${e}` : e;
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectFiles(full, rel));
    } else {
      files.push({ local: full, remote: `${remoteRoot}/${rel}` });
    }
  }
  return files;
}

function sftpMkdirP(sftp, remotePath) {
  return new Promise((resolve) => {
    sftp.mkdir(remotePath, (err) => {
      // err 4 = already exists, ignorable
      resolve();
    });
  });
}

function sftpPut(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function execCmd(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream
        .on("close", () => resolve(out))
        .on("data", (d) => (out += d))
        .stderr.on("data", (d) => (out += d));
    });
  });
}

async function main() {
  const conn = new Client();

  await new Promise((resolve, reject) =>
    conn
      .on("ready", resolve)
      .on("error", reject)
      .connect({ host: SSH_HOST, port: 22, username: SSH_USER, password: SSH_PASS, readyTimeout: 15000 })
  );
  console.log("✅ SSH ulandi");

  const sftp = await new Promise((resolve, reject) =>
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)))
  );

  const files = collectFiles(localRoot);
  console.log(`📂 ${files.length} ta fayl yuklanmoqda...`);

  // Ensure remote dirs exist
  const dirs = new Set();
  for (const f of files) dirs.add(path.posix.dirname(f.remote));
  for (const d of [...dirs].sort()) {
    await sftpMkdirP(sftp, d);
  }

  // Upload files
  let i = 0;
  for (const f of files) {
    await sftpPut(sftp, f.local, f.remote);
    i++;
    if (i % 10 === 0) process.stdout.write(`\r  ${i}/${files.length}`);
  }
  console.log(`\r  ${files.length}/${files.length} ta fayl yuklandi ✅`);

  // npm install + docker-compose restart
  console.log("📦 npm install ...");
  const npmOut = await execCmd(conn, `cd ${remoteRoot} && npm install --production 2>&1`);
  if (npmOut.includes("error")) console.warn("npm warn:", npmOut.slice(0, 300));
  
  console.log("🔄 Container qayta ishga tushirilmoqda...");
  const restartOut = await execCmd(
    conn,
    `cd ${remoteRoot} && docker compose down; docker compose up -d --build 2>&1`
  );
  console.log(restartOut.slice(-800));

  console.log("📋 Container holati:");
  const ps = await execCmd(conn, "docker ps --format '{{.Names}}\\t{{.Status}}'");
  console.log(ps);

  conn.end();
  console.log("🚀 Deploy yakunlandi!");
}

main().catch((e) => {
  console.error("❌ Deploy xatosi:", e.message);
  process.exit(1);
});
