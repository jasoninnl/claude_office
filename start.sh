#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Office Allocation Optimizer ==="

# Backend
echo "[1/3] Installing backend deps..."
pip install -r "$ROOT/backend/requirements.txt" -q

echo "[2/3] Seeding database (if first run)..."
cd "$ROOT/backend"
if [ ! -f office.db ]; then
  python seed.py
fi

echo "[3/3] Starting backend (port 8000) and frontend dev server (port 5173)..."
cd "$ROOT/backend"
uvicorn main:app --port 8000 &
BACKEND_PID=$!

cd "$ROOT/frontend"
npm install -q
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM
wait
