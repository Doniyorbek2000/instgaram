import "dotenv/config";
import { Client } from 'ssh2';

const SSH_HOST = process.env.SSH_HOST;
const SSH_USER = process.env.SSH_USER || 'root';
const SSH_PASSWORD = process.env.SSH_PASSWORD;
if (!SSH_HOST || !SSH_PASSWORD) {
  console.error("❌ .env da SSH_HOST va SSH_PASSWORD to'ldirilmagan (.env.example ga qarang).");
  process.exit(1);
}

const conn = new Client();
conn.on('ready', async () => {
  console.log('✅ SSH ulandi\n');

  const run = (cmd) => new Promise((resolve) => {
    console.log(`\n[CMD] ${cmd}`);
    conn.exec(cmd, (err, stream) => {
      if (err) { console.error(err); return resolve(''); }
      let out = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => out += d);
      stream.on('close', () => { console.log(out.trim()); resolve(out); });
    });
  });

  // 3015 portida tinglayotgan barcha containerlarni to'xtatish
  await run('docker ps -q --filter "publish=3015" | xargs -r docker stop');
  await run('docker ps -a -q --filter "publish=3015" | xargs -r docker rm -f');

  // /opt/instagram loyihasi containerlarini tozalash
  await run('cd /opt/instagram && docker compose down --remove-orphans 2>&1 || true');

  // Bir oz kutib yangi container ishga tushiramiz
  await new Promise(r => setTimeout(r, 2000));

  // Qayta ishga tushirish
  await run('cd /opt/instagram && docker compose up -d --build 2>&1');

  // 4 soniya kutib health check
  await new Promise(r => setTimeout(r, 4000));
  await run('docker logs instagram-bot-1 --tail 20 2>&1 || docker logs instagram-bot-bot-1 --tail 20 2>&1');
  await run('curl -s http://127.0.0.1:3015/health');

  conn.end();
  console.log('\n✅ Tugadi!');
}).connect({
  host: SSH_HOST,
  port: 22,
  username: SSH_USER,
  password: SSH_PASSWORD,
});
