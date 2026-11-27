#!/bin/sh
# Creator Studio launcher for macOS and Linux. Windows: use "Start Creator Studio.cmd".
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js was not found. Install version 18 or newer from https://nodejs.org and run this again."
  echo
  exit 1
fi
exec node server.js --open
