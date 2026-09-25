/**
 * Obunext — serverga deploy.
 *
 *   npm run deploy                 — testlar → yuklash → build → sog'liq tekshiruvi (xato bo'lsa rollback)
 *   npm run deploy -- --allow-dirty   commit qilinmagan o'zgarishlar bilan
 *   npm run deploy -- --skip-tests
 *
 * Qanday ishlaydi:
 *  1. Lokal testlar o'tishi shart.
 *  2. Faqat git'dagi (va .gitignore'ga tushmagan) fayllar arxivlanadi — .env, data/,
 *     backups/, node_modules HECH QACHON serverga yuborilmaydi. Serverdagi .env o'zgarmaydi.
 *  3. Serverda joriy image "rollback" deb belgilanadi, yangi image ishlab turgan sayt
 *     to'xtamasdan build qilinadi, so'ng faqat bot konteyneri almashtiriladi (bir necha soniya).
 *  4. /health 90 soniya ichida "ok" bo'lmasa — avtomatik oldingi image'ga qaytariladi.
 *
 * SSH: .env'da SSH_HOST + SSH_KEY_PATH (tavsiya) yoki SSH_PASSWORD. scripts/ssh.js'ga qarang.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, exec, REMOTE_DIR, APP_CONTAINER } from "./ssh.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const PORT = process.env.PORT || 3015;
const IMAGE = process.env.DEPLOY_IMAGE || "instagram-bot";

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();

function step(msg) {
  console.log(`\n▶ ${msg}`);
}

async function main() {
  const commit = git("rev-parse", "--short", "HEAD");
  const dirty = git("status", "--porcelain").length > 0;
  if (dirty && !args.has("--allow-dirty")) {
    console.error("❌ Commit qilinmagan o'zgarishlar bor. Avval commit qiling yoki --allow-dirty bilan ishga tushiring.");
    process.exit(1);
  }

  if (!args.has("--skip-tests")) {
    step("Testlar");
    execSync("npm test", { cwd: root, stdio: "inherit" });
  }

  step(`Arxiv (${commit}${dirty ? "+o'zgarishlar" : ""})`);
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter((f) => f && existsSync(path.join(root, f)) && !f.startsWith("test/") && !f.startsWith(".github/"));
  const version = { commit, dirty, at: new Date().toISOString() };
  writeFileSync(path.join(root, "VERSION.json"), JSON.stringify(version));
  const listFile = path.join(os.tmpdir(), `obunext-files-${Date.now()}.txt`);
  writeFileSync(listFile, [...files, "VERSION.json"].join("\n"));
  const bundle = path.join(os.tmpdir(), `obunext-${commit}-${Date.now()}.tar.gz`);
  execFileSync("tar", ["-czf", bundle, "-C", root, "-T", listFile]);
  unlinkSync(listFile);
  unlinkSync(path.join(root, "VERSION.json"));
  console.log(`  ${files.length} ta fayl, ${(readFileSync(bundle).length / 1024).toFixed(0)} KB`);

  const conn = await connect();
  const run = async (cmd, { quiet = false, allowFail = false } = {}) => {
    const r = await exec(conn, cmd, { stream: !quiet });
    if (r.code && !allowFail) throw new Error(`Buyruq xato bilan tugadi (${r.code}): ${cmd.split("\n")[0]}`);
    return r;
  };

  try {
    step("Yuklash");
    const remoteBundle = `/tmp/obunext-release-${Date.now()}.tar.gz`;
    await new Promise((resolve, reject) =>
      conn.sftp((err, sftp) => (err ? reject(err) : sftp.fastPut(bundle, remoteBundle, (e) => (e ? reject(e) : resolve()))))
    );

    const staging = `${REMOTE_DIR}/.release`;
    step("Build (sayt ishlashda davom etadi)");
    await run(`set -e
      test -f ${REMOTE_DIR}/.env || { echo ".env topilmadi — serverda ${REMOTE_DIR}/.env yarating"; exit 1; }
      rm -rf ${staging} && mkdir -p ${staging}
      tar -xzf ${remoteBundle} -C ${staging}
      rm -f ${remoteBundle}
      if docker image inspect ${IMAGE}:latest >/dev/null 2>&1; then docker tag ${IMAGE}:latest ${IMAGE}:rollback; fi
      docker build -t ${IMAGE}:latest ${staging}`);

    step("Fayllarni joylash va almashtirish");
    await run(`set -e
      cd ${REMOTE_DIR}
      # Eski modullar qolib ketmasin — kod papkalari toza yoziladi (data/, backups/, .env tegilmaydi)
      rm -rf src assets deploy.js
      cp -a ${staging}/. ${REMOTE_DIR}/
      rm -rf ${staging}
      chmod 600 .env
      mkdir -p data backups
      # Konteyner "node" (uid 1000) foydalanuvchisi sifatida ishlaydi
      chown -R 1000:1000 data backups
      chmod +x scripts/*.sh 2>/dev/null || true
      docker compose up -d --no-deps --no-build bot`);

    step("Sog'liq tekshiruvi");
    const healthy = await waitHealthy(run);
    if (!healthy) {
      console.error("\n❌ Yangi versiya sog'liq tekshiruvidan o'tmadi — oldingi versiyaga qaytarilmoqda");
      await run(`docker logs --tail 60 ${APP_CONTAINER} 2>&1`, { allowFail: true });
      await run(`cd ${REMOTE_DIR} && docker tag ${IMAGE}:rollback ${IMAGE}:latest && docker compose up -d --no-deps --no-build bot`, { allowFail: true });
      process.exitCode = 1;
      return;
    }
    await run(`docker image prune -f >/dev/null 2>&1 || true`, { quiet: true, allowFail: true });
    console.log(`\n🎉 Deploy tayyor: ${commit}${dirty ? " (+commit qilinmagan o'zgarishlar)" : ""}`);
  } finally {
    conn.end();
    if (existsSync(bundle)) unlinkSync(bundle);
  }
}

async function waitHealthy(run) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { out } = await run(`curl -s -m 3 http://127.0.0.1:${PORT}/health || true`, { quiet: true, allowFail: true });
    if (/"status":"ok"/.test(out)) {
      console.log(`  ✅ ${out.trim()}`);
      return true;
    }
    process.stdout.write(".");
  }
  return false;
}

main().catch((err) => {
  console.error("\n❌ Deploy xatosi:", err.message);
  process.exit(1);
});
