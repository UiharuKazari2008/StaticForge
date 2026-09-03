#!/usr/bin/env bash
# Container entrypoint: ensure runtime dirs/config, then start web_server.js
set -euo pipefail

APP_ROOT="${DREAMSCAPE_APP_ROOT:-/app}"

if [[ "$(id -u)" -ne 0 ]]; then
    echo "[entrypoint] ERROR: container must start setup as root (runtime volume bootstrap)." >&2
    exit 1
fi

# Dirs + missing configs only (image build already ran pnpm install).
bash "$APP_ROOT/scripts/setup.sh" --runtime

cd "$APP_ROOT"
exec node web_server.js
