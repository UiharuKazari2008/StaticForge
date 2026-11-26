#!/usr/bin/env bash
# Send a client update (service-worker notify) only when the client update gate approves (Yukimi, Nov 26 2026:
# "we have a restart wait queue for server rebuilds, apparently we also need one for client rebuilds as well").
#
#   bash scripts/client-update.sh --why "<what the update ships>" [--notify]
#
# 1. node scripts/restart-gate.js --client (prints the verdict and its reasons):
#      approved          -> notify
#      ask <agent>       -> stop (exit 10): a live session holds uncommitted client edits; with --notify it was asked
#                           in its agent-coord inbox, and Fleet lists the wait under Client Update Waits
#      wait for <...>    -> stop (exit 20): another build runs, or someone holds hold-client-update
#      denied for <...>  -> stop (exit 30): a changed client file does not parse; fix it first
# 2. scripts/notify-service-worker-update.sh (refreshes the hash cache and tells the clients; restarts nothing -
#    each client downloads the update and reloads at its own time, client-update-never-in-place.mdc)
#
# Uncommitted client files no live session holds are notes, not waits: they ship as they are (finished work is
# not held back, memory #314).
set -u
cd "$(dirname "$0")/.." || exit 1

why=""
notify=""
while [ $# -gt 0 ]; do
    case "$1" in
        --why) why="${2:-}"; shift 2 ;;
        --notify) notify="--notify"; shift ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
[ -n "$why" ] || { echo 'say what the update ships: --why "<reason>"' >&2; exit 2; }

node scripts/restart-gate.js --client --why "$why" $notify
code=$?
if [ "$code" -ne 0 ]; then
    echo "client update not sent (gate exit $code)"
    exit "$code"
fi

echo "sending the client update: $why"
bash scripts/notify-service-worker-update.sh
