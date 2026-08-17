#!/usr/bin/env bash
# Refresh staging from production — the part of Odoo.sh worth copying.
#
# Dumps the production database, restores it as the staging database, copies
# the filestore, then runs Odoo's built-in `neutralize`, which disables
# outgoing mail servers, pauses scheduled actions and forces payment providers
# into test mode.
#
# Neutralising is not optional. Staging holds real customer records; an
# un-neutralised copy will happily run a cron that emails them, or hit a live
# payment provider.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

PROD_DB="${DB_NAME:-prisma}"
STAGING_DB="${STAGING_DB_NAME:-prisma_staging}"

[ "$PROD_DB" != "$STAGING_DB" ] || { echo "prod and staging DB names are identical — refusing" >&2; exit 2; }

echo "[$(date -Is)] refreshing $STAGING_DB from $PROD_DB"

# Stop staging so nothing holds a connection to the database we are about to drop.
docker compose stop odoo-staging >/dev/null 2>&1 || true

echo "  dumping $PROD_DB"
docker compose exec -T db pg_dump -U odoo -Fc "$PROD_DB" > /tmp/prod-refresh.dump
SIZE=$(stat -c%s /tmp/prod-refresh.dump)
[ "$SIZE" -gt 100000 ] || { echo "  dump is only ${SIZE} bytes — aborting" >&2; exit 1; }

echo "  recreating $STAGING_DB"
docker compose exec -T db psql -U odoo -d postgres -q \
  -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${STAGING_DB}' and pid <> pg_backend_pid();" \
  -c "drop database if exists ${STAGING_DB};" \
  -c "create database ${STAGING_DB} owner odoo;"

echo "  restoring"
# --no-owner: the dump's grants reference roles that need not exist identically.
docker compose exec -T db pg_restore -U odoo -d "$STAGING_DB" --no-owner --clean --if-exists \
  < /tmp/prod-refresh.dump > /dev/null 2>&1 || true
rm -f /tmp/prod-refresh.dump

echo "  copying filestore"
docker compose run --rm --no-deps -T --user root odoo bash -lc "
  rm -rf /var/lib/odoo/filestore/${STAGING_DB}
  if [ -d /var/lib/odoo/filestore/${PROD_DB} ]; then
    cp -a /var/lib/odoo/filestore/${PROD_DB} /var/lib/odoo/filestore/${STAGING_DB}
    chown -R odoo:odoo /var/lib/odoo/filestore/${STAGING_DB}
  fi" >/dev/null

echo "  neutralizing (mail off, crons paused, payments to test)"
# The subcommand comes FIRST: `odoo neutralize -c ... -d ...`. Putting -c
# before it makes Odoo parse the whole thing as server arguments and fail with
# "unrecognized parameters: neutralize".
docker compose run --rm --no-deps -T odoo-staging \
  odoo neutralize -c /etc/odoo/odoo.conf -d "$STAGING_DB" 2>&1 | tail -3

docker compose start odoo-staging >/dev/null
echo "  done — $STAGING_DB is a neutralised copy of $PROD_DB"
echo "  reach it with:  ssh -L 8070:127.0.0.1:8070 prisma-erp   then http://localhost:8070"
