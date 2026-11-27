#!/bin/bash
# replay-1371-crash.sh <run name> [dump offsets] : the exact #1371 `crash` step (the case with the 26.85 s sampler gap), with stall-watch-guest.sh
# (wait mode: heartbeat, ticks, stacks) and the host sampler running beside it. Caller holds the lease; AGENT and WORK set.
set -u
NAME=${1:?run name}; DUMPS=${2:-'3 6 9 14 22'}
HERE=$(cd "$(dirname "$0")" && pwd); EV=$HERE/..; ROOT=$(cd "$EV/../../../.." && pwd)
L() { timeout 200 "$ROOT/scripts/aemu-lane/lane.sh" --agent "$AGENT" "${LANE_ID:-aemu-fold-1}" "$@"; }
OUT=${OUT_BASE:-$EV}/$NAME; RAW=$WORK/$NAME; mkdir -p "$OUT"; rm -rf "$RAW"
L screen on; sleep 5
OLD=$(L sh 'pidof jp.net.seventhreeseven.dreamscape' | tr -d '\r')
L adb push "$EV/stall-watch-guest.sh" /data/local/tmp/s1392.sh >/dev/null 2>&1
"$HERE/host-sample.sh" 130 "$OUT/host.txt" & HS=$!
L su "rm -rf /data/local/tmp/s1392; setsid sh /data/local/tmp/s1392.sh wait $OLD 48 '$DUMPS' >/dev/null 2>&1 &"
BARS1371_EVIDENCE=$OUT/bars1371 timeout 520 "$ROOT/scripts/aemu-lane/tests/bars-row-1371-lane.sh" --agent "$AGENT" "${LANE_ID:-aemu-fold-1}" crash 2>&1 | cut -c1-300 > "$OUT/crash-step.txt"
for i in $(seq 1 30); do [ -n "$(L sh 'ls /data/local/tmp/s1392/done 2>/dev/null' | tr -d '\r')" ] && break; sleep 5; done
L adb pull /data/local/tmp/s1392 "$RAW" >/dev/null 2>&1 || echo "PULL FAILED"
wait $HS
rm -f "$OUT"/bars1371/*.png
python3 -I "$HERE/analyze-run.py" "$RAW" "$OUT" jp.net.seventhreeseven.dreamscape | tee "$OUT/summary.txt" | grep -v '^  event'
grep -E 'TIMES|RESULT|restarted the app' "$OUT/crash-step.txt"
