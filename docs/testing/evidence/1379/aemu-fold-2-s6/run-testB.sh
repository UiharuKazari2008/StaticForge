#!/bin/bash
# run-testB.sh <run name>: one TEST B run: clean reboot (lane.sh reboot), nothing launched or tapped, watched until 180 s after boot_completed.
set -u
. /tmp/claude-1000/-home-kanmi-staticforge/e45cc6db-a077-4200-88cc-d5c5dd91ed64/scratchpad/s6/env.sh
R=$1
G=/data/local/tmp/s6
lg "=== TEST B $R: before the reboot ==="
run $L su 'sh /data/local/tmp/s6.sh one; echo shizuku_server=[$(pidof shizuku_server)]; echo app=$(pidof jp.net.seventhreeseven.dreamscape) boot_id=$(cat /proc/sys/kernel/random/boot_id) top=$(dumpsys activity activities 2>/dev/null | grep -m1 topResumedActivity)'
OLD=$($L sh 'cat /proc/sys/kernel/random/boot_id' | tr -d '\r')
rm -f $S/$R-sampler.started
# host-side: as soon as adb answers on the NEW boot (a new boot_id), start the guest sampler
(
  t0=$(date +%s)
  while [ $(( $(date +%s) - t0 )) -lt 400 ]; do
    b=$($L sh 'cat /proc/sys/kernel/random/boot_id' 2>/dev/null | tr -d '\r')
    if [ ${#b} -eq 36 ] && [ "$b" != "$OLD" ]; then
      if $L su "setsid sh /data/local/tmp/s6.sh sample $G/sample.txt >/dev/null 2>&1 </dev/null & sleep 1; echo sampler-pid=\$(cat $G/sampler.pid) uptime=\$(cut -d' ' -f1 /proc/uptime) boot_completed=[\$(getprop sys.boot_completed)] app=[\$(pidof jp.net.seventhreeseven.dreamscape)]" > $S/$R-sampler.started 2>&1 && grep -q 'sampler-pid=[0-9]' $S/$R-sampler.started; then break; fi
    fi
    sleep 1
  done
) &
POLL=$!
lg "--- lane.sh reboot (clean shutdown + cold boot; up --nosetup only sets the quiet volumes)"
run $L reboot
wait $POLL
lg "sampler start: $(cat $S/$R-sampler.started 2>/dev/null | tr '\n' ' ')"
# bounded watch: until 185 s of uptime after boot_completed
while :; do
  left=$($L su 'k=$(dmesg | grep -m1 "processing action (sys.boot_completed=1)" | sed "s/^\[ *\([0-9]*\)\..*/\1/"); u=$(cut -d. -f1 /proc/uptime); echo $(( ${k:-$u} + 185 - u ))' | tr -d '\r' | tail -1)
  case "$left" in ''|*[!0-9-]*) left=15;; esac
  [ "$left" -le 0 ] && break
  [ "$left" -gt 90 ] && left=90
  sleep $left
done
lg "--- after the watch (nothing was launched or tapped)"
run $L su 'sh /data/local/tmp/s6.sh sampler-stop; echo "clock: now_ms=$(date +%s%3N) uptime=$(cut -d" " -f1 /proc/uptime)"; echo "dmesg: $(dmesg | grep -m1 "processing action (sys.boot_completed=1)")"; logcat -d -b events -v epoch | grep -E "boot_progress_start|boot_progress_enable_screen|uc_finish_user_unlock|uc_finish_user_boot|wm_boot_animation_done|sf_stop_bootanim" | head -12; sh /data/local/tmp/s6.sh one; echo shizuku_server=[$(pidof shizuku_server)]; echo shizuku_procs="[$(ps -A -o NAME | grep -i shizuku | tr "\n" " ")]"; echo app=$(pidof jp.net.seventhreeseven.dreamscape); echo "holder .out=[$(cat /data/local/tmp/melaton_navblank.out 2>/dev/null | tr "\n" "|")]"; for p in $(pidof melaton_navblank); do echo holder $p ppid=$(sed "s/^.*) //" /proc/$p/stat | cut -d" " -f2) cgroup=$(grep "^0::" /proc/$p/cgroup); done; echo navigation_mode=$(settings get secure navigation_mode); echo overlay=$(cmd overlay list | grep -E "\[x\].*navbar" | tr "\n" " "); echo navFallback=[$(grep -o "name=\"navFallback\"[^/]*" /data/data/jp.net.seventhreeseven.dreamscape/shared_prefs/melaton_bars.xml)]; sed "s/&quot;/\"/g" /data/data/jp.net.seventhreeseven.dreamscape/shared_prefs/local_adb.xml; echo adb_wifi_enabled=$(settings get global adb_wifi_enabled); echo "listeners: $(ss -ltn | grep -E ":5555 |:5599 " | tr -s " " | tr "\n" ";")"; dumpsys accessibility | grep -E "Bound services|Crashed services"; dumpsys statusbar | grep -E "pkg=com.android.shell token|StatusBarShellCommandToken"; echo "launcher activity starts of the app in logcat: $(logcat -d -b main -b system -b events | grep -cE "(wm_create_activity|wm_on_create_called|START u0).*jp.net.seventhreeseven.dreamscape")"; echo top=$(dumpsys activity activities 2>/dev/null | grep -m1 topResumedActivity)'
$L su "cat $G/sample.txt" > $E/$R-sample.txt
$L sh 'logcat -d -v epoch -b main -b system -b crash' > $S/$R-raw.log
NOWD=$($L sh 'date +%s%3N' | tr -d '\r')
python3 -I $E/excerpt.py 0 $NOWD < $S/$R-raw.log > $E/$R-logcat.txt
$L sh 'logcat -d -v epoch -b events' > $S/$R-events.log
lg "$R: sample $(wc -l < $E/$R-sample.txt) lines, logcat excerpt $(wc -l < $E/$R-logcat.txt) lines (raw $(wc -l < $S/$R-raw.log), first raw line: $(grep -m1 -E '^ *[0-9]{9,10}\.' $S/$R-raw.log | cut -c1-80))"
