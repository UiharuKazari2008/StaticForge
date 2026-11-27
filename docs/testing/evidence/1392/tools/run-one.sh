#!/bin/bash
# run-one.sh <run name> <kill|kill-off|reinstall-off|reinstall-on|kill-wake> [watch secs] [dump offsets | none]
# env: LANE_ID (default aemu-fold-1), OUT_BASE (default the 1392 evidence folder), WAKE_AFTER (kill-wake: seconds after the new pid, default 3),
# WAKE_SCRIPT (default wake-guest.sh; lock-guest.sh for a locked phone, with WAKE_SAMPLES the offsets it notes the windows at before the wake).
# kill-wake: as kill-off, then tools/wake-guest.sh switches the display on WAKE_AFTER s after the new process appeared (part C).
# kill-off: the display is switched off first, then kill -9 (no install, no dex2oat, no PACKAGE_REPLACED).
# One watched process start of the Dreamscape app on the lane instance $LANE_ID (StaticForge #1392). The caller holds the lease.
set -u
NAME=${1:?run name}; MODE=${2:?mode}; DUR=${3:-45}; DUMPS=${4:-"3 6 9 14 22"}
HERE=$(cd "$(dirname "$0")" && pwd); EV=$HERE/..; ROOT=$(cd "$EV/../../../.." && pwd)
WORK=${WORK:?set WORK to a scratch folder for the unfiltered pulls}
PKG=jp.net.seventhreeseven.dreamscape
LANE_ID=${LANE_ID:-aemu-fold-1}
L() { timeout 200 "$ROOT/scripts/aemu-lane/lane.sh" --agent "${AGENT:?set AGENT}" "$LANE_ID" "$@"; }
OUT=${OUT_BASE:-$EV}/$NAME; RAW=$WORK/$NAME
mkdir -p "$OUT" "$WORK"; rm -rf "$RAW"
echo "lane $LANE_ID, mode $MODE" > "$OUT/run.txt"
state() { L su 'echo "app=$(pidof jp.net.seventhreeseven.dreamscape) holder=$(pidof melaton_navblank) recs=$(dumpsys statusbar | grep -c "pkg=com.android.shell token") bound=$(dumpsys accessibility | grep "Bound services" | grep -ci melaton) shizuku=$(pidof shizuku_server) wake=$(dumpsys power | grep -m1 -o "mWakefulness=[A-Za-z]*" | cut -d= -f2)"' | tr -d '\r'; }
pre=$(state); echo "pre: $pre" | tee -a "$OUT/run.txt"
case "$pre" in *"app= "*|*"holder= "*|*"recs=0"*|*"bound=0"*|*"shizuku= "*) echo "PRECONDITION NOT MET" | tee -a "$OUT/run.txt"; exit 3;; esac
OLD=$(echo "$pre" | sed 's/^app=\([0-9]*\).*/\1/')
L now | tee -a "$OUT/run.txt"
L adb push "$EV/stall-watch-guest.sh" /data/local/tmp/s1392.sh >/dev/null 2>&1 || { echo "push failed"; exit 3; }
"$HERE/host-sample.sh" $(( DUR + 25 )) "$OUT/host.txt" & HS=$!
if [ "$MODE" = kill-off ] || [ "$MODE" = kill-wake ]; then
  L screen off | tee -a "$OUT/run.txt"; sleep 20
  if [ "$MODE" = kill-wake ]; then
    SAMPLE_ARG=''; [ -n "${WAKE_SAMPLES:-}" ] && SAMPLE_ARG="'$WAKE_SAMPLES'"
    L adb push "$HERE/${WAKE_SCRIPT:-wake-guest.sh}" /data/local/tmp/s1392-wake.sh >/dev/null 2>&1 || { echo "push failed"; exit 3; }
    L su "rm -rf /data/local/tmp/s1392-wake; setsid sh /data/local/tmp/s1392-wake.sh $OLD ${WAKE_AFTER:-3} $SAMPLE_ARG >/dev/null 2>&1 &"
  fi
  L su "rm -rf /data/local/tmp/s1392; setsid sh /data/local/tmp/s1392.sh kill $OLD $DUR '$DUMPS' >/dev/null 2>&1 &"
elif [ "$MODE" != kill ]; then
  APK=$(L sh "pm path $PKG" | head -1 | sed 's/^package://' | tr -d '\r')
  L sh "cp $APK /data/local/tmp/s1392.apk && sha256sum /data/local/tmp/s1392.apk | cut -c1-16" | tr -d '\r' | sed 's/^/apk copy sha256 /' | tee -a "$OUT/run.txt"
  if [ "$MODE" = reinstall-off ]; then L screen off | tee -a "$OUT/run.txt"; else L screen on | tee -a "$OUT/run.txt"; fi
  sleep 8
  L su "rm -rf /data/local/tmp/s1392; setsid sh /data/local/tmp/s1392.sh wait $OLD $DUR '$DUMPS' >/dev/null 2>&1 &"
  sleep 3
  echo "pm install -r -g at device ms $(L sh 'date +%s%3N' | tr -d '\r')" | tee -a "$OUT/run.txt"
  L sh "pm install -r -g /data/local/tmp/s1392.apk" | tr -d '\r' | tee -a "$OUT/run.txt"
  echo "pm install returned at device ms $(L sh 'date +%s%3N' | tr -d '\r')" | tee -a "$OUT/run.txt"
else
  sleep 4
  L su "rm -rf /data/local/tmp/s1392; setsid sh /data/local/tmp/s1392.sh kill $OLD $DUR '$DUMPS' >/dev/null 2>&1 &"
fi
sleep $(( DUR + 6 ))
for i in $(seq 1 40); do [ -n "$(L sh 'ls /data/local/tmp/s1392/done 2>/dev/null' | tr -d '\r')" ] && break; sleep 5; done
L adb pull /data/local/tmp/s1392 "$RAW" >/dev/null 2>&1 || echo "PULL FAILED" | tee -a "$OUT/run.txt"
L sh "dumpsys package $PKG | grep -E 'status=|versionCode=' | head -4" | tr -d '\r' | tee -a "$OUT/run.txt"
if [ "$MODE" = kill-wake ]; then
  for i in $(seq 1 20); do [ -n "$(L sh 'ls /data/local/tmp/s1392-wake/done 2>/dev/null' | tr -d '\r')" ] && break; sleep 3; done
  rm -rf "$OUT/wake"; L adb pull /data/local/tmp/s1392-wake "$OUT/wake" >/dev/null 2>&1 || echo "WAKE PULL FAILED" | tee -a "$OUT/run.txt"
  rm -f "$OUT/wake/done"; cat "$OUT/wake/wake.txt"; L su 'rm -rf /data/local/tmp/s1392-wake /data/local/tmp/s1392-wake.sh'; fi
case "$MODE" in kill-off|reinstall-off) L screen on | tee -a "$OUT/run.txt";; esac
case "$MODE" in reinstall-*) L sh 'rm -f /data/local/tmp/s1392.apk';; esac
wait $HS
sleep 3
echo "post: $(state)" | tee -a "$OUT/run.txt"
python3 -I "$HERE/analyze-run.py" "$RAW" "$OUT" "$PKG" | tee "$OUT/summary.txt"
