#!/usr/bin/env bash
# Fetch ResourcesSaverExt into tools/ and apply automation overlay.
# Also see README for host packages: xvfb, google-chrome-stable, and the playwright devDependency.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
OVERLAY="$ROOT/scripts/nai-webapp-watch/extension-automation"
EXT_COMMIT="${RESOURCES_SAVER_EXT_COMMIT:-2fa02b74726fb8c1991cb663744cc580d7d1d328}"
EXT_DIR="$ROOT/tools/ResourcesSaverExt"
UNPACKED="$EXT_DIR/unpacked2x"
echo "[nai-webapp-dump-setup] root=$ROOT commit=$EXT_COMMIT"
mkdir -p "$ROOT/tools"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "[nai-webapp-dump-setup] cloning up209d/ResourcesSaverExt"
git clone --depth 1 https://github.com/up209d/ResourcesSaverExt.git "$TMP/src"
git -C "$TMP/src" fetch --depth 1 origin "$EXT_COMMIT"
git -C "$TMP/src" checkout "$EXT_COMMIT"
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp -a "$TMP/src/unpacked2x" "$EXT_DIR/"
cp -f "$TMP/src/LICENSE" "$EXT_DIR/LICENSE" 2>/dev/null || true
cp -f "$TMP/src/README.md" "$EXT_DIR/README.upstream.md" 2>/dev/null || true
cp -f "$OVERLAY/SOURCE.txt" "$EXT_DIR/SOURCE.txt"
cat > "$EXT_DIR/README.md" <<'MD'
# ResourcesSaverExt (local, gitignored)

Downloaded by scripts/nai-webapp-watch/setup-dump-deps.sh.

- Upstream: https://github.com/up209d/ResourcesSaverExt (GPL-3.0+)
- Load path for Playwright: unpacked2x/
- Automation overlay: scripts/nai-webapp-watch/extension-automation/

Do not commit this directory (tools/ is gitignored).
MD
bash "$OVERLAY/apply.sh" "$UNPACKED"
test -f "$UNPACKED/automation-bridge.js"
echo "[nai-webapp-dump-setup] ready: $UNPACKED"
echo "[nai-webapp-dump-setup] host needs: xvfb, google-chrome-stable (or CHROME_BIN), and playwright as a repo devDependency"
