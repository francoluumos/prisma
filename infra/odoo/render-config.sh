#!/usr/bin/env bash
# Render odoo.conf.template -> config/odoo.conf, substituting secrets from .env.
#
# Odoo's config file has no environment-variable interpolation, so the choice is
# either committing secrets or templating. This templates.
set -euo pipefail

cd "$(dirname "$0")"

[ -f .env ] || { echo "no .env — copy .env.example and fill it in" >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${ADMIN_PASSWD:?set ADMIN_PASSWD in .env}"
: "${DB_PASSWORD:?set DB_PASSWORD in .env}"
: "${DB_NAME:?set DB_NAME in .env}"

mkdir -p config
# `|` as the sed delimiter: generated passwords routinely contain `/`.
sed -e "s|__ADMIN_PASSWD__|${ADMIN_PASSWD}|g" \
    -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
    -e "s|__DB_NAME__|${DB_NAME}|g" \
    odoo.conf.template > config/odoo.conf

# The file holds two passwords, so it must not be world-readable. But it is
# bind-mounted into a container that runs as uid 100 / gid 101 (`odoo`), and a
# root-owned 0640 file is unreadable there — Odoo then parses an empty config
# and dies with `NoSectionError: 'options'`, which reads like a syntax error
# rather than a permission one. Group-own it to the container's gid so 0640
# satisfies both constraints.
ODOO_UID=100
ODOO_GID=101
chmod 640 config/odoo.conf
if [ "$(id -u)" -eq 0 ]; then
  chown "root:${ODOO_GID}" config/odoo.conf
  echo "rendered config/odoo.conf (mode 640, group ${ODOO_GID} so the container can read it)"
else
  echo "rendered config/odoo.conf (mode 640)"
  echo "NOTE: not root, so group ownership was left alone. If Odoo reports" >&2
  echo "      NoSectionError: 'options', run: sudo chown root:${ODOO_GID} config/odoo.conf" >&2
fi

if grep -q '__[A-Z_]*__' config/odoo.conf; then
  echo "WARNING: unsubstituted placeholders remain:" >&2
  grep -o '__[A-Z_]*__' config/odoo.conf | sort -u >&2
  exit 1
fi
