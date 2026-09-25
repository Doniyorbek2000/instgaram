# Serverga joylash (production)

Arxitektura: **nginx (HTTPS) → Docker: `bot` (Node 20, root emas) + `postgres:16`**.
Kod faqat Docker image ichida; `data/` (media, suhbat arxivi) va `backups/` volume sifatida ulanadi.

## Kundalik deploy

```bash
npm run deploy                    # testlar → arxiv → build → almashtirish → /health → (xato bo'lsa) rollback
npm run deploy -- --allow-dirty   # commit qilinmagan o'zgarishlar bilan
```

Deploy nima qiladi:

1. `npm test` o'tishi shart.
2. Faqat git'dagi fayllar arxivlanadi. `.env`, `data/`, `backups/` **hech qachon** yuborilmaydi — serverdagi `.env` o'zgarmaydi.
3. Serverda joriy image `instagram-bot:rollback` deb belgilanadi, yangisi alohida papkada build qilinadi (sayt ishlab turadi).
4. Faqat `bot` konteyneri almashtiriladi (bir necha soniya).
5. `/health` 90 soniyada `ok` bo'lmasa — avtomatik oldingi image'ga qaytariladi va loglar ko'rsatiladi.

Server bilan ishlash:

```bash
npm run server status        # konteynerlar, /health, oxirgi loglar
npm run server logs 300      # bot loglari
npm run server users         # bizneslar ro'yxati
npm run server ssl-renew     # certbot sinov yangilanishi
npm run server "<buyruq>"    # ixtiyoriy buyruq
```

Lokal `.env` da: `SSH_HOST`, `SSH_USER`, `SSH_KEY_PATH` (tavsiya) yoki `SSH_PASSWORD`.

## Birinchi o'rnatish (yangi server)

```bash
# Serverda
apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
mkdir -p /opt/instagram && cd /opt/instagram
nano .env            # .env.example asosida to'ldiring
chmod 600 .env
```

`.env` da production uchun **majburiy**: `APP_SECRET`, `VERIFY_TOKEN`, `BASE_URL`, `ADMIN_HOST`,
`ADMIN_LOGIN`/`ADMIN_PASSWORD`, `DATA_ENCRYPTION_KEY` (`openssl rand -hex 32` — nusxasini xavfsiz joyda saqlang),
`PG_USER`/`PG_PASS`/`PG_DB`, `GEMINI_API_KEY`.

Keyin lokal kompyuterdan `npm run deploy`.

### nginx

Har bir domen uchun (`obunext.uz`, `adm.obunext.uz`):

```nginx
server {
    listen 80;
    server_name obunext.uz www.obunext.uz;
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3015;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
        proxy_read_timeout 120s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/obunext.uz /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d obunext.uz -d www.obunext.uz --redirect
certbot --nginx -d adm.obunext.uz --redirect
```

`Host $host` muhim: ilova admin panelni faqat `ADMIN_HOST` domenida ochadi va buni `Host` sarlavhasi bo'yicha tekshiradi.

## Zaxira nusxa

Ikki mustaqil qatlam:

| | Nima | Qayerda |
|---|---|---|
| Ilova ichida (har kuni) | Postgres jadvallari (ndjson) + `data/` arxivi | `backups/obunext-*`, shifrlangan nusxa Telegram'ga (`ADMIN_TELEGRAM_CHAT_ID`) |
| Server cron | `pg_dump` | `backups/<db>-YYYY-MM-DD.sql.gz` |

Cron (bir marta):

```bash
30 3 * * * /opt/instagram/scripts/pg_backup.sh >> /var/log/instagram-backup.log 2>&1
```

Tiklash (bot to'xtatilgan holda):

```bash
docker compose stop bot
docker compose run --rm bot node scripts/restore.mjs backups/obunext-...-db.ndjson.gz
# Telegram'dagi shifrlangan nusxa ham shu buyruq bilan ochiladi (.enc), .env'da o'sha DATA_ENCRYPTION_KEY bo'lsa
tar -xzf backups/obunext-...-files.tar.gz -C .
docker compose up -d bot
```

## Monitoring

- `GET /health` → `{"status":"ok"}` (Postgres ulanmagan bo'lsa 503) — UptimeRobot va h.k.ga shu manzilni bering.
- Kutilmagan xatolar, baza muammosi va zaxira xatosi `ADMIN_TELEGRAM_CHAT_ID` ga yuboriladi.
- `LOG_FORMAT=json` — loglar bir qatorli JSON (Loki/ELK uchun). Har bir so'rovda `X-Request-Id`.
- Docker loglari aylanadi (20 MB × 5).

## Xavfsizlik eslatmalari

- Server portini (3015) faqat `127.0.0.1` da oching — tashqariga faqat nginx.
- SSH: parol o'rniga kalit, root kirishni cheklang (`PermitRootLogin prohibit-password`).
- `DATA_ENCRYPTION_KEY` ni yo'qotmang: usiz shifrlangan tokenlarni ochib bo'lmaydi.
- CI (`.github/workflows/test.yml`): lint, testlar, `npm audit`, Docker build — har push'da.

## Cheklovlar (ma'lum)

- Ilova **bitta nusxada** ishlashga mo'ljallangan: bizneslar xotiradagi keshda turadi. Ikkinchi nusxa
  ishga tushsa, fon vazifalari Postgres qulfi tufayli ikki marta ishlamaydi, lekin ma'lumotlar keshi
  sinxron emas — gorizontal kengaytirish uchun ma'lumotlar modelini alohida jadvallarga ajratish kerak.
