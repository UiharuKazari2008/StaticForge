#!/usr/bin/env bash
# Reload server modules in the running Dreamscape without a restart (#1292 / #1293, docs/server/hot-reload.md).
#
#   bash scripts/reload-server-module.sh <file...> --why "<what the reload is for>" [--notify] [--json] [--dry-run]
#
# node --check, the plan from the server's reload socket, the light gate (scripts/restart-gate.js --reload), the reload.
# Exit codes (see the top of scripts/reload-server-module.js): 0 reloaded, 2 usage, 10 ask, 20 wait, 30 denied,
# 50 needs a restart (scripts/restart-dreamscape.sh) or another route, 51 blocked / rolled back, 52 no reload socket.
exec node "$(dirname "$0")/reload-server-module.js" "$@"
