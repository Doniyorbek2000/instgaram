#!/bin/sh
# Kunlik PostgreSQL zaxirasi (pg_dump) — ilova ichidagi zaxiradan (src/backup.js) mustaqil
# ikkinchi nusxa. Server cron'ida ishlaydi:
#   30 3 * * * /opt/instagram/scripts/pg_backup.sh >> /var/log/instagram-backup.log 2>&1
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/backups"
KEEP_DAYS="${KEEP_DAYS:-14}"

# PG_USER / PG_DB — .env'dan (bo'lmasa standart qiymatlar)
PG_USER=$(grep -E '^PG_USER=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- || true)
PG_DB=$(grep -E '^PG_DB=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- || true)
PG_USER="${PG_USER:-admin}"
PG_DB="${PG_DB:-admai}"
CONTAINER="${PG_CONTAINER:-instagram-postgres-1}"

mkdir -p "$DIR"
OUT="$DIR/$PG_DB-$(date +%F).sql.gz"
docker exec "$CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
find "$DIR" -name "$PG_DB-*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') — $OUT"
