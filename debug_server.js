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
conn.on('ready', () => {
  const cmd = [
    'docker ps -a',
    'echo "=PORT="',
    'ss -tlnp | grep 3015 || echo "3015 port topilmadi"',
    'echo "=LOGS="',
    'docker logs instagram-bot-bot-1 --tail 30 2>&1',
    'echo "=CURL="',
    'curl -sv http://127.0.0.1:3015/health 2>&1 | tail -5',
  ].join(' && ');

  conn.exec(cmd, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.stderr.on('data', d => out += d);
    stream.on('close', () => {
      console.log(out);
      conn.end();
    });
  });
}).connect({
  host: SSH_HOST,
  port: 22,
  username: SSH_USER,
  password: SSH_PASSWORD,
});
