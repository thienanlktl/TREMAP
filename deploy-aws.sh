#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
HOST="${HOST:-0.0.0.0}"

echo "============================================"
echo " Plan 193 Truss Viewer — AWS / Linux deploy"
echo "============================================"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node 18+ first, e.g.:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt-get install -y nodejs"
  exit 1
fi

echo ""
echo "Installing dependencies..."
npm install --omit=dev 2>/dev/null || npm install

echo ""
echo "Building production package..."
node ./scripts/build-data.js
node ./node_modules/vite/bin/vite.js build
node ./scripts/prepare-deploy.js

echo ""
echo "Starting server on ${HOST}:${PORT}"
echo "Open in browser: http://<ec2-public-ip>:${PORT}/"
echo "Press Ctrl+C to stop."
echo ""

PORT="$PORT" HOST="$HOST" node ./scripts/serve-production.js
