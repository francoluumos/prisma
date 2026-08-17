#!/usr/bin/env bash
# Poll both branches and deploy whichever moved. Runs from cron every 2 min.
#
#   */2 * * * * cd /opt/prisma-erp && ./poll.sh >> /var/log/prisma-erp-deploy.log 2>&1
#
# deploy.sh exits immediately when a branch head is unchanged, so the steady
# state is two cheap `git fetch`es and nothing else. Staging first: if a change
# is going to break, it should break there while production is still serving.
set -uo pipefail

cd "$(dirname "$0")"

# A stuck deploy must not stack up behind the timer.
exec 9>/tmp/prisma-erp-deploy.lock
flock -n 9 || exit 0

for BRANCH in staging main; do
  if ! ./deploy.sh "$BRANCH"; then
    echo "[$(date -Is)] deploy of $BRANCH FAILED (exit $?)" >&2
    # Keep going: a broken staging must not block a production hotfix.
  fi
done
