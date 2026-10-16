#!/usr/bin/env bash
# Restore a dump into a database. DESTRUCTIVE for the target: it replaces what is there.
#
#   TARGET_DATABASE_URL=postgresql://... ./scripts/restore.sh backups/daily/silverpharma-XXXX.dump --yes-i-am-sure
#
# For an encrypted file (.gpg) decrypt first:  gpg --decrypt file.dump.gpg > file.dump
set -euo pipefail

file="${1:-}"
confirm="${2:-}"
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"
[ -f "$file" ] || { echo "usage: $0 <backup.dump> --yes-i-am-sure"; exit 2; }
[ "$confirm" = "--yes-i-am-sure" ] || { echo "refusing: this overwrites $TARGET_DATABASE_URL. Add --yes-i-am-sure"; exit 2; }

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256")   # corrupted file => stop here
fi

pg_restore --dbname "$TARGET_DATABASE_URL" --clean --if-exists --no-owner --exit-on-error "$file"
echo "restore finished. Now run scripts/verify-restore.sql against it, then GET /api/v1/inventory/reconcile and /accounting/reconcile."
