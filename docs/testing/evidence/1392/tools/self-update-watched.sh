#!/bin/bash
# self-update-watched.sh <run name> <from versionCode> <to versionCode> : the #1371 `self-update-screen-off` step (a real silent
# self-update with the display off) with stall-watch-guest.sh (wait mode: heartbeat, ticks, stacks) and the host sampler beside it
# (StaticForge #1392 part C). Env: LANE_ID, AGENT, WORK, OUT_BASE; WATCH (s, default 60), DUMPS (default "4 12"). Caller holds the lease.
set -u
NAME=${1:?run name}; FROM=${2:?from}; TO=${3:?to}; DUR=${WATCH:-60}; DUMPS=${DUMPS:-"4 12"}
HERE=$(cd "$(dirname "$0")" && pwd); EV=$HERE/..; ROOT=$(cd "$EV/../../../.." && pwd)
LANE_ID=${LANE_ID:?set LANE_ID}
L() { timeout 200 "$ROOT/scripts/aemu-lane/lane.sh" --agent "${AGENT:?set AGENT}" "$LANE_ID" "$@"; }
OUT=${OUT_BASE:-$EV}/$NAME; RAW=${WORK:?set WORK}/$NAME; mkdir -p "$OUT"; rm -rf "$RAW"
echo "lane $LANE_ID, real silent self-update $FROM -> $TO with the display off" > "$OUT/run.txt"
OLD=$(L sh 'pidof jp.net.seventhreeseven.dreamscape' | tr -d '\r'); echo "old pid $OLD" | tee -a "$OUT/run.txt"
L adb push "$EV/stall-watch-guest.sh" /data/local/tmp/s1392.sh >/dev/null 2>&1 || { echo "push failed"; exit 3; }
"$HERE/host-sample.sh" $(( DUR + 90 )) "$OUT/host.txt" & HS=$!
L su "rm -rf /data/local/tmp/s1392; setsid sh /data/local/tmp/s1392.sh wait $OLD $DUR '$DUMPS' >/dev/null 2>&1 &"
BARS1371_EVIDENCE=$OUT/bars1371 timeout 520 "$ROOT/scripts/aemu-lane/tests/bars-row-1371-lane.sh" --agent "$AGENT" "$LANE_ID" --grace 20 self-update-screen-off "$FROM" "$TO" 2>&1 | cut -c1-300 > "$OUT/step.txt"
for i in $(seq 1 30); do [ -n "$(L sh 'ls /data/local/tmp/s1392/done 2>/dev/null' | tr -d '\r')" ] && break; sleep 5; done
L adb pull /data/local/tmp/s1392 "$RAW" >/dev/null 2>&1 || echo "PULL FAILED" | tee -a "$OUT/run.txt"
L sh "dumpsys package jp.net.seventhreeseven.dreamscape | grep -E 'status=|versionCode=' | head -4" | tr -d '\r' | tee -a "$OUT/run.txt"
wait $HS
python3 -I "$HERE/analyze-run.py" "$RAW" "$OUT" jp.net.seventhreeseven.dreamscape > "$OUT/summary.txt"
grep -v '^  event' "$OUT/summary.txt"
grep -E 'PASS|FAIL|INFO FINDING|RESULT|restart-now' "$OUT/step.txt"
