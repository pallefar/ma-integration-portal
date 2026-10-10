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

# [security] Real-deal mode (D-10-01). MA_MODE=real makes the server use its OWN
# gitignored data directory (data/real, or MA_DATA_DIR) seeded WITHOUT the
# published demo accounts, and refuse to ever open the committed data/*.db files.
# Without this line the server would run in dev mode on the committed control.db.
export MA_MODE=real
# [security] IN-C01: the launcher also CLEARS any DEMO_OPEN inherited from the
# shell or a profile (`export DEMO_OPEN=1` in ~/.zshrc after a demo session).
# The server refuses MA_MODE=real + DEMO_OPEN=1 at boot (fail-closed), but the
# browser timer below would still open a dead tab with the error hidden behind
# it — clearing it here means a real-deal host simply starts, auth mandatory.
unset DEMO_OPEN

# [security] First-run bootstrap (D-10-02). A real-deal host starts with ZERO
# accounts — there is no published password to rotate. Create the first admin
# once, on this host, then start this launcher:
echo ""
echo "  ────────────────────────────────────────────────────────────────"
echo "  REAL-DEAL MODE (authentication REQUIRED — fail-closed)."
echo "  Real-deal data lives in data/real (or the folder in MA_DATA_DIR)."
echo "  First run: create the first admin account with"
echo "      \"$NODE_CMD\" scripts/bootstrap-admin.js"
echo "  It asks for the password (12+ characters) or reads MA_BOOTSTRAP_PASSWORD;"
echo "  never type it on the command line. You will be asked to change it"
echo "  at your first sign-in."
echo "  ────────────────────────────────────────────────────────────────"
echo ""
echo "  Starting the TE Connectivity M&A Integration Portal ..."
echo "  Opening http://localhost:3000 - keep this window open; close it to stop the server."

( sleep 3; (command -v open >/dev/null && open "http://localhost:3000") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:3000") ) >/dev/null 2>&1 &

# NOTE: DEMO_OPEN is deliberately NOT set here — it is cleared above (and is
# refused together with MA_MODE=real). Auth stays mandatory.
exec "$NODE_CMD" server.js
