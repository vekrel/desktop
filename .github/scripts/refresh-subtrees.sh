#!/usr/bin/env bash
# Nightly only: pulls apps/server, apps/web and packages/ from the given commits
# of vekrel/engine, vekrel/web and vekrel/shared into this checkout with the
# README's subtree split + pull --squash, so local deviations merge instead of
# being overwritten. Commits stay local; nothing is pushed.
# Usage: refresh-subtrees.sh <engine-sha> <web-sha> <shared-sha>
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <engine-sha> <web-sha> <shared-sha>" >&2
  exit 2
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
work="$(mktemp -d)"

refresh() {
  local repo="$1" sha="$2" prefix="$3"
  git clone --quiet --no-checkout "https://github.com/vekrel/${repo}.git" "$work/$repo"
  git -C "$work/$repo" subtree split --quiet --prefix="$prefix" "$sha" -b nightly-split >/dev/null
  git subtree pull --prefix="$prefix" "$work/$repo" nightly-split --squash \
    -m "Nightly: ${prefix} from vekrel/${repo}@${sha:0:12}"
}

refresh engine "$1" apps/server
refresh web "$2" apps/web
refresh shared "$3" packages
git log --oneline -n 6
