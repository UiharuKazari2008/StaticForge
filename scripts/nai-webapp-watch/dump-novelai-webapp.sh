#!/usr/bin/env bash
# Headed Chrome under Xvfb + CDP dump. Extensions usually need a real display
# (or xvfb); classic --headless cannot load them. Optional DUMP_HEADLESS=1 uses
# --headless=new (experimental for extensions).
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
  echo "[nai-webapp-dump] DUMP_HEADLESS set — skipping xvfb; extension inject may fail" >&2
  exec node scripts/nai-webapp-watch/dump-novelai-webapp.js --headless "$@"
fi

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "[nai-webapp-dump] xvfb-run not found. Install: sudo apt install xvfb" >&2
  echo "[nai-webapp-dump] or set DUMP_HEADLESS=1 to try --headless=new (unsupported for most extensions)" >&2
  exit 1
fi

export DISPLAY="${DISPLAY:-:99}"
exec xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/nai-webapp-watch/dump-novelai-webapp.js "$@"
