#!/usr/bin/env bash
#
# release-public.sh — build a release using FREE public-repo GitHub minutes,
# then flip the repo back to private.
#
# Why: public repositories get unlimited GitHub-hosted Actions minutes. If your
# private-repo minute quota is exhausted (on both accounts), this temporarily
# makes the repo public so release.yml can build, then restores private.
#
# CAUTION: while the repo is public, anyone can view/clone its code. The repo is
# only public for the duration of the build; a trap always restores it.
#
# Usage:
#   GH_TOKEN=<PAT with repo admin + contents:write> ./scripts/release-public.sh
# Optional env:
#   REPO=Itsnishant4/woxus-agent   (default)
#   TAG=v0.1.2                     (default)

set -euo pipefail

REPO="${REPO:-Itsnishant4/woxus-agent}"
TAG="${TAG:-v0.1.2}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

if [ -z "$TOKEN" ]; then
  # Fall back to the stored GitHub credential
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
  echo "Making $REPO private again..."
  api PATCH "https://api.github.com/repos/$REPO" '{"visibility":"private"}' >/dev/null 2>&1 \
    && echo "OK — repo is private." || echo "WARN: could not restore private (do it manually)."
}
trap restore_private EXIT

# 1) set public
echo "Making $REPO public (build will use free public minutes)..."
api PATCH "https://api.github.com/repos/$REPO" '{"visibility":"public"}' >/dev/null
echo "public: OK"

# 2) push the tag to trigger release.yml
git fetch origin --tags --force >/dev/null 2>&1 || true
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  git tag -f "$TAG"
else
  git tag "$TAG"
fi
git push origin "refs/tags/$TAG" --force
echo "tag $TAG pushed -> release workflow triggered"

# 3) wait for the release run to appear
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID=$(api GET "https://api.github.com/repos/$REPO/actions/workflows/release.yml/runs?event=push&per_page=1" \
    | python3 -c "import sys,json; rs=json.load(sys.stdin).get('workflow_runs',[]); print(rs[0]['id'] if rs else '')" 2>/dev/null || true)
  [ -n "$RUN_ID" ] && break
  sleep 5
done
[ -n "$RUN_ID" ] || { echo "ERROR: no release run appeared."; exit 1; }
echo "release run: $RUN_ID"

# 4) poll until the run completes
while :; do
  READ=$(api GET "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'], d.get('conclusion') or '')" 2>/dev/null || true)
  STATE=${READ%% *}; CONCL=${READ##* }
  echo "  status=$STATE conclusion=$CONCL"
  [ "$STATE" = "completed" ] && break
  sleep 30
done

echo "Release run finished: ${CONCL:-unknown}"
echo "(repo visibility restored to private by trap)"
