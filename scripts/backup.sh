#!/usr/bin/env bash
# Ma'lumotlar bazasini (data/db.json) zaxira nusxalaydi.
# Cron bilan kunlik ishga tushiring, masalan:
#   0 3 * * * /app/scripts/backup.sh >> /var/log/bot-backup.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/data/db.json"
DIR="$ROOT/backups"
KEEP=30 # oxirgi 30 nusxani saqlaymiz

if [ ! -f "$SRC" ]; then
  echo "$(date '+%F %T') — db.json topilmadi, o'tkazib yuborildi"
  exit 0
fi

mkdir -p "$DIR"
STAMP="$(date '+%Y%m%d-%H%M%S')"
cp "$SRC" "$DIR/db-$STAMP.json"
echo "$(date '+%F %T') — zaxira: db-$STAMP.json"

# Eski nusxalarni tozalash
ls -1t "$DIR"/db-*.json 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
