#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v xvfb-run >/dev/null 2>&1; then
  echo "[nai-webapp-dump] xvfb-run not found. Install: sudo apt install xvfb" >&2
  exit 1
fi

export DISPLAY="${DISPLAY:-:99}"
exec xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/nai-webapp-watch/dump-novelai-webapp.js "$@"
