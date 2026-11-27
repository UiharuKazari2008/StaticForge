#!/bin/bash
# run-pin.sh <run name> <digits typed, e.g. 1234> : one PIN unlock on Melaton's lock screen of the lane instance (StaticForge
# #1392 part D), by tools/pin-guest.sh. env: AGENT, WORK (scratch folder holding keys.json from the saved lock copy), WATCH (s),
# TRACE=trace (a scheduler + binder trace around the OK tap, kept in $WORK only), UIDUMP=uidump (pin-guest.sh).
# Raw shots and the unfiltered logcat stay in $WORK/<run>; nothing here is written into the repo.
set -u
NAME=${1:?run name}; DIGITS=${2:?digits}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../../../.." && pwd); WORK=${WORK:?set WORK}
PKG=jp.net.seventhreeseven.dreamscape
L() { timeout 200 "$ROOT/scripts/aemu-lane/lane.sh" --agent "${AGENT:?set AGENT}" "${LANE_ID:-aemu-fold-2}" "$@"; }
RAW=$WORK/$NAME; rm -rf "$RAW"; mkdir -p "$RAW"
read -r SX SY SX2 PTS OKX OKY < <(python3 -I - "$WORK/keys.json" "$DIGITS" <<'EOF'
import json, sys
k = json.load(open(sys.argv[1])); h = k['handle']
pts = ';'.join('%d,%d' % tuple(k['keys'][d]) for d in sys.argv[2])
print(h[0], h[1], h[0] + k['travel'] + 420, pts, *k['keys']['unlock'])
EOF
)
L adb push "$HERE/pin-guest.sh" /data/local/tmp/s1392d-pin.sh >/dev/null 2>&1 || { echo "push failed"; exit 3; }
START=$(L sh 'date +%s.%3N' | tr -d '\r')
L sh "sh /data/local/tmp/s1392d-pin.sh /data/local/tmp/s1392d-run '$SX $SY $SX2' '$(echo "$PTS" | tr ';' ' ')' '$OKX,$OKY' ${WATCH:-12} ${TRACE:--} ${UIDUMP:-}"
L adb pull /data/local/tmp/s1392d-run "$RAW/guest" >/dev/null 2>&1 || echo "PULL FAILED"
L sh "logcat -d -v epoch -b main -b system -b crash -b events -T '$START'" > "$RAW/logcat-all.txt"
L sh 'rm -rf /data/local/tmp/s1392d-run /data/local/tmp/s1392d-pin.sh'
PID=$(L sh "pidof $PKG" | tr -d '\r' | awk '{print $1}')
echo "start $START app pid $PID" > "$RAW/run.txt"
python3 -I "$HERE/logcut.py" "$RAW/logcat-all.txt" "$RAW/logcat.txt" "$PID"
cat "$RAW/guest/notes.txt"; [ -s "$RAW/guest/bouncer.txt" ] && cat "$RAW/guest/bouncer.txt"
