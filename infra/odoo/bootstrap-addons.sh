#!/usr/bin/env bash
# One-time setup of the custom-addons clone and its two worktrees.
#
#   addons-repo/     bare-ish clone, the only thing that talks to GitHub
#   addons/main/     worktree on `main`    -> mounted into the odoo service
#   addons/staging/  worktree on `staging` -> mounted into odoo-staging
#
# Worktrees rather than two clones: one fetch updates both, and the branches
# cannot silently drift onto the same commit.
set -euo pipefail

cd "$(dirname "$0")"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${ADDONS_REPO:?set ADDONS_REPO in .env (e.g. git@github.com:<owner>/prisma-odoo.git)}"

if [ ! -d addons-repo/.git ]; then
  echo "cloning $ADDONS_REPO"
  git clone --quiet "$ADDONS_REPO" addons-repo
else
  echo "clone exists — fetching"
  git -C addons-repo fetch --quiet --all --prune
fi

# A fresh clone has `main` checked out, and git refuses to hand the same branch
# to a worktree ("'main' is already used by worktree at ..."). Detach the
# clone's HEAD so it holds no branch and both worktrees can take one.
git -C addons-repo checkout --quiet --detach HEAD

mkdir -p addons
for BRANCH in main staging; do
  WT="addons/$BRANCH"
  if [ -d "$WT/.git" ] || [ -f "$WT/.git" ]; then
    echo "worktree $WT exists"
    continue
  fi
  rm -rf "$WT"
  git -C addons-repo worktree add --quiet -B "$BRANCH" "$PWD/$WT" "origin/$BRANCH"
  echo "worktree $WT -> origin/$BRANCH"
done

# Odoo reads these as uid 100; the clone is owned by root.
chmod -R a+rX addons addons-repo

echo
echo "worktrees:"
git -C addons-repo worktree list
