#!/bin/bash
# Dumps the production Postgres database to a gzipped file.
#
# Postgres data lives in a named Docker volume (pgdata), not a host bind
# mount, so this runs pg_dump THROUGH the running db container rather than
# reading files directly off the volume.
#
# Usage:
#   ./backup-db.sh                          # routine backup: backups/daily-YYYYMMDD.sql.gz
#   ./backup-db.sh --label manual-baseline-20260830
#                                            # one-off, never auto-pruned: backups/manual-baseline-20260830.sql.gz
#
# Routine (daily-*) backups older than KEEP_DAYS are pruned after each run.
# Anything not matching the daily-*.sql.gz pattern (e.g. manual-* labels) is
# never touched by pruning.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$REPO_DIR/backups"
KEEP_DAYS=14
DB_USER="${POSTGRES_USER:-srs_user}"
DB_NAME="vanilla_class_srs"

LABEL=""
if [[ "${1:-}" == "--label" ]]; then
  LABEL="${2:?--label requires a value}"
fi

mkdir -p "$BACKUP_DIR"

if [[ -n "$LABEL" ]]; then
  OUT_FILE="$BACKUP_DIR/${LABEL}.sql.gz"
else
  # Filename date is always Shanghai-local, independent of the host's own
  # system timezone (the production host runs UTC; the app's TZ=Asia/Shanghai
  # is only set inside the Docker containers, not on the bare host running
  # this script via cron) — so a backup taken at 4am Shanghai always gets
  # that Shanghai calendar date, not the UTC date at the moment it ran.
  OUT_FILE="$BACKUP_DIR/daily-$(TZ=Asia/Shanghai date +%Y%m%d).sql.gz"
fi

cd "$REPO_DIR"
docker-compose exec -T db pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$OUT_FILE"

# Sanity check: a valid dump is never empty, and gzip -t catches truncation.
if [[ ! -s "$OUT_FILE" ]] || ! gzip -t "$OUT_FILE" 2>/dev/null; then
  echo "backup-db.sh: FAILED — $OUT_FILE is missing, empty, or corrupt" >&2
  exit 1
fi

echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

if [[ -z "$LABEL" ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -name 'daily-*.sql.gz' -mtime "+$KEEP_DAYS" -print -delete
fi
