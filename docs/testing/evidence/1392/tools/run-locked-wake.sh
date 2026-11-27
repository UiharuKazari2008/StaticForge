#!/bin/bash
# run-locked-wake.sh <run name> : StaticForge #1392 part D. Locked, display off, kill -9 of the app, wake about WAKE_AFTER s
# (default 3) after the new process appears, with app thread dumps at +4 / +8 s (tools/run-one.sh mode kill-wake with
# tools/lock-guest.sh for the wake and its screenshots / recording, plus tools/thread-sample-guest.sh).
# env: AGENT, LANE_ID, WORK (scratch), OUT_BASE (evidence folder for the run). The caller set the PIN and its guard.
set -u
NAME=${1:?run name}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../../../.." && pwd)
PKG=jp.net.seventhreeseven.dreamscape
L() { timeout 200 "$ROOT/scripts/aemu-lane/lane.sh" --agent "${AGENT:?set AGENT}" "${LANE_ID:-aemu-fold-2}" "$@"; }
OLD=$(L su "pidof $PKG" | tr -d '\r' | awk '{print $1}')
[ -n "$OLD" ] || { echo "no app process"; exit 3; }
L adb push "$HERE/thread-sample-guest.sh" /data/local/tmp/s1392d-ts.sh >/dev/null 2>&1 || { echo "push failed"; exit 3; }
L su "rm -rf /data/local/tmp/s1392d-ts; setsid sh /data/local/tmp/s1392d-ts.sh $OLD 25 >/dev/null 2>&1 &"
WAKE_AFTER=${WAKE_AFTER:-3} WAKE_SCRIPT=lock-guest.sh WAKE_SAMPLES=none "$HERE/run-one.sh" "$NAME" kill-wake 30 none
L adb pull /data/local/tmp/s1392d-ts "$WORK/$NAME-ts" >/dev/null 2>&1 || echo "SAMPLER PULL FAILED"
cp "$WORK/$NAME-ts/lock-thread.txt" "$WORK/$NAME-ts/dumps.txt" "${OUT_BASE:?set OUT_BASE}/$NAME/" 2>/dev/null
L su 'rm -rf /data/local/tmp/s1392d-ts /data/local/tmp/s1392d-ts.sh /data/local/tmp/s1392 /data/local/tmp/s1392.sh'
