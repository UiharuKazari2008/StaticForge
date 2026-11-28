#!/bin/bash
# StaticForge #1392: ONE display-off start of Dreamscape on the A53 (the agents' own phone; never the Fold).
# The start: `adb install -r` of the APK that is already installed, once, with the screen switched off (KEYCODE_SLEEP; the
# A53 then dozes, DOZE / DOZE_SUSPEND, not OFF) - it replaces the process as an update does (the A53 gives no root, so
# there is no kill -9). Never loops, never installs twice.
# Needs the coord lease "a53" (a53.sh refuses without it). The PIN is read by a53.sh and here only to run
# `locksettings verify` before the screen is locked; it is never printed.
#   bash measure.sh <apk> <raw output dir outside the repo>
set -u
APK=${1:?apk}; RAW=${2:?raw dir}
TREE=/home/kanmi/staticforge
export A53_AGENT=${A53_AGENT:-claude-974b3227}
A53=$TREE/scripts/aemu-lane/a53/a53.sh
PKG=jp.net.seventhreeseven.dreamscape
mkdir -p "$RAW"
now() { date +%H:%M:%S; }
say() { echo "$(now) $*"; }

"$A53" status 2>&1 | tee "$RAW/status-before.txt" || exit 1
# a53.sh keeps the phone's current address in its env file
. "${A53_ENV:-$HOME/.config/a53/a53.env}"
ADB=${A53_ADB:-$HOME/.local/bin/adb}
SER=$A53_IP:5555
a() { timeout "${T:-30}" "$ADB" -s "$SER" "$@"; }
[ "$(a shell getprop ro.serialno | tr -d '\r')" = R5CT71TSEMZ ] || { say "STOP: $SER is not the A53"; exit 1; }

say "installed: $(a shell dumpsys package $PKG | grep -m1 -o 'versionCode=[0-9]*')"
say "apk file sha256: $(sha256sum "$APK" | cut -c1-64)"
BASE=$(a shell pm path $PKG | tr -d '\r' | sed -n 's/^package://p' | head -1)
say "phone's base.apk sha256: $(a shell sha256sum "$BASE" | cut -c1-64)"
[ "$(a shell sha256sum "$BASE" | cut -c1-64)" = "$(sha256sum "$APK" | cut -c1-64)" ] || { say "STOP: the file is not the installed APK"; exit 1; }
say "a11y services enabled: $(a shell settings get secure enabled_accessibility_services | tr -d '\r' | grep -o "$PKG[^:]*" | tr '\n' ' ')"
say "displays: $(a shell dumpsys display | grep -cE '^  Display [0-9]+:') ; wakefulness $(a shell dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*')"
OLD=$(a shell pidof $PKG | tr -d '\r'); say "old pids: $OLD"
a shell dumpsys battery | grep -E '^  (level|AC powered|USB powered):' | tr -d '\r' | tr '\n' ' '; echo

# the PIN must be right before the screen is locked (a53.sh unlock brings it back)
PIN=$(tr -d '[:space:]' < "$HOME/.secrets/ruiko-windows-pin.token")
V=$(a shell "locksettings verify --old $PIN" 2>&1 | tr -d '\r')
unset PIN
case "$V" in *"verified successfully"*) say "PIN verifies" ;; *) say "STOP: the stored PIN did not verify; the screen stays on"; exit 1 ;; esac

T0=$(a shell date +%s.%3N | tr -d '\r')
say "device time T0 $T0"
a shell input keyevent KEYCODE_SLEEP
sleep 12
say "after sleep: $(a shell dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*') $(a shell dumpsys display | grep -m1 -oE 'mScreenState=[A-Z_]+|mState=[A-Z_]+')"
T1=$(a shell date +%s.%3N | tr -d '\r')
say "install -r (once), device time $T1"
T=240 a install -r "$APK" 2>&1 | tail -2
sleep 60
say "after the start: $(a shell dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*') ; new pids: $(a shell pidof $PKG | tr -d '\r')"
T=90 a logcat -d -v epoch -b main -b system -b events -T "$T1" > "$RAW/logcat-raw.txt"
say "logcat lines: $(wc -l < "$RAW/logcat-raw.txt")"
say "unlock:"
"$A53" unlock 2>&1 | tail -3
sleep 8
say "end: $(a shell dumpsys window | grep -m1 -o 'isKeyguardShowing=[a-z]*') ; $(a shell dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*') ; $(a shell dumpsys package $PKG | grep -m1 -o 'versionCode=[0-9]*')"
a exec-out screencap -p > "$RAW/after-unlock.png"
T=90 a logcat -d -v epoch -b main -b system -b events -T "$T1" > "$RAW/logcat-raw-after-unlock.txt"
say done
