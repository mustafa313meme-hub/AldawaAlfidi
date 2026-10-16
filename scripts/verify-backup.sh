#!/usr/bin/env bash
# Restore drill: restore a backup into a THROWAWAY database, run the integrity checks, drop it.
# A backup that was never restored is not a backup. Run this monthly (see docs/RUNBOOK.md).
#
#   export PGHOST=... PGPORT=5432 PGUSER=<role allowed to CREATE DATABASE> PGPASSWORD=...
#   ./scripts/verify-backup.sh backups/daily/silverpharma-XXXX.dump
set -euo pipefail

file="${1:-}"
[ -f "$file" ] || { echo "usage: $0 <backup.dump>"; exit 2; }
db="verify_$(date -u +%Y%m%d%H%M%S)"
here="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$file.sha256" ]; then (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256"); fi
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT

start=$(date +%s)
pg_restore --dbname "$db" --no-owner --exit-on-error "$file"
psql --dbname "$db" -v ON_ERROR_STOP=1 -f "$here/verify-restore.sql"
echo "restore drill ok in $(( $(date +%s) - start ))s  <- record this: it is your measured RTO for the database part"
