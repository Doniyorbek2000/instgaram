import "dotenv/config";
import crypto from "node:crypto";
import { Client } from "ssh2";

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("close", () => resolve(out)).on("data", d => out += d).stderr.on("data", d => out += d);
    });
  });
}

if (!process.env.SSH_HOST || !process.env.SSH_PASSWORD) {
  console.error("❌ .env da SSH_HOST va SSH_PASSWORD to'ldirilmagan (.env.example ga qarang).");
  process.exit(1);
}

const conn = new Client();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: process.env.SSH_HOST,
  port: parseInt(process.env.SSH_PORT || "22", 10),
  username: process.env.SSH_USER || "root",
  password: process.env.SSH_PASSWORD,
  readyTimeout: 10000
}));


const u = await exec(conn, `docker exec adm-postgres psql -U admin -d admai -c "SELECT id, email FROM users;"`);
console.log("=== USERS IN DB ===");
console.log(u.trim());

// Get ID of superadmin@example.com
const uidRes = await exec(conn, `docker exec adm-postgres psql -U admin -d admai -t -c "SELECT id FROM users WHERE email='superadmin@example.com';"`);
const uid = uidRes.trim();

// Create a one-off, randomly generated admin session (never hardcode a fixed token — it becomes a permanent backdoor)
const token = crypto.randomBytes(24).toString("hex");
await exec(conn, `docker exec adm-postgres psql -U admin -d admai -c "INSERT INTO sessions(token, user_id, created_at) VALUES('${token}', '${uid}', ${Date.now()});"`);
console.log(`\n🔑 Bir martalik admin sessiya tokeni (faqat shu safar): ${token}`);

// Fetch /admin
const resOut = await exec(conn, `curl -s http://127.0.0.1:3015/admin -H "Cookie: sid=${token}"`);
console.log("\n=== ADMIN PAGE RESPONSE ===");
console.log(resOut.slice(0, 800));

conn.end();
