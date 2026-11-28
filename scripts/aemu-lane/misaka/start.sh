#!/bin/bash
# Lane emulator start on Fat Misaka (StaticForge scripts/aemu-lane/lib/misaka.sh), run as user `rack`:
#   start.sh <avd> <console-port> <gpu-mode> [extra emulator args...]
# Hidden (-no-window, headless host), LANE RULE: every start carries -no-audio.
# Private AVD home and emulator home under /var/lib/rack/lane; the SDK is the host's /opt/android-sdk (read only).
LB=/var/lib/rack/lane
avd=$1; port=$2; gpu=${3:-swiftshader_indirect}; shift 3
export ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_HOME=/opt/android-sdk ANDROID_AVD_HOME=$LB/avd
export HOME=$LB/home ANDROID_EMULATOR_HOME=$LB/home/.android
export QT_QPA_PLATFORM=offscreen
EMU=${LANE_EMULATOR_DIR:-/opt/android-sdk/emulator}
export LD_LIBRARY_PATH=$EMU/lib64:$EMU/lib64/qt/lib
mkdir -p "$LB/logs" "$HOME" "$ANDROID_EMULATOR_HOME"
cd "$LB" || exit 1
# the emulator's exit status goes to the log (a process that vanishes silently was killed from outside; rc 137 = SIGKILL, 139 = SIGSEGV, 134 = abort)
: > "$LB/logs/$avd.txt"
exec setsid nohup bash -c '"$@"; echo "[start.sh] emulator exited rc=$? at $(date +%T)" >> "'"$LB/logs/$avd.txt"'"' _ "$EMU/emulator" -avd "$avd" -port "$port" -no-window -no-audio -no-boot-anim -no-metrics \
  -gpu "$gpu" -no-snapshot-save "$@" >> "$LB/logs/$avd.txt" 2>&1 < /dev/null
