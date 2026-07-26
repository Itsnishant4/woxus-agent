#!/bin/bash
# Start backend + Electron frontend together (Mac/Linux only)
# Windows users: run `node dev.js`

WOXUS_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting Woxus backend..."
source "$WOXUS_DIR/backend/.venv/bin/activate"
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

cleanup() {
  echo "Shutting down..."
  kill $BACKEND_PID 2>/dev/null
  wait $BACKEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting Woxus Electron app..."
cd "$WOXUS_DIR/frontend" && npm run electron:dev

cleanup
