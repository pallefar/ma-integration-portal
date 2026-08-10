#!/bin/bash
# Double-clickable REAL-DEAL launcher for macOS / Linux.
#
# Unlike start.command (the demo showcase launcher), this launcher does NOT set
# DEMO_OPEN, so the server stays FAIL-CLOSED: every /api request requires a real
# authenticated session. Use this launcher — never start.command — for any host
# that will hold real acquisition data (MNPI). See DEPLOYMENT.md.
cd "$(dirname "$0")" || exit 1

NODE_CMD="node"
[ -x "./node/bin/node" ] && NODE_CMD="./node/bin/node"

if ! "$NODE_CMD" -v >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org/ and run this again."
  (command -v open >/dev/null && open "https://nodejs.org/en/download") 2>/dev/null
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if [ ! -d "./node_modules" ]; then
  echo "First run: installing dependencies (one time)..."
  npm install --omit=dev
fi

# [security] First-run credential rotation. The demo ships a published default
# admin password (public/login.html). A real-deal host MUST rotate it before the
# first login — run this once, then restart with this launcher:
echo ""
echo "  ────────────────────────────────────────────────────────────────"
echo "  REAL-DEAL MODE (authentication REQUIRED — fail-closed)."
echo "  Before the first login, set a private admin password:"
echo "      $NODE_CMD scripts/set-admin-password.js"
echo "  Do NOT use the published demo password on a real-deal host."
echo "  ────────────────────────────────────────────────────────────────"
echo ""
echo "  Starting the TE Connectivity M&A Integration Portal ..."
echo "  Opening http://localhost:3000 - keep this window open; close it to stop the server."

( sleep 3; (command -v open >/dev/null && open "http://localhost:3000") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:3000") ) >/dev/null 2>&1 &

# NOTE: DEMO_OPEN is deliberately NOT set here. Auth stays mandatory.
exec "$NODE_CMD" server.js
