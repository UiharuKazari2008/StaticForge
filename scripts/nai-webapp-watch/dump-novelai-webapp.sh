#!/usr/bin/env bash
# Chrome + CDP dump of novelai.net public assets (ResourcesSaverExt overlay).
#
# Prefer Chrome for Testing: DUMP_HEADLESS=1 + --headless=new works when Chrome
# honors --load-extension (CFT 152.x). Branded google-chrome-stable 151.x
# ignores --load-extension (Hangouts background_page; dump times out).
#
# Default (no DUMP_HEADLESS): headed Chrome under xvfb-run — still the
# fallback if CFT is missing. Containers often need DUMP_CHROME_NO_SANDBOX=1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

EXT="${RESOURCES_SAVER_EXT_PATH:-$ROOT/tools/ResourcesSaverExt/unpacked2x}"
if [ ! -d "$EXT" ]; then
  echo "[nai-webapp-dump] missing $EXT" >&2
  echo "[nai-webapp-dump] run: ./scripts/nai-webapp-watch/setup-dump-deps.sh" >&2
  exit 1
fi

if [ "${DUMP_HEADLESS:-}" = "1" ] || [ "${DUMP_HEADLESS:-}" = "true" ]; then
  echo "[nai-webapp-dump] DUMP_HEADLESS=1 — --headless=new (use Chrome for Testing; branded 151 ignores --load-extension)" >&2
  exec node scripts/nai-webapp-watch/dump-novelai-webapp.js --headless "$@"
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "[nai-webapp-dump] xvfb-run not found. Install: sudo apt install xvfb" >&2
  echo "[nai-webapp-dump] or install CFT and set DUMP_HEADLESS=1:" >&2
  echo "[nai-webapp-dump]   ./scripts/nai-webapp-watch/setup-dump-deps.sh --chrome-for-testing" >&2
  exit 1
fi

export DISPLAY="${DISPLAY:-:99}"
exec xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/nai-webapp-watch/dump-novelai-webapp.js "$@"
