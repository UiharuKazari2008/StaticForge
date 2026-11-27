#!/bin/bash
# run-testA.sh <run name>: one TEST A run (the same steps for release 40 and for the control with 39). Host side.
set -u
. /tmp/claude-1000/-home-kanmi-staticforge/e45cc6db-a077-4200-88cc-d5c5dd91ed64/scratchpad/s6/env.sh
R=$1
G=/data/local/tmp/s6
lg "=== TEST A $R: preconditions ==="
run $L home
sleep 20
run $L su "sh /data/local/tmp/s6.sh reject-start; sh /data/local/tmp/s6.sh listener; echo versionCode=\$(dumpsys package jp.net.seventhreeseven.dreamscape | sed -n 's/^ *versionCode=\([0-9]*\).*/\1/p' | head -1); echo shizuku_server=[\$(pidof shizuku_server)]; grep -o 'name=\"settings\">.*' /data/data/jp.net.seventhreeseven.dreamscape/shared_prefs/local_adb.xml | sed 's/&quot;/\"/g'; grep authorized_once /data/data/jp.net.seventhreeseven.dreamscape/shared_prefs/local_adb.xml; grep -E 'name=\"(enabled|softkeys|room|navOrig|navFallback)\"' /data/data/jp.net.seventhreeseven.dreamscape/shared_prefs/melaton_bars.xml; echo navigation_mode=\$(settings get secure navigation_mode); dumpsys accessibility | grep -E 'Bound services|Crashed services'; sh /data/local/tmp/s6.sh one; echo top=\$(dumpsys activity activities | grep -m1 topResumedActivity)"
run $L su "mkdir -p $G; rm -f $G/sample.txt $G/run.log $G/tcp.txt; setsid sh /data/local/tmp/s6.sh sample $G/sample.txt >/dev/null 2>&1 </dev/null & sh /data/local/tmp/s6.sh tcp-start $G/tcp.txt; sleep 3; echo sampler lines=\$(wc -l < $G/sample.txt)"
lg "--- run: kill app+holder, reject listener until the first failed hold is logged and >= 5000 ms since Start proc, then the forwarder; watched to +125 s"
run $L su "sh /data/local/tmp/s6.sh run $G/run.log 5000; cat $G/run.log"
$L su "cat $G/run.log" > $E/$R-swap.txt
lg "--- after the watch (no page call, no tap): state"
run $L su "sh /data/local/tmp/s6.sh one; echo 'holder .out=['\$(cat /data/local/tmp/melaton_navblank.out 2>/dev/null | tr '\n' '|')']'; echo navigation_mode=\$(settings get secure navigation_mode); echo overlay=\$(cmd overlay list | grep -E '\[x\].*navbar' | tr '\n' ' '); echo navFallback=[\$(grep -o 'name=\"navFallback\"[^/]*' /data/data/jp.net.seventhreeseven.dreamscape/shared_prefs/melaton_bars.xml)]; dumpsys accessibility | grep -E 'Bound services|Crashed services'; dumpsys statusbar | grep -E 'pkg=com.android.shell token|StatusBarShellCommandToken'; for p in \$(pidof melaton_navblank); do echo holder \$p ppid=\$(sed 's/^.*) //' /proc/\$p/stat | cut -d' ' -f2) cgroup=\$(grep '^0::' /proc/\$p/cgroup) cmd=[\$(tr '\0' ' ' < /proc/\$p/cmdline)]; done"
$L su "sh /data/local/tmp/s6.sh sampler-stop; sh /data/local/tmp/s6.sh tcp-stop >/dev/null; sleep 1; true" >/dev/null
$L su "cat $G/sample.txt" > $E/$R-sample.txt
$L su "cat $G/tcp.txt" > $E/$R-tcp5599.txt
TK=$(sed -n 's/^\([0-9]\{13\}\) kill -9 .*/\1/p' $E/$R-swap.txt)
NOWD=$($L sh 'date +%s%3N' | tr -d '\r')
$L sh 'logcat -d -v epoch -b main -b system -b crash' > $S/$R-raw.log
python3 -I $S/excerpt.py $((TK - 15000)) $NOWD < $S/$R-raw.log > $E/$R-logcat.txt
lg "$R: swap log $(wc -l < $E/$R-swap.txt) lines, sample $(wc -l < $E/$R-sample.txt), tcpdump $(wc -l < $E/$R-tcp5599.txt), logcat excerpt $(wc -l < $E/$R-logcat.txt)"
python3 -I $E/analyze-s6.py $E/$R > $E/$R-analysis.txt
cat $E/$R-analysis.txt
