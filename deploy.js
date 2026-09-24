import "dotenv/config";
import { Client } from 'ssh2';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.SSH_HOST || !process.env.SSH_PASSWORD) {
  console.error("❌ .env da SSH_HOST va SSH_PASSWORD to'ldirilmagan (.env.example ga qarang).");
  process.exit(1);
}

const config = {
  host: process.env.SSH_HOST,
  port: parseInt(process.env.SSH_PORT || '22', 10),
  username: process.env.SSH_USER || 'root',
  password: process.env.SSH_PASSWORD,
};


// Skript turgan papka — loyiha ildizi (qaysi kompyuterda ishga tushirilishidan qat'i nazar)
const localBaseDir = path.dirname(fileURLToPath(import.meta.url));
const remoteProjectDir = '/opt/instagram';

// src/ ichidagi barcha .js fayllar avtomatik yig'iladi — qo'lda yuritiladigan ro'yxat
// eskirib, yangi modul serverga yuklanmay qolishi (va server yiqilishi) oldini oladi.
function collectSrcFiles(dir = 'src') {
  return fs.readdirSync(path.join(localBaseDir, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return collectSrcFiles(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}

const filesToUpload = [
  'package.json',
  'package-lock.json',
  // legacy-python/ production serverga yuklanmaydi.
  'rules.json',
  'auto_reply_rules.json',
  'scheduled_posts.json',
  'APP_REVIEW.md',
  'DEPLOY.md',
  'README.md',
  'SETUP.md',
  'business.md',
  'assets/og-image.png',
  'assets/favicon.png',
  '.env',
  'docker-compose.yml',
  ...collectSrcFiles(),
];


function execCommand(conn, cmd) {
  return new Promise((resolve, reject) => {
    console.log(`\n[SSH CMD] ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => {
          resolve({ code, stdout, stderr });
        })
        .on('data', (d) => (stdout += d.toString()))
        .stderr.on('data', (d) => (stderr += d.toString()));
    });
  });
}

function uploadSingleFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(localPath, (err, data) => {
      if (err) return reject(err);
      sftp.writeFile(remotePath, data, (wErr) => {
        if (wErr) {
          console.error(`Error writing ${remotePath}:`, wErr.message);
          return resolve(false);
        }
        resolve(true);
      });
    });
  });
}

async function main() {
  const conn = new Client();

  conn.on('ready', async () => {
    console.log('✅ Serverga SSH ulanish hosil qilindi!');
    console.log(`📁 Server loyiha jildi: ${remoteProjectDir}`);

    try {
      // 1. Zamoniy papkalarni serverda oldindan yaratib olamiz
      await execCommand(conn, `mkdir -p ${remoteProjectDir}/src/handlers ${remoteProjectDir}/src/services ${remoteProjectDir}/src/web ${remoteProjectDir}/assets`);

      conn.sftp(async (sftpErr, sftp) => {
        if (sftpErr) {
          console.error('SFTP Error:', sftpErr);
          conn.end();
          return;
        }

        console.log(`🚀 ${filesToUpload.length} ta fayl serverga yuklanmoqda...`);
        let count = 0;
        for (const file of filesToUpload) {
          const localFilePath = path.join(localBaseDir, file);
          const remoteFilePath = path.posix.join(remoteProjectDir, file);
          if (fs.existsSync(localFilePath)) {
            const ok = await uploadSingleFile(sftp, localFilePath, remoteFilePath);
            if (ok) {
              count++;
              console.log(`  ✓ ${file}`);
            }
          }
        }

        console.log(`✅ ${count} ta fayl serverga muvaffaqiyatli yuklandi!`);

        // Rebuild and restart docker container
        console.log('🔄 Docker container restart va rebuild qilinmoqda...');
        const dockerRes = await execCommand(
          conn,
          `cd ${remoteProjectDir} && docker compose down && docker compose up -d --build`
        );
        console.log(dockerRes.stdout);
        if (dockerRes.stderr) console.log(dockerRes.stderr);

        // Check health
        console.log("\n🏥 Server health status va container loglari tekshiruvi (3s kutilmoqda...):\n");
        await new Promise(r => setTimeout(r, 3000));
        const logs = await execCommand(conn, 'docker logs instagram-bot-1 --tail 50');
        console.log("Container Logs:\n", logs.stdout || logs.stderr);
        const health = await execCommand(conn, 'curl -s http://localhost:3015/health || curl -s https://chat.voxo.uz/health');
        console.log("Health Check:\n", health.stdout || health.stderr);

        conn.end();
        console.log('\n🎉 SERVERGA DEPLOY VA REBUILD TO\'LIQ MUVAFFAQIYATLI YAKUNLANDI!');
      });
    } catch (err) {
      console.error('Deploy xatosi:', err);
      conn.end();
    }
  });

  conn.connect(config);
}

main();
