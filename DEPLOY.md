# Serverga joylash (production)

## Variant 1 — Docker (tavsiya etiladi)

Talab: server (VPS), Docker + Docker Compose o'rnatilgan, domen.

```bash
git clone <repo> && cd In-adm
cp .env.example .env    # to'ldiring (SETUP.md ga qarang)
docker compose up -d --build
```

- Server 3000-portda ishlaydi. `data/` papka volume sifatida ulanadi — konteyner o'chsa ham ma'lumotlar saqlanadi.
- Loglar: `docker compose logs -f`
- Yangilash: `git pull && docker compose up -d --build`
- To'xtatish: `docker compose down` (ma'lumotlar `data/` da qoladi)

## Variant 2 — To'g'ridan-to'g'ri (Node + PM2)

```bash
npm ci --omit=dev
npm install -g pm2
pm2 start src/index.js --name ai-bot
pm2 save && pm2 startup    # server qayta yuklanganda avtomatik ishga tushadi
```

## HTTPS va domen

Meta webhook uchun HTTPS **shart**. Eng oson yo'l — Nginx + Certbot (Let's Encrypt):

```nginx
server {
  server_name bot.example.uz;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

```bash
sudo certbot --nginx -d bot.example.uz
```

So'ng `.env` da `BASE_URL=https://bot.example.uz` qiling.

## Zaxira nusxa (backup)

Ma'lumotlar `data/db.json` da. Kunlik avtomatik zaxira uchun cron:

```bash
crontab -e
# quyidagini qo'shing (har kuni soat 3:00 da):
0 3 * * * /yo'l/In-adm/scripts/backup.sh >> /var/log/bot-backup.log 2>&1
```

Zaxiralar `backups/` papkada, oxirgi 30 tasi saqlanadi.

## Monitoring

- `GET /health` → `{"status":"ok"}` — uptime xizmatlariga (UptimeRobot va h.k.) shu manzilni bering.
- Docker healthcheck avtomatik ishlaydi (`docker ps` da holat ko'rinadi).

## Xavfsizlik eslatmalari

- `.env` va `data/` ni hech qachon git'ga qo'ymang (`.gitignore` da bor).
- Server portini (3000) faqat Nginx orqali oching, tashqariga to'g'ridan-to'g'ri chiqarmang.
- Muntazam yangilab turing: `npm audit` va `git pull`.
- Ko'p yuk (minglab biznes) bo'lsa — JSON bazadan PostgreSQL'ga o'tishni rejalashtiring.
