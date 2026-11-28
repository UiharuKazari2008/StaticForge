#!/usr/bin/env bash
# StaticForge #1413 acceptance on one lane emulator (the caller holds its coord lease): the glass light on Today -
# gyro-synced light, rays of different widths, an idle drift that settles and stops, and nothing running while Today is
# not what shows. One instance, one PASS / FAIL / INFO line per check on stdout and in DIR/summary.txt, every raw reading
# in a file in DIR. Exit 1 on any FAIL (a "FAIL (expected before the fix)" line is counted apart and does not fail the run).
#
#   COORD_AGENT_ID=<id> scripts/aemu-lane/tests/accept-1413.sh <aemu-id> [--out DIR] [--install] [--only A,B,C,D,E]
#
#   --install  with an update waiting (updateAction kind install / restart) the page's own Install Now path runs
#              (serviceWorkerManager.installUpdates()); the script then waits up to 4 minutes for Today with the new files.
#              Nothing is ever put into the page: no reload, no injected CSS or JS (client-update-never-in-place).
#   --only     run only these steps (A, the preconditions, always runs)
#
# The steps are in accept-1413.js beside this file (JSON, pixels, timing; the fix is "present" when wm-titanium.css has is-drift and wmTitanium.js has "--wm-ti-sk"). This script owns the arguments and the restore:
# on exit, also on error or a signal, the accelerometer is back at its default pose, the screen is on and the app is in front.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
L=$REPO/scripts/aemu-lane/lane.sh
CON=$REPO/scripts/aemu-lane/lib/con.py
PKG=jp.net.seventhreeseven.dreamscape
ID=${1:?lane instance id}
shift
OUT=docs/testing/evidence/1413/run-$(date +%H%M%S)
PASSTHRU=()
while [ $# -gt 0 ]; do
    case "$1" in
        --out) OUT=${2:?--out DIR}; shift 2;;
        --install) PASSTHRU+=(--install); shift;;
        --only) PASSTHRU+=(--only "${2:?--only A,B}"); shift 2;;
        *) echo "unknown argument: $1" >&2; exit 2;;
    esac
done
cd "$REPO" || exit 2
mkdir -p "$OUT"
export NODE_PATH=$REPO/node_modules

restore_device() { # the physical state; the page's own settings are put back by the node run itself
    local port
    port=$("$L" "$ID" status 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["serial"].split("-")[1])' 2>/dev/null)
    [ -n "$port" ] && python3 "$CON" "$port" sensor set acceleration 0:9.77631:0.812349 >/dev/null 2>&1
    "$L" "$ID" screen on >/dev/null 2>&1
    "$L" "$ID" sh "dumpsys activity activities | grep -m1 topResumedActivity | grep -q $PKG" >/dev/null 2>&1 || "$L" "$ID" start-app >/dev/null 2>&1
}
trap restore_device EXIT
node "$HERE/accept-1413.js" "$ID" --out "$OUT" ${PASSTHRU[@]+"${PASSTHRU[@]}"}
exit $?
