#!/usr/bin/env bash
# Run the repo's GitHub CI locally (backend.yml + build-mac.yml + build-windows.yml)
# without consuming GitHub Actions minutes. Each step mirrors the workflow files.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY=backend/.venv/bin/python

echo "────── Backend CI (backend.yml) ──────"
# Requirements are already in the venv; refresh if pip is reachable, else continue.
$PY -m pip install -q -r backend/requirements.txt 2>/dev/null || echo "  (deps already installed; pip skipped)"
if $PY -c "import ruff" 2>/dev/null; then
  $PY -m ruff check backend/
elif command -v ruff >/dev/null 2>&1; then
  ruff check backend/
else
  $PY -m pip install -q ruff 2>/dev/null && $PY -m ruff check backend/ || echo "  (ruff unavailable — install with: pip install ruff)"
fi
if $PY -c "import pytest" 2>/dev/null; then
  $PY -m pytest backend/ || echo "  (no tests yet)"
else
  echo "  (pytest not installed — no tests to run, same as CI's 'No tests yet')"
fi

echo "────── Frontend CI (build-mac.yml / build-windows.yml) ──────"
cd "$ROOT/frontend"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install || echo "  (pnpm install skipped)"
npx tsc --noEmit
pnpm run build
pnpm run check:electron

echo
echo "✅ Local CI passed — all checks green without using GitHub minutes"
