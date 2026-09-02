#!/usr/bin/env bash
# Fetch ResourcesSaverExt into tools/ and apply automation overlay.
# Optional: download Chrome for Testing (branded Chrome 151 ignores --load-extension).
# Host packages: xvfb (headed fallback), unzip/curl for CFT. No Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

INSTALL_CFT=0
SKIP_EXT=0
for arg in "$@"; do
  case "$arg" in
    --chrome-for-testing|--chrome|--cft) INSTALL_CFT=1 ;;
    --chrome-for-testing-only|--cft-only) INSTALL_CFT=1; SKIP_EXT=1 ;;
    --help|-h)
      cat <<'EOF'
Usage: ./scripts/nai-webapp-watch/setup-dump-deps.sh [--chrome-for-testing]

  (default)                 Fetch pinned ResourcesSaverExt + automation overlay
  --chrome-for-testing      Also download Chrome for Testing into
                            .cache/chrome-for-testing/ (gitignored) and print CHROME_BIN
  --chrome-for-testing-only Skip the extension clone; only install CFT

Branded google-chrome-stable 151.0.7922.169 ignores --load-extension
(Hangouts background_page; dump times out). Chrome for Testing 152.x honors
it and is required for DUMP_HEADLESS=1. xvfb headed remains the fallback
if CFT is missing.

CFT env: DUMP_CFT_MAJOR (default 152), DUMP_CFT_VERSION, DUMP_CFT_DIR
EOF
      exit 0
      ;;
    *)
      echo "[nai-webapp-dump-setup] unknown argument: $arg" >&2
      echo "[nai-webapp-dump-setup] try: $0 --help" >&2
      exit 2
      ;;
  esac
done

if [ "$SKIP_EXT" -eq 0 ]; then
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
- Load path for Chrome --load-extension: unpacked2x/
- Automation overlay: scripts/nai-webapp-watch/extension-automation/

Do not commit this directory (tools/ is gitignored).
MD
  bash "$OVERLAY/apply.sh" "$UNPACKED"
  test -f "$UNPACKED/automation-bridge.js"
  echo "[nai-webapp-dump-setup] ready: $UNPACKED"
  trap - EXIT
  rm -rf "$TMP"
fi

if [ "$INSTALL_CFT" -eq 1 ]; then
  bash "$ROOT/scripts/nai-webapp-watch/install-chrome-for-testing.sh"
else
  echo "[nai-webapp-dump-setup] dump drives Chrome over CDP (no Playwright)"
  echo "[nai-webapp-dump-setup] prefer Chrome for Testing: branded 151 ignores --load-extension"
  echo "[nai-webapp-dump-setup]   $0 --chrome-for-testing"
  echo "[nai-webapp-dump-setup] then: DUMP_HEADLESS=1 DUMP_CHROME_NO_SANDBOX=1 ./scripts/nai-webapp-watch/dump-novelai-webapp.sh"
  echo "[nai-webapp-dump-setup] fallback if CFT is missing: xvfb headed (dump-novelai-webapp.sh default)"
fi
