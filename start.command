#!/bin/bash
# Double-clickable launcher for macOS / Linux.
cd "$(dirname "$0")" || exit 1

NODE_CMD="node"
[ -x "./node/bin/node" ] && NODE_CMD="./node/bin/node"

if ! "$NODE_CMD" -v >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org/ and run this again."
  (command -v open >/dev/null && open "https://nodejs.org/en/download") 2>/dev/null
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo "Starting the TE Connectivity M&A Integration Portal ..."
echo "Opening http://localhost:3000 — keep this window open; close it to stop the server."

# Open the browser a few seconds after the server begins booting.
( sleep 3; (command -v open >/dev/null && open "http://localhost:3000") || (command -v xdg-open >/dev/null && xdg-open "http://localhost:3000") ) >/dev/null 2>&1 &

exec "$NODE_CMD" server.js
