#!/usr/bin/env bash
# Database backup: compressed pg_dump + checksum, daily/weekly/monthly rotation, optional GPG encryption and off-site copy.
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/silverpharma ./scripts/backup.sh
#
# Optional:
#   BACKUP_GPG_RECIPIENT=key-id   encrypt the dump (keep the PRIVATE key somewhere other than the server!)
#   OFFSITE_CMD='rclone copy "$BACKUP_FILE" remote:silverpharma/'   run after each backup (the file path is in $BACKUP_FILE)
#   KEEP_DAILY_DAYS=14 KEEP_WEEKLY_DAYS=60 KEEP_MONTHLY_DAYS=400
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-14}"
KEEP_WEEKLY_DAYS="${KEEP_WEEKLY_DAYS:-60}"
KEEP_MONTHLY_DAYS="${KEEP_MONTHLY_DAYS:-400}"

umask 077
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/daily/silverpharma-$ts.dump"

pg_dump --dbname "$DATABASE_URL" --format=custom --no-owner --compress=6 --file "$file"
pg_restore --list "$file" > /dev/null          # the archive must be readable, or the backup is worthless
sha256sum "$file" > "$file.sha256"

if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$file.gpg" "$file"
  sha256sum "$file.gpg" > "$file.gpg.sha256"
  rm -f "$file" "$file.sha256"
  file="$file.gpg"
fi

[ "$(date -u +%u)" = "7" ]  && cp "$file" "$file.sha256" "$BACKUP_DIR/weekly/"  2>/dev/null || true
[ "$(date -u +%d)" = "01" ] && cp "$file" "$file.sha256" "$BACKUP_DIR/monthly/" 2>/dev/null || true

find "$BACKUP_DIR/daily"   -type f -mtime +"$KEEP_DAILY_DAYS"   -delete
find "$BACKUP_DIR/weekly"  -type f -mtime +"$KEEP_WEEKLY_DAYS"  -delete
find "$BACKUP_DIR/monthly" -type f -mtime +"$KEEP_MONTHLY_DAYS" -delete

if [ -n "${OFFSITE_CMD:-}" ]; then
  BACKUP_FILE="$file" bash -c "$OFFSITE_CMD"
fi
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
