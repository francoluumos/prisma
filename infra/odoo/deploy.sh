#!/usr/bin/env bash
# Deploy a branch of the custom-addons repo to its environment.
#
#   ./deploy.sh main       -> production  (db: prisma,         service: odoo)
#   ./deploy.sh staging    -> staging     (db: prisma_staging, service: odoo-staging)
#
# Pull-based by design. The firewall admits SSH only from Franco's IP, so a
# push-based deploy (GitHub Actions over SSH) would mean opening port 22 to
# GitHub's whole IP range. Polling needs no inbound access, and keeps working
# when GitHub's webhook delivery is degraded.
#
# Idempotent: if the branch head has not moved, it exits without touching the
# running instance. poll.sh calls it on a timer for exactly that reason.
set -euo pipefail

BRANCH="${1:?usage: deploy.sh <main|staging> [--force]}"
FORCE="${2:-}"

cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

case "$BRANCH" in
  main)    WORKTREE="addons/main";    SERVICE="odoo";         DB="${DB_NAME:-prisma}" ;;
  staging) WORKTREE="addons/staging"; SERVICE="odoo-staging"; DB="${STAGING_DB_NAME:-prisma_staging}" ;;
  *) echo "unknown branch: $BRANCH (expected main or staging)" >&2; exit 2 ;;
esac

REPO_DIR="addons-repo"
[ -d "$REPO_DIR/.git" ] || { echo "no clone at $REPO_DIR — run bootstrap-addons.sh first" >&2; exit 1; }

git -C "$REPO_DIR" fetch --quiet origin "$BRANCH"
REMOTE=$(git -C "$REPO_DIR" rev-parse "origin/$BRANCH")
CURRENT=$(git -C "$WORKTREE" rev-parse HEAD 2>/dev/null || echo "none")

if [ "$REMOTE" = "$CURRENT" ] && [ "$FORCE" != "--force" ]; then
  exit 0   # nothing to do — the common case on a 2-minute timer
fi

echo "[$(date -Is)] $BRANCH: ${CURRENT:0:8} -> ${REMOTE:0:8}"

# Which modules changed? On a first deploy, take everything in the tree.
if [ "$CURRENT" = "none" ]; then
  git -C "$REPO_DIR" worktree add --quiet -f "$PWD/$WORKTREE" "$BRANCH" 2>/dev/null \
    || git -C "$REPO_DIR" worktree add --quiet -f -B "$BRANCH" "$PWD/$WORKTREE" "origin/$BRANCH"
  MODULES=$(find "$WORKTREE" -maxdepth 2 -name "__manifest__.py" -exec dirname {} \; \
            | xargs -r -n1 basename | sort -u | paste -sd, -)
else
  CHANGED=$(git -C "$REPO_DIR" diff --name-only "$CURRENT" "$REMOTE" || true)
  MODULES=$(echo "$CHANGED" | awk -F/ 'NF>1 {print $1}' | sort -u | paste -sd, -)
fi

git -C "$WORKTREE" fetch --quiet origin "$BRANCH"
git -C "$WORKTREE" reset --hard --quiet "origin/$BRANCH"

if [ -z "$MODULES" ]; then
  echo "  no module directories touched — restarting only"
  docker compose restart "$SERVICE" >/dev/null
  echo "  done"
  exit 0
fi

echo "  upgrading: $MODULES"
# Update the module list first, or a brand-new module is invisible to -u.
docker compose run --rm --no-deps -T "$SERVICE" \
  odoo -c /etc/odoo/odoo.conf -d "$DB" -u "$MODULES" --stop-after-init 2>&1 \
  | grep -iE "error|traceback|loaded .* modules|Modules loaded" | tail -5 || true

docker compose restart "$SERVICE" >/dev/null
echo "  deployed $BRANCH @ ${REMOTE:0:8}"
