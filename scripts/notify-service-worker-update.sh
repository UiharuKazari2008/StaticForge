#!/usr/bin/env bash
# Refresh the server's service worker hash cache and notify all connected
# clients to check/download updates (same manifest as OPTIONS /).
#
# Requires the StaticForge server to be running (unix socket on
# /tmp/staticforge_mcp.sock by default).
#
# Usage:
#   bash scripts/notify-service-worker-update.sh
#   bash scripts/notify-service-worker-update.sh --silent
#   bash scripts/notify-service-worker-update.sh --json
#   bash scripts/notify-service-worker-update.sh --restart   (pm2 flush/reset/restart)
#
# Environment:
#   STATICFORGE_SOCKET_PATH         Unix socket path (default: /tmp/staticforge_mcp.sock)
#   STATICFORGE_SOCKET_TIMEOUT_MS   Client timeout in ms (default: 120000)
#   STATICFORGE_SOCKET_WAIT_TIMEOUT_MS  Socket wait after restart (default: 120000)
#   STATICFORGE_PM2_TARGET         pm2 process id/name to restart (default: 12)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_JS="$ROOT/scripts/service-worker-cache-socket.js"
SOCKET_PATH_DEFAULT="/tmp/staticforge_mcp.sock"

PM2_TARGET="${STATICFORGE_PM2_TARGET:-12}"
SOCKET_PATH="${STATICFORGE_SOCKET_PATH:-$SOCKET_PATH_DEFAULT}"
SOCKET_WAIT_TIMEOUT_MS="${STATICFORGE_SOCKET_WAIT_TIMEOUT_MS:-120000}"

log() { echo "[sw-notify] $*"; }
die() { echo "[sw-notify] ERROR: $*" >&2; exit 1; }

usage() {
    sed -n '2,16p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

ARGS=()
DO_RESTART=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage 0 ;;
        --silent|--json) ARGS+=("$1"); shift ;;
        --restart) DO_RESTART=1; shift ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

[[ -f "$CLIENT_JS" ]] || die "Missing client script: $CLIENT_JS"

if ! command -v node >/dev/null 2>&1; then
    die "node is required but not found in PATH"
fi

wait_for_socket() {
    local start_ms
    start_ms="$(date +%s%3N)"
    while true; do
        if test -S "$SOCKET_PATH"; then
            return 0
        fi

        local now_ms elapsed_ms
        now_ms="$(date +%s%3N)"
        elapsed_ms=$((now_ms - start_ms))
        if (( elapsed_ms >= SOCKET_WAIT_TIMEOUT_MS )); then
            return 1
        fi
        sleep 1
    done
}

if (( DO_RESTART == 1 )); then
    if ! command -v pm2 >/dev/null 2>&1; then
        die "pm2 is required for --restart but was not found in PATH"
    fi

    log "Restarting StaticForge via pm2 flush/reset/restart ($PM2_TARGET)..."
    pm2 flush "$PM2_TARGET"
    pm2 reset "$PM2_TARGET"
    pm2 restart "$PM2_TARGET"

    log "Waiting for unix socket: $SOCKET_PATH"
    if ! wait_for_socket; then
        die "Timed out waiting for unix socket after restart: $SOCKET_PATH"
    fi
fi

log "Requesting server cache refresh and client broadcast..."
export STATICFORGE_SOCKET_PATH="$SOCKET_PATH"
node "$CLIENT_JS" "${ARGS[@]}"
