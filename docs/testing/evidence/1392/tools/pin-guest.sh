#!/system/bin/sh
# StaticForge #1392 part D: unlock the lane emulator through Melaton Mobile's own lock screen with REAL taps (input tap / swipe),
# on logical display 0 of the fold lane. Runs INSIDE the emulator (shell user). Throwaway PIN only; the caller sets it and
# starts tools/pin-guard-guest.sh. Silent: KEYCODE_SLEEP / KEYCODE_WAKEUP only.
#   sh pin-guest.sh <out dir> <slide: "x y x2"> <digit points: "x,y x,y x,y x,y"> <ok point: "x,y"> [seconds to watch after the OK tap] [trace|-] [uidump]
# "uidump": when the phone is still locked at the end, Android's lock screen is read with uiautomator (its window is FLAG_SECURE: a
# screencap is black) and only the PIN pad's own nodes are kept (bouncer.txt). uiautomator unbinds accessibility services while it runs.
# "trace": an atrace sched + binder_driver ring runs from just before the OK tap to the end of the watch (trace.txt).
O=$1; SLIDE=$2; DIGITS=$3; OK=$4; WATCH=${5:-12}; TR=${6:-}; UD=${7:-}
PKG=jp.net.seventhreeseven.dreamscape
rm -rf $O; mkdir -p $O; N=$O/notes.txt; : > $N
now() { date +%s%3N; }
note() { echo "$(now) $*" >> $N; }
D0=$(dumpsys display 2>/dev/null | grep -o 'uniqueId="local:[0-9]*"' | head -1 | tr -dc '0-9')
shot() { note "shot $1 begin"; screencap ${D0:+-d $D0} -p $O/$1.png 2>/dev/null; note "shot $1 end"; }
locked() { dumpsys trust 2>/dev/null | grep -m1 -o 'deviceLocked=[0-9]' | cut -d= -f2; }
kg() { dumpsys window 2>/dev/null | grep -m1 -o 'isKeyguardShowing=[a-z]*' | cut -d= -f2; }
wins() { # Melaton / shade windows, top first: z name viewVisibility touchable-flag onScreen
  dumpsys window windows 2>/dev/null | awk '/^  Window #/ { z=$2; n=$0; sub(/.* u0 /,"",n); sub(/}.*/,"",n); nt="touchable" } /NOT_TOUCHABLE/ { nt="not-touchable" } /mViewVisibility=/ { vv=$1; sub(/.*=/,"",vv) } /isOnScreen=/ { split($0,a,"="); on=a[2] } /isVisible=/ { split($0,a,"="); if (n ~ /MelatonLock|NotificationShade/) printf "%s %s(viewVis=%s,%s,onScreen=%s,visible=%s); ", z, n, vv, nt, on, a[2] }'
}
front() { dumpsys activity activities 2>/dev/null | grep -m1 -o 'topResumedActivity=ActivityRecord{[^}]*}' | awk '{print $3}'; }
state() { note "$1: deviceLocked=$(locked) keyguard=$(kg) $(dumpsys power 2>/dev/null | grep -m1 -o 'mWakefulness=[A-Za-z]*') front=$(front) apppid=$(pidof $PKG) windows: $(wins)"; }

state "before"
note "KEYCODE_SLEEP"; input keyevent 223
i=0; while [ $i -lt 40 ] && [ "$(locked)" != 1 ]; do sleep 0.5; i=$((i+1)); done
sleep 5
state "asleep"
note "KEYCODE_WAKEUP"; input keyevent 224
sleep 3
state "awake"
shot a-cover
set -- $SLIDE
note "slide swipe $1 $2 -> $3 $2"; input swipe $1 $2 $3 $2 350
sleep 2
state "after the slide"
shot b-keypad
for p in $DIGITS; do input tap ${p%,*} ${p#*,}; note "digit tapped"; sleep 0.4; done
sleep 0.6
shot c-dots
state "digits in"
[ "$TR" = trace ] && atrace --async_start -b 48000 sched binder_driver >/dev/null 2>&1
note "mark before the OK tap"
T0=$(now); input tap ${OK%,*} ${OK#*,}; T1=$(now)
echo "$T0 $T1" > $O/oktap
note "OK tap command: started $T0 returned $T1"
U=''; end=$(( $(date +%s) + WATCH ))
while [ $(date +%s) -le $end ]; do
  if [ "$(locked)" = 0 ]; then U=$(now); break; fi
  sleep 0.2
done
if [ -n "$U" ]; then note "deviceLocked=0 first seen $U ($(( ($U - $T0) )) ms after the OK tap command started)"; else note "still locked ${WATCH}s after the OK tap"; fi
[ "$TR" = trace ] && atrace --async_stop -o $O/trace.txt >/dev/null 2>&1
sleep 4
state "end"
shot d-after
if [ "$UD" = uidump ] && [ "$(locked)" = 1 ]; then
  note "uiautomator dump begin"; uiautomator dump /data/local/tmp/s1392d-ui.xml >/dev/null 2>&1
  # one node a line; only SystemUI's bouncer nodes: id, text, description (the PIN field says dots and counts, never the digits)
  sed 's/<node /\n<node /g' /data/local/tmp/s1392d-ui.xml 2>/dev/null | grep -E 'resource-id="com.android.systemui:id/[^"]*(pin|Pin|key|bouncer|keyguard_message|message_area|delete)[^"]*"' | sed 's/.*\(text="[^"]*"\) \(resource-id="[^"]*"\).*\(content-desc="[^"]*"\).*\(bounds="[^"]*"\).*/\2 \1 \3 \4/' > $O/bouncer.txt
  rm -f /data/local/tmp/s1392d-ui.xml; note "uiautomator dump done ($(wc -l < $O/bouncer.txt) bouncer nodes)"
fi
chmod -R a+rX $O
