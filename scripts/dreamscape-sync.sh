#!/usr/bin/env bash
# Directional rsync for a full Dreamscape tree (same payload as pack --full).
# Never bidirectional auto-merge — you choose pull or push.
#
# Usage:
#   bash scripts/dreamscape-sync.sh pull [--dry-run] [--force] [--delete]
#   bash scripts/dreamscape-sync.sh push [--dry-run] [--force] [--delete]
#
# Env / config (first found wins for remote):
#   DREAMSCAPE_REMOTE=user@host:/abs/path/to/staticforge
#   ./dreamscape-sync.env  or  ~/.config/dreamscape/sync.env
#   DREAMSCAPE_SSH_OPTS   optional extra ssh flags
#
# Default: rsync --update (newer wins). No --delete unless passed.
# Refuses if web_server.js is running on the write side unless --force.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ACTION=""
DRY_RUN=0
FORCE=0
DO_DELETE=0

usage() {
    sed -n '2,16p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        pull|push) ACTION="$1"; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --force) FORCE=1; shift ;;
        --delete) DO_DELETE=1; shift ;;
        -h|--help) usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

if [[ -z "$ACTION" ]]; then
    echo "ERROR: specify pull or push" >&2
    usage 1
fi

load_env_file() {
    local f="$1"
    [[ -f "$f" ]] || return 1
    # shellcheck disable=SC1090
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
    return 0
}

if [[ -z "${DREAMSCAPE_REMOTE:-}" ]]; then
    load_env_file "$ROOT/dreamscape-sync.env" \
        || load_env_file "${HOME}/.config/dreamscape/sync.env" \
        || true
fi

if [[ -z "${DREAMSCAPE_REMOTE:-}" ]]; then
    echo "ERROR: set DREAMSCAPE_REMOTE=user@host:/path/to/staticforge" >&2
    echo "       (or copy scripts/dreamscape-sync.env.example to dreamscape-sync.env)" >&2
    exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
    echo "ERROR: rsync required" >&2
    exit 1
fi
if ! command -v ssh >/dev/null 2>&1; then
    echo "ERROR: ssh required" >&2
    exit 1
fi

# Parse user@host:/path  (path may contain colons after the first host:path split)
REMOTE_SPEC="$DREAMSCAPE_REMOTE"
if [[ "$REMOTE_SPEC" != *:* ]]; then
    echo "ERROR: DREAMSCAPE_REMOTE must be user@host:/abs/path (got: $REMOTE_SPEC)" >&2
    exit 1
fi
REMOTE_HOST="${REMOTE_SPEC%%:*}"
REMOTE_PATH="${REMOTE_SPEC#*:}"
if [[ -z "$REMOTE_HOST" || -z "$REMOTE_PATH" ]]; then
    echo "ERROR: could not parse DREAMSCAPE_REMOTE=$REMOTE_SPEC" >&2
    exit 1
fi
if [[ "$REMOTE_PATH" != /* ]]; then
    echo "ERROR: remote path must be absolute (got: $REMOTE_PATH)" >&2
    exit 1
fi

# Extra ssh flags as a single string (e.g. -i ~/.ssh/id_ed25519)
SSH_EXTRA="${DREAMSCAPE_SSH_OPTS:-}"
# shellcheck disable=SC2086
ssh_remote() {
    # shellcheck disable=SC2086
    ssh $SSH_EXTRA "$REMOTE_HOST" "$@"
}

server_running_local() {
    pgrep -f '[n]ode.*/web_server\.js' >/dev/null 2>&1
}

server_running_remote() {
    # Match pack-server-transfer.sh probe; ignore ssh noise on stderr for the check.
    ssh_remote "pgrep -f '[n]ode.*/web_server\\.js' >/dev/null 2>&1" >/dev/null 2>&1
}

if [[ "$FORCE" -eq 0 ]]; then
    if server_running_local; then
        echo "ERROR: web_server.js is running on this host. Stop it so SQLite stays consistent." >&2
        echo "       Use --force to override." >&2
        exit 1
    fi
    if [[ "$ACTION" == "push" ]] && server_running_remote; then
        echo "ERROR: web_server.js is running on $REMOTE_HOST. Stop it first." >&2
        echo "       Use --force to override." >&2
        exit 1
    fi
    if [[ "$ACTION" == "pull" ]] && server_running_remote; then
        # Pull writes locally (already checked); remote still holding open DBs is risky
        # for a consistent read of .cache — warn loudly but allow with --force only.
        echo "ERROR: web_server.js is running on $REMOTE_HOST (source). Stop it for a consistent pull." >&2
        echo "       Use --force to override." >&2
        exit 1
    fi
fi

EXCLUDES=(
    --exclude=node_modules/
    --exclude=.git/
    --exclude='dreamscape-transfer-*.tar.zst'
    --exclude='*.manifest.json'
    --exclude='.agent-*'
    --exclude=graphify-out/
    --exclude=.cache/chrome-for-testing/
    --exclude=dreamscape-sync.env
)

RSYNC_FLAGS=(-a -z --update --human-readable --info=stats2,progress2)
[[ "$DRY_RUN" -eq 1 ]] && RSYNC_FLAGS+=(--dry-run)
[[ "$DO_DELETE" -eq 1 ]] && RSYNC_FLAGS+=(--delete)

# Ensure trailing slash = sync contents of the tree roots
LOCAL_SRC="$ROOT/"
REMOTE_SRC="${REMOTE_HOST}:${REMOTE_PATH}/"

echo "Action:  $ACTION"
echo "Local:   $ROOT"
echo "Remote:  $REMOTE_HOST:$REMOTE_PATH"
[[ "$DRY_RUN" -eq 1 ]] && echo "Mode:    dry-run"
[[ "$DO_DELETE" -eq 1 ]] && echo "Delete:  enabled (extra files on dest removed)"
[[ "$FORCE" -eq 1 ]] && echo "Force:   skipping running-server checks"
echo ""

RSYNC_RSH="ssh"
[[ -n "$SSH_EXTRA" ]] && RSYNC_RSH="ssh $SSH_EXTRA"

if [[ "$ACTION" == "pull" ]]; then
    rsync "${RSYNC_FLAGS[@]}" "${EXCLUDES[@]}" -e "$RSYNC_RSH" \
        "$REMOTE_SRC" "$LOCAL_SRC"
else
    rsync "${RSYNC_FLAGS[@]}" "${EXCLUDES[@]}" -e "$RSYNC_RSH" \
        "$LOCAL_SRC" "$REMOTE_SRC"
fi

echo ""
echo "Done ($ACTION)."
if [[ "$ACTION" == "pull" ]]; then
    echo "If you run Docker on this box and source changed: docker compose up --build"
    echo "Bare metal: re-run pnpm install if package.json / lockfile changed."
fi
