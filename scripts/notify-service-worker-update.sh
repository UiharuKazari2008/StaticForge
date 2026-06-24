#!/usr/bin/env bash
# Recompile runtime assets, refresh the server SW hash cache, and notify all
# connected clients to check/download updates (same manifest as OPTIONS /).
#
# Requires the StaticForge server to be running (unix socket on
# /tmp/staticforge_mcp.sock by default).
#
# Usage:
#   bash scripts/notify-service-worker-update.sh
#   bash scripts/notify-service-worker-update.sh --silent
#   bash scripts/notify-service-worker-update.sh --json
#   bash scripts/notify-service-worker-update.sh --restart
#
# --restart  pm2-restart the server first, wait until boot + runtime compile
#            finish, then recompile/refresh/broadcast so reconnecting clients
#            receive the updated manifest (boot compile alone does not push).
#
# Environment:
#   STATICFORGE_SOCKET_PATH              Unix socket path (default: /tmp/staticforge_mcp.sock)
#   STATICFORGE_SOCKET_TIMEOUT_MS      Socket client timeout in ms (default: 120000)
#   STATICFORGE_SERVER_WAIT_TIMEOUT_MS Wait for HTTP ready after restart (default: 180000)
#   STATICFORGE_HTTP_PORT                Server port for readiness probe (default: 9220)
#   STATICFORGE_PM2_TARGET               pm2 process id/name to restart (default: 12)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_JS="$ROOT/scripts/service-worker-cache-socket.js"
SOCKET_PATH_DEFAULT="/tmp/staticforge_mcp.sock"

PM2_TARGET="${STATICFORGE_PM2_TARGET:-12}"
SOCKET_PATH="${STATICFORGE_SOCKET_PATH:-$SOCKET_PATH_DEFAULT}"
SOCKET_WAIT_TIMEOUT_MS="${STATICFORGE_SOCKET_WAIT_TIMEOUT_MS:-120000}"
SERVER_WAIT_TIMEOUT_MS="${STATICFORGE_SERVER_WAIT_TIMEOUT_MS:-180000}"
HTTP_PORT="${STATICFORGE_HTTP_PORT:-9220}"

log() { echo "[sw-notify] $*"; }
die() { echo "[sw-notify] ERROR: $*" >&2; exit 1; }

usage() {
    sed -n '2,18p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

ARGS=()
DO_RESTART=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage 0 ;;
        --silent|--json) ARGS+=("$1"); shift ;;
        --restart) DO_RESTART=1; shift ;;
        --recompile)
            log "Note: --recompile is no longer required; recompile+refresh+broadcast always runs."
            shift
            ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

[[ -f "$CLIENT_JS" ]] || die "Missing client script: $CLIENT_JS"

if ! command -v node >/dev/null 2>&1; then
    die "node is required but not found in PATH"
fi

wait_for_server_ready() {
    STATICFORGE_HTTP_PORT="$HTTP_PORT" \
    STATICFORGE_SERVER_WAIT_TIMEOUT_MS="$SERVER_WAIT_TIMEOUT_MS" \
    node - <<'NODE'
const http = require('http');

const port = Number(process.env.STATICFORGE_HTTP_PORT || 9220);
const deadline = Date.now() + Number(process.env.STATICFORGE_SERVER_WAIT_TIMEOUT_MS || 180000);

function probe() {
    const req = http.request(
        { hostname: '127.0.0.1', port, path: '/status', method: 'OPTIONS' },
        (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const status = JSON.parse(body);
                    if (status.isReady === true && status.runtimeCompileComplete === true) {
                        process.exit(0);
                    }
                } catch (_) { /* retry */ }

                if (Date.now() >= deadline) {
                    process.exit(1);
                }
                setTimeout(probe, 1000);
            });
        }
    );

    req.on('error', () => {
        if (Date.now() >= deadline) {
            process.exit(1);
        }
        setTimeout(probe, 1000);
    });

    req.end();
}

probe();
NODE
}

request_recompile_and_broadcast() {
    log "Recompiling runtime assets, refreshing hash cache, and broadcasting to clients..."
    export STATICFORGE_SOCKET_PATH="$SOCKET_PATH"
    export STATICFORGE_SOCKET_TIMEOUT_MS="$SOCKET_WAIT_TIMEOUT_MS"
    node "$CLIENT_JS" "${ARGS[@]}"
}

if (( DO_RESTART == 1 )); then
    if ! command -v pm2 >/dev/null 2>&1; then
        die "pm2 is required for --restart but was not found in PATH"
    fi

    log "Restarting StaticForge via pm2 flush/reset/restart ($PM2_TARGET)..."
    pm2 flush "$PM2_TARGET"
    pm2 reset "$PM2_TARGET"
    pm2 restart "$PM2_TARGET"

    log "Waiting for server boot, runtime compile, and readiness on port $HTTP_PORT..."
    if ! wait_for_server_ready; then
        die "Timed out waiting for server readiness after restart (port $HTTP_PORT)"
    fi

    log "Server ready — broadcasting updated manifest to connected clients..."
    request_recompile_and_broadcast
else
    request_recompile_and_broadcast
fi
