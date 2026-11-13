#!/usr/bin/env bash
# Build tools/rcs-bridge (Google Messages pairing for Text Messaging RCS accounts, Yozora #779)
# into .cache/rcs-bridge/rcs-bridge. Needs Go (>= 1.24); ~/.local/go is used when go is not on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
GO=$(command -v go || echo "$HOME/.local/go/bin/go")
[ -x "$GO" ] || { echo "Go is not installed (looked for go on PATH and ~/.local/go)." >&2; exit 1; }
mkdir -p .cache/rcs-bridge
(cd tools/rcs-bridge && "$GO" build -trimpath -o ../../.cache/rcs-bridge/rcs-bridge.new .)
mv .cache/rcs-bridge/rcs-bridge.new .cache/rcs-bridge/rcs-bridge
echo "built .cache/rcs-bridge/rcs-bridge"
