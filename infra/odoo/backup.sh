#!/usr/bin/env bash
# Nightly backup: database + filestore.
#
# Both halves are required. A pg_dump alone restores an Odoo that has lost every
# uploaded attachment, invoice PDF and product image, because those live in the
# filestore on disk, not in Postgres.
#
# Install (note the `|| true` — under `set -e`, grep exits 1 on an empty
# crontab and would abort the subshell before the echo, silently installing
# nothing):
#   ( crontab -l 2>/dev/null | grep -v backup.sh || true; \
#     echo "15 3 * * * cd /opt/prisma-erp && ./backup.sh >> /var/log/prisma-erp-backup.log 2>&1" ) | crontab -
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

DEST="${BACKUP_DIR:-/var/backups/prisma-erp}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

echo "[$(date -Is)] backup start -> $DEST"

# --- database --------------------------------------------------------------
# Custom format (-Fc) so pg_restore can do selective/parallel restores.
docker compose exec -T db \
  pg_dump -U odoo -Fc "${DB_NAME}" > "$DEST/${DB_NAME}-${STAMP}.dump"

# --- filestore -------------------------------------------------------------
docker compose exec -T odoo \
  tar -cf - -C /var/lib/odoo . > "$DEST/filestore-${STAMP}.tar"

gzip -f "$DEST/filestore-${STAMP}.tar"

# --- verify ----------------------------------------------------------------
# A backup nobody checks is a backup that silently stopped working months ago.
DUMP_SIZE=$(stat -c%s "$DEST/${DB_NAME}-${STAMP}.dump")
if [ "$DUMP_SIZE" -lt 100000 ]; then
  echo "ERROR: dump is only ${DUMP_SIZE} bytes — treating as failed" >&2
  exit 1
fi
# pg_restore must run INSIDE the db container: the host has no Postgres client
# tools, so calling it here fails on every run and reports a good dump as bad.
# No filename argument: pg_restore reads stdin. Passing `-` is NOT accepted —
# it is treated as a literal filename and errors.
docker compose exec -T db pg_restore --list < "$DEST/${DB_NAME}-${STAMP}.dump" > /dev/null 2>&1 \
  || { echo "ERROR: dump does not read back cleanly" >&2; exit 1; }

# --- retention -------------------------------------------------------------
find "$DEST" -name "${DB_NAME}-*.dump" -mtime "+${KEEP_DAYS}" -delete
find "$DEST" -name 'filestore-*.tar.gz' -mtime "+${KEEP_DAYS}" -delete

echo "[$(date -Is)] backup ok — dump $(numfmt --to=iec "$DUMP_SIZE"), keeping ${KEEP_DAYS}d"
echo "NOTE: this writes to the same VPS. Copy off-box (Hostinger snapshots are"
echo "      not a substitute — they are point-in-time and easy to overwrite)."
