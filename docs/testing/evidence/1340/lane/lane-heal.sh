#!/bin/bash
# lane-heal.sh - the #1340 acceptance on ONE lane emulator (never a phone). The planner (claude-f80b3b73) holds the lease.
#
#   lane-heal.sh <id> pre   <label>                 state before a run (pid, bound, uptime, permission, Shizuku) -> <label>-pre.txt
#   lane-heal.sh <id> crash <label>                 Settings in front, am crash <pid>, screenshot of the crash box -> <label>-box.png
#   lane-heal.sh <id> watch <label> <X> <Y> [secs]  tap "Close app" at X Y, then touch NOTHING: poll every ~0.7 s for <secs> (default 40),
#                                                   push ONE test notice for this device as soon as the service is bound, screenshots
#                                                   2 s / 5 s / 8 s after the push, then logcat + dumpsys -> <label>-*.txt/png
#   lane-heal.sh <id> clear <label>                 clear this run's test notice
# Evidence folder: $EVID (default the scratchpad's fold/). Every file is <id>-<label>-...
set -u
I=${1:?instance}; CMD=${2:?pre|crash|watch|clear}; LABEL=${3:?label}
cd /home/kanmi/staticforge || exit 1
ME=claude-f80b3b73
L="scripts/aemu-lane/lane.sh --agent $ME"
EVID=${EVID:-/home/kanmi/staticforge/docs/testing/evidence/1340/lane}
mkdir -p "$EVID"
P=jp.net.seventhreeseven.dreamscape
F="$EVID/$I-$LABEL"
case "$I" in aemu-*) ;; *) echo "refused: $I is not a lane emulator"; exit 2;; esac

# guest-side helpers (one shell): st <tag> prints clock, pid, bound, crashed
GUEST_ST='P=jp.net.seventhreeseven.dreamscape
ms() { date +%s%3N; }
st() { D=$(dumpsys accessibility); B=$(echo "$D" | sed -n "/Bound services/,/Enabled services/p" | grep -v "Enabled services" | grep -c "label=Melaton Bars"); BI=$(echo "$D" | grep -E "^ +Binding services" | grep -c MelatonBar); CR=$(echo "$D" | grep -E "^ +Crashed services" | grep -c MelatonBar); echo "$(date +%T.%N | cut -c1-12) $1 pid=$(pidof $P | tr " " ,) bound=$B binding=$BI crashed=$CR acc=$(settings get secure accessibility_enabled)"; }'

case "$CMD" in
  pre)
    {
      echo "== $I $LABEL pre $(date -u +%FT%TZ)"
      $L $I sh "$GUEST_ST
st pre
echo uptime=\$(cut -d' ' -f1 /proc/uptime)s sdk=\$(getprop ro.build.version.sdk) release=\$(getprop ro.build.version.release) model=\$(getprop ro.product.model)
dumpsys package \$P | grep -E 'versionCode|versionName' | head -2
echo ens=\$(settings get secure enabled_accessibility_services)
echo showFirstCrash=\$(settings get global show_first_crash_dialog)
dumpsys package \$P | grep -E 'WRITE_SECURE_SETTINGS' | sort -u
dumpsys accessibility | grep -E '^ +(Bound|Binding|Crashed|Enabled) services' | cut -c1-400
dumpsys activity activities | grep -E 'topResumedActivity'
cmd audio get-ringer-mode 2>/dev/null | head -1" | tr -d '\r'
      echo "shizuku: $($L $I shizuku status 2>&1 | cut -c1-300)"
    } | tee "$F-pre.txt";;

  crash)
    {
      echo "== $I $LABEL crash $(date -u +%FT%TZ)"
      $L $I sh 'settings put global show_first_crash_dialog 1'
      $L $I other >/dev/null; sleep 3
      $L $I sh "$GUEST_ST
st before-crash
dumpsys activity activities | grep -E 'topResumedActivity'
echo nav=\$(settings get secure navigation_mode) holder=\$(pidof melaton_navblank)
dumpsys activity activities | grep -cE '(Resumed|Hist).*jp.net.seventhreeseven.dreamscape/' | sed 's/^/app-activity-records=/'
logcat -b main -b system -b crash -b events -c
echo CRASH-AT \$(date +%T.%N | cut -c1-12) pid=\$(pidof \$P)
am crash \$(pidof \$P)
sleep 3
st after-crash
dumpsys window | grep -E 'mCurrentFocus' | head -2" | tr -d '\r'
      $L $I shot "$F-box.png" >/dev/null && echo "box screenshot: $F-box.png"
    } | tee "$F-crash.txt";;

  watch)
    X=${4:?X}; Y=${5:?Y}; SECS=${6:-40}
    # X=kill: the control run, a root kill -9 of the app in place of the tap (the events buffer cleared first, Settings stays in front)
    ACT="input -d 0 tap $X $Y"
    if [ "$X" = kill ]; then
      kp=$($L $I sh "pidof $P" | tr -d '\r'); [ -n "$kp" ] || { echo "refused: the app is not running"; exit 2; }
      $L $I sh 'logcat -b main -b system -b crash -b events -c'
      echo "CRASH-AT - pid=$kp (kill -9, no am crash)" > "$F-crash.txt"
      ACT="su 0 kill -9 $kp"
    fi
    NID="lane:1340-$LABEL"
    : > "$F-poll.txt"; : > "$F-events.txt"
    pushed=0
    # the crashing process stays alive (and listed bound) until the box is closed: only a bound line of ANOTHER pid counts
    OLDPID=$(sed -n 's/^CRASH-AT .* pid=\([0-9]*\).*/\1/p' "$F-crash.txt" 2>/dev/null | head -1)
    [ -n "$OLDPID" ] || { echo "refused: no crashed pid in $F-crash.txt"; exit 2; }
    echo "old (crashed) pid=$OLDPID" >> "$F-events.txt"
    # one guest shell: tap, then poll. Its lines are read here as they come.
    while IFS= read -r line; do
      line=${line%$'\r'}
      echo "$line" | tee -a "$F-poll.txt"
      if [ $pushed = 0 ] && echo "$line" | grep -q -E ' pid=[0-9]+[0-9,]* bound=[1-9] ' && ! echo "$line" | grep -q -E " pid=([0-9]+,)*$OLDPID(,[0-9]+)* "; then
        pushed=1
        (
          echo "HOST bound seen at guest $(echo "$line" | cut -d' ' -f1); pushing the notice" >> "$F-events.txt"
          sleep "${PUSH_DELAY:-0}"; echo "PUSH_DELAY=${PUSH_DELAY:-0} s after the first bound line" >> "$F-events.txt"
          r=$($L $I notice push "{\"cls\":\"reminder\",\"title\":\"Bars heal 1340\",\"text\":\"$I $LABEL: the service is bound again\",\"id\":\"$NID\"}" 2>&1 | cut -c1-300)
          echo "NOTICE-PUSHED guest=$($L $I sh 'date +%T.%N' | tr -d '\r' | cut -c1-12) answer=$r" >> "$F-events.txt"
          for n in 1 2 3; do
            sleep 2
            g=$($L $I sh 'date +%T.%N' | tr -d '\r' | cut -c1-12)
            $L $I shot "$F-after$n.png" >/dev/null 2>&1
            echo "SHOT after$n guest-before-shot=$g file=$F-after$n.png" >> "$F-events.txt"
          done
        ) &
      fi
    done < <($L $I sh "$GUEST_ST
echo TAP-BEFORE \$(date +%T.%N | cut -c1-12)
$ACT
T0=\$(ms); echo TAP-DONE \$(date +%T.%N | cut -c1-12)
i=0
while [ \$(( \$(ms) - T0 )) -lt $((SECS * 1000)) ]; do st \"+\$(( \$(ms) - T0 ))ms\"; i=\$((i+1)); sleep 0.6; done
echo POLL-END \$(date +%T.%N | cut -c1-12)")
    wait
    cat "$F-events.txt"
    if [ $pushed = 0 ]; then
      echo "NEVER BOUND within $SECS s: no notice pushed" | tee -a "$F-events.txt"
      $L $I shot "$F-unbound.png" >/dev/null 2>&1 && echo "screenshot: $F-unbound.png"
    fi
    $L $I sh "logcat -d -v time -b main -b system -b crash -b events | grep -E '(wm_create_activity|wm_restart_activity|wm_resume_activity|wm_on_create_called|ActivityTaskManager: START).*dreamscape|BarsHeal|MelatonBars|NativeBar|Killing .*dreamscape|Start proc .*dreamscape/|Scheduling restart of crashed service .*dreamscape|has died|NativeFaults|AppNote|InboxNotif|NoteAlerts' | grep -v ' I/adbd '" | tr -d '\r' | cut -c1-330 > "$F-logcat.txt"
    echo "--- BarsHeal + process lines ($F-logcat.txt):"
    grep -E 'BarsHeal|Killing .*dreamscape|Start proc [0-9]+:jp.net.seventhreeseven.dreamscape/|Scheduling restart|gesture|early hold' "$F-logcat.txt" | cut -c1-300
    echo "app activity lines since the crash: $(grep -c -E '(wm_create_activity|wm_restart_activity|wm_resume_activity|wm_on_create_called|ActivityTaskManager: START).*dreamscape' "$F-logcat.txt")"
    $L $I sh "$GUEST_ST
st final
dumpsys accessibility | grep -E '^ +(Bound|Binding|Crashed|Enabled) services' | cut -c1-400
echo ens=\$(settings get secure enabled_accessibility_services)
dumpsys package \$P | grep -E 'WRITE_SECURE_SETTINGS' | sort -u
dumpsys activity activities | grep -E 'topResumedActivity'
echo nav=\$(settings get secure navigation_mode) holder=\$(pidof melaton_navblank)
dumpsys activity activities | grep -cE '(Resumed|Hist).*jp.net.seventhreeseven.dreamscape/' | sed 's/^/app-activity-records=/'
dumpsys activity services \$P | grep -E 'ServiceRecord' | sed -E 's/.*ServiceRecord\{[0-9a-f]+ u0 //' | tr '\n' ' '; echo" | tr -d '\r' | tee "$F-dump.txt";;

  clear)
    $L $I notice clear "lane:1340-$LABEL" 2>&1 | cut -c1-200;;
  *) echo "pre|crash|watch|clear"; exit 2;;
esac
