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
  readyTimeout: 60000,
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
  'rules.json',
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

import { execSync } from 'node:child_process';

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

  conn.on('error', (err) => {
    console.error('❌ SSH ulanish xatosi:', err.message);
  });

  conn.on('ready', async () => {
    console.log('✅ Serverga SSH ulanish hosil qilindi!');
    console.log(`📁 Server loyiha jildi: ${remoteProjectDir}`);

    const bundleName = 'deploy_bundle.tar.gz';
    const localBundlePath = path.join(localBaseDir, bundleName);
    const remoteBundlePath = path.posix.join(remoteProjectDir, bundleName);

    try {
      console.log('📦 Loyiha fayllari bitta arxivga yig\'ilmoqda...');
      execSync(`tar -czf "${bundleName}" package.json package-lock.json rules.json APP_REVIEW.md DEPLOY.md README.md SETUP.md business.md assets .env docker-compose.yml src scripts`, {
        cwd: localBaseDir,
        stdio: 'inherit'
      });

      await execCommand(conn, `mkdir -p ${remoteProjectDir}`);

      conn.sftp(async (sftpErr, sftp) => {
        if (sftpErr) {
          console.error('SFTP Error:', sftpErr);
          conn.end();
          return;
        }

        console.log(`🚀 Arxiv serverga yuklanmoqda (${bundleName})...`);
        const uploaded = await uploadSingleFile(sftp, localBundlePath, remoteBundlePath);
        if (!uploaded) {
          console.error('Arxivni serverga yuklashda xatolik yuz berdi.');
          conn.end();
          return;
        }
        console.log('✅ Arxiv serverga muvaffaqiyatli yuklandi!');

        // Arxivni serverda ochish va tozalash
        console.log('📂 Serverda fayllar ochilmoqda...');
        await execCommand(conn, `tar -xzf ${remoteBundlePath} -C ${remoteProjectDir} && rm -f ${remoteBundlePath}`);

        // Lokal arxivni tozalash
        if (fs.existsSync(localBundlePath)) {
          fs.unlinkSync(localBundlePath);
        }

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
        const health = await execCommand(conn, 'curl -s http://localhost:3015/health');
        console.log("Health Check (localhost:3015):\n", health.stdout || health.stderr);

        // Setup Nginx for obunext.uz & adm.obunext.uz (preserve SSL if already configured)
        console.log("\n🌐 obunext.uz va adm.obunext.uz uchun Nginx sozlanmoqda...");
        const nginxSetupCmd = `if grep -q "ssl_certificate" /etc/nginx/sites-available/obunext.uz 2>/dev/null; then
    echo "✅ obunext.uz SSL allaqachon sozlangan."
else
    cat << 'EOF' > /etc/nginx/sites-available/obunext.uz
server {
    listen 80;
    listen [::]:80;
    server_name obunext.uz www.obunext.uz;

    client_max_body_size 25m;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3015;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/obunext.uz /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    certbot --nginx -d obunext.uz -d www.obunext.uz --non-interactive --agree-tos -m doniyorbekabdujabborov45@gmail.com --redirect
fi

if grep -q "ssl_certificate" /etc/nginx/sites-available/adm.obunext.uz 2>/dev/null; then
    echo "✅ adm.obunext.uz SSL allaqachon sozlangan."
else
    cat << 'EOF' > /etc/nginx/sites-available/adm.obunext.uz
server {
    listen 80;
    listen [::]:80;
    server_name adm.obunext.uz;

    client_max_body_size 25m;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:3015;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/adm.obunext.uz /etc/nginx/sites-enabled/
    nginx -t && systemctl reload nginx
    certbot --nginx -d adm.obunext.uz --non-interactive --agree-tos -m doniyorbekabdujabborov45@gmail.com --redirect
fi

nginx -t && systemctl reload nginx
`;
        const nginxSetupRes = await execCommand(conn, nginxSetupCmd);
        console.log("Nginx Setup:\n", nginxSetupRes.stdout || nginxSetupRes.stderr);

        conn.end();
        console.log('\n🎉 SERVERGA DEPLOY VA REBUILD TO\'LIQ MUVAFFAQIYATLI YAKUNLANDI!');
      });
    } catch (err) {
      if (fs.existsSync(localBundlePath)) {
        try { fs.unlinkSync(localBundlePath); } catch (_) {}
      }
      console.error('Deploy xatosi:', err);
      conn.end();
    }
  });

  conn.connect(config);
}

main();
