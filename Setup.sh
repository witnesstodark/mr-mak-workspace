#!/usr/bin/env bash
# Mr. Mak Workspace setup for Linux/macOS. Mirrors Setup.ps1 modes:
#   ./Setup.sh           Check the machine (default)
#   ./Setup.sh Preview   Install dependencies and run the web version
#   ./Setup.sh Desktop   Install dependencies and build the Tauri desktop app
set -euo pipefail
MODE="${1:-Check}"
case "$MODE" in Check|Preview|Desktop) ;; *) echo "Usage: ./Setup.sh [Check|Preview|Desktop]"; exit 2 ;; esac
cd "$(dirname "$0")"

if [ ! -f workspace/workspace.json ]; then
  echo "Open Setup.sh from the complete repository folder."
  exit 1
fi

have() { command -v "$1" >/dev/null 2>&1 && echo yes || echo no; }
NODE="$(have node)"; NPM="$(have npm)"; CARGO="$(have cargo)"
CODEX="$(have codex)"; CLAUDE="$(have claude)"

echo "Mr. Mak Workspace setup ($(uname -s))"
echo "Node: $NODE | npm: $NPM | Rust: $CARGO"
echo "Codex CLI: $CODEX | Claude Code CLI: $CLAUDE"
if [ "$CODEX" = no ] && [ "$CLAUDE" = no ]; then
  echo "Install and sign in to Codex CLI and/or Claude Code CLI before setting up this Workspace. See docs/getting-started.md."
  exit 1
fi

if [ "$MODE" = Check ]; then
  echo "Web version: ./Setup.sh Preview"
  echo "Desktop build: ./Setup.sh Desktop (needs Rust and the Tauri system libraries, see docs/getting-started.md)"
  exit 0
fi

if [ "$NODE" = no ] || [ "$NPM" = no ]; then
  echo "Install Node.js 22.20 or newer, then reopen the terminal."
  exit 1
fi
if ! node -e "const p=process.versions.node.split('.').map(Number);if(p[0]<22||(p[0]===22&&p[1]<20))process.exit(1)"; then
  echo "Node.js 22.20 or newer is required."
  exit 1
fi
if [ "$MODE" = Desktop ] && [ "$CARGO" = no ]; then
  echo "Install stable Rust (rustup) and the Tauri system libraries. See docs/getting-started.md."
  exit 1
fi

npm ci

if [ "$MODE" = Preview ]; then
  echo "Opening the report preview. Full terminal and voice features use the desktop app."
  npm run dev
else
  npm run desktop:build
  echo "Bundle ready under src-tauri/target/release/bundle."
  echo "Start it with: ./Start Mr. Mak.sh"
fi
