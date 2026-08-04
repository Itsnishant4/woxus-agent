#!/usr/bin/env bash
#
# release-public.sh — one-shot release builder for a repo whose private
# GitHub-hosted Actions minutes are exhausted.
#
# It temporarily makes the repo PUBLIC (public repos get unlimited free
# GitHub-hosted minutes), pushes the release tag to trigger release.yml, waits
# for the run to finish, then restores the repo to PRIVATE. A trap guarantees
# the repo is made private again even if the build fails or you Ctrl-C.
#
# CAUTION: the repo is public (viewable/cloneable by anyone) for the whole
# build. Only run this when you accept that window.
#
# Usage:
#   GH_TOKEN=<PAT with repo admin + contents:write> ./scripts/release-public.sh
# Optional env:
#   REPO=Itsnishant4/woxus-agent   (default — the MAIN repo)
#   TAG=v0.1.2                     (default)

set -euo pipefail

REPO="${REPO:-Itsnishant4/woxus-agent}"
TAG="${TAG:-v0.1.2}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

if [ -z "$TOKEN" ]; then
  TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
fi
[ -n "$TOKEN" ] || { echo "ERROR: set GH_TOKEN (PAT with repo admin + contents:write)."; exit 1; }

api() { # method path [data]
  local m="$1" u="$2" d="${3:-}"
  if [ -n "$d" ]; then
    curl -fsS -X "$m" -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$u" -d "$d"
  else
    curl -fsS -X "$m" -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$u"
  fi
}

restore_private() {
  echo
  echo "Restoring $REPO to private..."
  api PATCH "https://api.github.com/repos/$REPO" '{"visibility":"private"}' >/dev/null 2>&1 \
    && echo "OK — repo is private." || echo "WARN: could not restore private (do it manually)."
}
trap restore_private EXIT

# 1) public
echo "1) Making $REPO public (free public minutes)..."
api PATCH "https://api.github.com/repos/$REPO" '{"visibility":"public"}' >/dev/null
echo "   public: OK"

# 2) point the tag at current main and push it to trigger release.yml
echo "2) Tagging $TAG at $(git rev-parse --short HEAD) and pushing..."
git tag -f "$TAG" HEAD
git push origin "refs/tags/$TAG" --force
echo "   tag pushed -> release workflow triggered"

# 3) wait for the release run
echo "3) Waiting for release run..."
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID=$(api GET "https://api.github.com/repos/$REPO/actions/workflows/release.yml/runs?event=push&per_page=1" \
    | python3 -c "import sys,json; rs=json.load(sys.stdin).get('workflow_runs',[]); print(rs[0]['id'] if rs else '')" 2>/dev/null || true)
  [ -n "$RUN_ID" ] && break
  sleep 5
done
[ -n "$RUN_ID" ] || { echo "ERROR: no release run appeared."; exit 1; }
echo "   run: $RUN_ID"

# 4) poll until complete
while :; do
  READ=$(api GET "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d.get('conclusion') or '')" 2>/dev/null || true)
  STATE=${READ%% *}; CONCL=${READ##* }
  echo "   status=$STATE conclusion=$CONCL"
  [ "$STATE" = "completed" ] && break
  sleep 30
done

echo
echo "Release finished: ${CONCL:-unknown}"
echo "(repo visibility restored to private by the trap.)"
