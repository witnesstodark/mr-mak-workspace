#!/usr/bin/env bash
# Launch Mr. Mak on Linux: a built or installed desktop binary first, then the
# web fallback. Keeps the repository as the workspace root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

for CANDIDATE in "$HOME/.local/bin/mrmak-workspace" "$ROOT/src-tauri/target/release/mrmak-workspace"; do
  if [ -x "$CANDIDATE" ]; then
    exec "$CANDIDATE" --repo "$ROOT"
  fi
done

echo "No Linux desktop binary found."
echo "Build one with: ./Setup.sh Desktop   (requires Rust and the Tauri system libraries; see docs/getting-started.md)"
echo "Or run the web version: npm run build && npm run desktop:service   (then open the printed URL)"
exit 1
