#!/system/bin/sh
# StaticForge #1392: what is the app's main thread doing while a new Dreamscape process "says nothing"?
# Runs INSIDE a lane emulator as root (never on a real phone: it kills the app's main process in `kill` mode).
#   sh stall-watch-guest.sh <kill|wait|screenoff> <old main pid> [watch seconds] [dump offsets in s, space separated | none]
# kill: kill -9 the old pid itself, then watch the new one. wait: something else replaces the process (an update).
# screenoff: no new process; the display is switched off (power key) and the SAME process is watched. The caller switches it on again.
# Output in /data/local/tmp/s1392/:
#   hb.txt        "<wall ms> <uptime s>" every 0.1 s, never looks at any process: a gap here is the whole guest not running
#   ticks.txt     every 0.5 s: the main thread's state, wchan, kernel stack, /proc/pressure, loadavg
#   threads-N.txt every thread's state + wchan at offset N
#   debuggerd-N.txt  `debuggerd -b` (all threads, native + Java frames) at offset N
#   a11y-N.txt    the accessibility manager's window list per display (types only, no titles) and the displays' states at offset N
#   traces/       the ART SIGQUIT dumps (Java stacks with lock owners) of the app AND of system_server
# The guest's sh does 32-bit arithmetic: sums are in seconds, ms stamps are only printed.
PKG=jp.net.seventhreeseven.dreamscape
O=/data/local/tmp/s1392
MODE=$1; OLD=$2; DUR=${3:-45}; DUMPS=${4:-"4 8 14 22"}
rm -rf $O; mkdir -p $O/traces; : > $O/run
now() { date +%s%3N; }
ev() { echo "$(now) $*" >> $O/events.txt; }
: > $O/start
( i=0; while [ -e $O/run ] && [ $i -lt 2400 ]; do up=''; read -r up _ < /proc/uptime; echo "$(now) $up" >> $O/hb.txt; sleep 0.1; i=$((i+1)); done ) &
sleep 1
P=''
if [ "$MODE" = screenoff ]; then ev "KEYCODE_SLEEP, same process $OLD"; P=$OLD; input keyevent 223
elif [ "$MODE" = kill ]; then ev "kill -9 $OLD"; kill -9 "$OLD"; else ev "waiting for the process $OLD to be replaced"; fi
S=$(date +%s)
while [ -z "$P" ] && [ $(( $(date +%s) - S )) -lt 180 ]; do
  for q in $(pidof $PKG); do [ "$q" != "$OLD" ] && P=$q; done
  [ -n "$P" ] && break
  sleep 0.1
done
[ -n "$P" ] || { ev "no new process in 180 s"; rm -f $O/run; : > $O/done; exit 1; }
ev "new pid $P"
S=$(date +%s)
threads() { # <label>
  for t in /proc/$P/task/*; do
    i=${t##*/}
    echo "$i $(cat $t/comm 2>/dev/null) state=$(sed 's/^.*) //' $t/stat 2>/dev/null | cut -c1) wchan=$(cat $t/wchan 2>/dev/null) sched=[$(cat $t/schedstat 2>/dev/null)]"
  done > $O/threads-$1.txt
}
(
  last=0
  [ "$DUMPS" = none ] && DUMPS=''
  for at in $DUMPS; do
    sleep $(( at - last )); last=$at
    [ -d /proc/$P ] || break
    # the other end of a binder call: system_server's own Java stacks (lock owners) and what it knows about the displays' windows
    SS=$(pidof system_server)
    ev "dump +$at s: SIGQUIT system_server $SS"; kill -3 $SS
    { echo "== $(now)"; dumpsys accessibility | sed -n '/Global Info/,/Window attributes/p' | grep -E '^ *(Global|Top|Active|Accessibility Focused|Display\[|A11yWindow\[)' | sed 's/\(A11yWindow\[AccessibilityWindowInfo\[\)title=[^,]*, \(displayId=[0-9]*\).*\(type=[A-Z_]*\).*/\1\2 \3/'; echo "-- displays"; dumpsys display | grep -E '^ *(mState|mCommittedState|mGlobalDisplayState|mScreenState)=|^  Display [0-9]+:'; dumpsys power | grep -E '^ *mWakefulness='; } > $O/a11y-$at.txt 2>&1
    ev "dump +$at s: a11y state done"
    ev "dump +$at s: threads"; threads $at
    ev "dump +$at s: SIGQUIT"; kill -3 $P
    ev "dump +$at s: debuggerd"; timeout 25 debuggerd -b $P > $O/debuggerd-$at.txt 2>&1; ev "dump +$at s: debuggerd done ($?)"
  done
) &
DUMPER=$!
while [ $(( $(date +%s) - S )) -lt $DUR ] && [ -d /proc/$P ]; do
  {
    echo "== $(now)"
    echo "main state=$(sed 's/^.*) //' /proc/$P/task/$P/stat 2>/dev/null | cut -c1) wchan=$(cat /proc/$P/task/$P/wchan 2>/dev/null)"
    cat /proc/$P/task/$P/stack 2>/dev/null
    echo "sched $(cat /proc/$P/task/$P/schedstat 2>/dev/null)"
    echo "faults(minflt cminflt majflt cmajflt utime stime) $(sed 's/^.*) //' /proc/$P/task/$P/stat 2>/dev/null | cut -d' ' -f8-13)"
    echo "guest $(head -1 /proc/stat)"
    for f in cpu io memory; do echo "psi $f $(head -1 /proc/pressure/$f)"; done
    echo "load $(cat /proc/loadavg)"
  } >> $O/ticks.txt
  sleep 0.5
done
wait $DUMPER
ev "watch done"
rm -f $O/run
# Android keeps /data/anr/trace_00..63 and reuses the names: a new dump is told by its time, not its name
find /data/anr -maxdepth 1 -type f -newer $O/start -exec cp {} $O/traces/ \;
logcat -d -v epoch -b main -b system -b crash -b events > $O/logcat-all.txt
dmesg 2>/dev/null | tail -400 > $O/dmesg.txt
chmod -R a+rX $O
: > $O/done
