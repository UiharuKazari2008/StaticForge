#!/usr/bin/env bash
# Refresh the server SW hash cache and notify connected clients to download
# updates (same manifest as OPTIONS /). This script does not restart Dreamscape.
# Agents never restart the server. If a change needs a restart, check that the
# Director is idle and ask Yukimi or Sala, with the reason, then stop.
# See .cursor/rules/director-idle-before-restart.mdc.
#
# Requires the StaticForge server to be running (unix socket on
# /tmp/staticforge_mcp.sock by default).
#
# Usage:
#   bash scripts/notify-service-worker-update.sh
#   bash scripts/notify-service-worker-update.sh --silent
#   bash scripts/notify-service-worker-update.sh --json
#
# Environment:
#   STATICFORGE_SOCKET_PATH          Unix socket path (default: /tmp/staticforge_mcp.sock)
#   STATICFORGE_SOCKET_TIMEOUT_MS    Socket client timeout in ms (default: 120000)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_JS="$ROOT/scripts/service-worker-cache-socket.js"
SOCKET_PATH_DEFAULT="/tmp/staticforge_mcp.sock"

SOCKET_PATH="${STATICFORGE_SOCKET_PATH:-$SOCKET_PATH_DEFAULT}"
SOCKET_WAIT_TIMEOUT_MS="${STATICFORGE_SOCKET_WAIT_TIMEOUT_MS:-120000}"

log() { echo "[sw-notify] $*"; }
die() { echo "[sw-notify] ERROR: $*" >&2; exit 1; }

usage() {
    sed -n '2,16p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) usage 0 ;;
        --silent|--json) ARGS+=("$1"); shift ;;
        --recompile)
            log "Note: --recompile is no longer required; refresh+broadcast always runs."
            shift
            ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

[[ -f "$CLIENT_JS" ]] || die "Missing client script: $CLIENT_JS"

if ! command -v node >/dev/null 2>&1; then
    die "node is required but not found in PATH"
fi

log "Refreshing hash cache and broadcasting to clients..."
export STATICFORGE_SOCKET_PATH="$SOCKET_PATH"
export STATICFORGE_SOCKET_TIMEOUT_MS="$SOCKET_WAIT_TIMEOUT_MS"
node "$CLIENT_JS" "${ARGS[@]}"
