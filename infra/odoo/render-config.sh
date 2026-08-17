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

# Odoo refuses to start on a world-readable config containing a password.
chmod 640 config/odoo.conf
echo "rendered config/odoo.conf (mode 640)"

if grep -q '__[A-Z_]*__' config/odoo.conf; then
  echo "WARNING: unsubstituted placeholders remain:" >&2
  grep -o '__[A-Z_]*__' config/odoo.conf | sort -u >&2
  exit 1
fi
