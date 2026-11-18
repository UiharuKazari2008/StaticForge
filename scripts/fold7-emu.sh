#!/bin/bash
# fold7-emu.sh - the Galaxy Z Fold7 test emulator on Ruiko (AVD fold7-test), so phone behaviour is tested there and
# not on Yukimi's phone (Nov 18 2026). Runs hidden in Ruiko's session 0 (started through WMI, never on her desktop),
# from a private SDK root C:\Users\ykaza\claude-fold7\sdk (emulator 37.2, Android 17 / API 37.0 google_apis x86_64,
# userdebug: adb root). Every adb call is pinned to this emulator's serial: the A53, the other session's emulator and
# the Fold (also on Ruiko's adb server) are never touched.
#
# Geometry (the real Fold7's): inner 1968x2184, cover 1080x2520, density 360 (2.25). The Android cutout is set to the
# Fold7's cameras with a fabricated framework overlay (inner Rect(1450,18,1520,88), cover Rect(510,0,570,102)); the
# status bar follows it (inner 88 px, cover 102 px). A fold = logical display 0 resized to the cover panel +
# hinge sensor 0 (what One UI does; the app reads the hinge and smallestScreenWidthDp) + the cover cutout.
#
#   fold7-emu.sh up                 boot if not running, wait for boot (max 4 min), apply the device setup
#   fold7-emu.sh down               stop the emulator
#   fold7-emu.sh status             booted, posture, size, cutout, app pid
#   fold7-emu.sh install <apk>      install an APK once (skipped when the same file was already installed)
#   fold7-emu.sh appsetup           the app as on the Fold: bars service, notification listener, home app
#   fold7-emu.sh cdp                forward the app's WebView DevTools to localhost:$CDP (default 9352), list pages
#   fold7-emu.sh fold | unfold      cover / inner screen (with the matching cutout and status bar height)
#   fold7-emu.sh rotate 0..3|auto   fixed rotation / auto-rotate
#   fold7-emu.sh net on|off|hang|slow|flaky   network: normal / wifi+data off / HTTPS black-holed (requests hang) /
#                                   netem 2 s delay at 64 kbit/s / netem 40 % loss, 300+-200 ms delay
#   fold7-emu.sh start-app | stop-app | home | other
#   fold7-emu.sh tap X Y | key KEYCODE | shot out.png | ui out.xml | sh 'cmd' | adb <args> | con <console cmd>
#
# Env: FOLD7_PORT (console port, 5570 = emulator-5570), FOLD7_CDP (9352), FOLD7_TUNNEL (local port for Ruiko's adb
# server, 15047). Needs ~/.secrets/aemu-console.token (Ruiko's emulator console token) for console commands.
set -uo pipefail
PORT=${FOLD7_PORT:-5570}
SERIAL=emulator-$PORT
PKG=jp.net.seventhreeseven.dreamscape
TPORT=${FOLD7_TUNNEL:-15047}
CDP=${FOLD7_CDP:-9352}
BASE='C:\Users\ykaza\claude-fold7'
RADB='E:\Users\kazari\android\sdk\platform-tools\adb.exe'
LOG=/tmp/fold7-emu-tunnel.log
TOKEN_FILE=${FOLD7_CONSOLE_TOKEN:-$HOME/.secrets/aemu-console.token}
export ADB_SERVER_SOCKET=tcp:127.0.0.1:$TPORT

# Fold7 cameras (px, natural portrait orientation of each panel; @left = from the left edge, not the centre)
INNER_CUTOUT='M 1450,18 L 1520,18 L 1520,88 L 1450,88 Z @left'
# logical display 0 resized to 1080x2520 on the 1968 px panel scales the cutout by 1080/1968: pre-scaled so Android
# reports Rect(510,0,570,102) on the cover
COVER_CUTOUT='M 929.333,0 L 1038.667,0 L 1038.667,185.867 L 929.333,185.867 Z @left'

open_port() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null; }
tunnel() {
  # one ssh session: Ruiko's adb server (kept alive by the remote loop; it dies with the ssh session that started it),
  # the emulator console and the DevTools forward
  open_port "$TPORT" && return 0
  nohup ssh -o ConnectTimeout=8 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -L "$TPORT:127.0.0.1:5037" -L "$PORT:127.0.0.1:$PORT" -L "$CDP:127.0.0.1:$CDP" ruiko \
    "\$a='$RADB'; & \$a start-server | Out-Null; while (\$true) { Start-Sleep 30; & \$a start-server | Out-Null }" \
    > "$LOG" 2>&1 &
  for _ in $(seq 1 10); do sleep 1; open_port "$TPORT" && return 0; done
  echo "fold7-emu: tunnel to Ruiko failed (see $LOG)" >&2; return 1
}
A() { adb -s "$SERIAL" "$@"; }
S() { adb -s "$SERIAL" shell "$@"; }
running() { adb devices 2>/dev/null | grep -q "^$SERIAL[[:space:]]"; }
booted() { [ "$(S getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; }
disp0() { S dumpsys SurfaceFlinger --display-id 2>/dev/null | awk '/HWC display 0/ {print $2; exit}'; }
apppid() { S pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}'; }

con() {
  # emulator console (auth token from Ruiko's ~/.emulator_console_auth_token, kept locally)
  node -e '
    const net = require("net"); const fs = require("fs");
    const [port, tokFile, ...cmd] = process.argv.slice(1);
    const tok = fs.readFileSync(tokFile, "utf8").trim();
    const s = net.connect(Number(port), "127.0.0.1"); let buf = ""; let step = 0; let out = "";
    s.setTimeout(10000, () => { console.error("console timeout"); process.exit(1); });
    s.on("data", (d) => {
      buf += d.toString();
      if (!/(^|\n)(OK|KO:[^\n]*)\r?\n$/.test(buf)) return;
      if (step === 0) { s.write(`auth ${tok}\n`); }
      else if (step === 1) { if (buf.includes("KO")) { console.error("console auth failed"); process.exit(1); } s.write(cmd.join(" ") + "\n"); }
      else { out = buf; s.end("quit\n"); }
      step += 1; buf = "";
    });
    s.on("close", () => { out = out.replace(/\r/g, "").replace(/\n?OK\n$/, "").trim(); if (out) console.log(out); process.exit(/KO:/.test(out) ? 1 : 0); });
    s.on("error", (e) => { console.error(e.message); process.exit(1); });
  ' "$PORT" "$TOKEN_FILE" "$@"
}

# The Fold7's camera as Android's display cutout for the posture now: a fabricated framework overlay (root);
# LocalDisplayAdapter re-reads the cutout when an overlay changes, no reboot. Android sizes the status bar to the
# cutout's bottom: inner 88 px (the Fold: ~89), cover 102 px (the Fold: ~102). The shell cannot fabricate a dimen
# (int / string types only), so the bar height is not set separately.
posture_overlay() {
  local path=$INNER_CUTOUT want='1450, 18 - 1520, 88'
  [ "$1" = cover ] && { path=$COVER_CUTOUT; want='929, 0 - 1039, 186'; }
  S "cmd overlay fabricate --target android --name fold7cam android:string/config_mainBuiltInDisplayCutout 0x03 '$path' >/dev/null 2>&1; cmd overlay enable --user 0 com.android.shell:fold7cam >/dev/null 2>&1" || true
  # wait (max ~5 s) until the window manager has it on display 0 (the cover path reads pre-scaled until the size changes)
  for _ in $(seq 1 10); do
    S "dumpsys window displays 2>/dev/null | grep -m1 'mDisplayCutout='" | grep -q "$want" && return 0
    sleep 0.5
  done
}

setup_device() {
  A root >/dev/null 2>&1; sleep 2
  A wait-for-device
  # never sleeps or locks (a test machine): stay awake on power, longest timeout, no keyguard
  S settings put global stay_on_while_plugged_in 15
  S settings put system screen_off_timeout 2147483647
  S locksettings set-disabled true >/dev/null 2>&1 || true
  S wm dismiss-keyguard >/dev/null 2>&1 || true
  S wm density 360 >/dev/null
  posture_overlay inner
}

tunnel || exit 1
cmd=${1:-help}; shift || true
case "$cmd" in
  up)
    if ! running; then
      ssh -o ConnectTimeout=8 ruiko "\$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd.exe /c $BASE\\start.cmd $PORT ${1:-}'; CurrentDirectory = '$BASE' }; 'start rc=' + \$r.ReturnValue"
    fi
    t0=$(date +%s)
    while :; do
      if running && booted; then echo "booted ($(( $(date +%s) - t0 )) s)"; setup_device; exit 0; fi
      [ $(( $(date +%s) - t0 )) -gt 240 ] && { echo "fold7-emu: not booted after 240 s (Ruiko $BASE\\log.txt)" >&2; exit 1; }
      sleep 5
    done;;
  down) con kill;;
  con) con "$@";;
  adb) A "$@";;
  sh) S "$*";;
  setup) setup_device; echo set up;;
  appsetup)
    # the app as on the Fold: bars over other programs (accessibility service), its notification listener, home app
    S settings put secure enabled_accessibility_services "$PKG/$PKG.MelatonBarService"
    S settings put secure accessibility_enabled 1
    S cmd notification allow_listener "$PKG/$PKG.activesync.ActiveSyncNotificationListener"
    S pm enable "$PKG/$PKG.HomeAlias" >/dev/null
    S cmd package set-home-activity "$PKG/$PKG.HomeAlias" >/dev/null
    echo "app set up (bars service, notification listener, home)";;
  install)
    apk=${1:?apk path}
    [ -r "$apk" ] || { echo "no such apk: $apk" >&2; exit 1; }
    sum=$(sha256sum "$apk" | cut -c1-64)
    if [ "$(S cat /data/local/tmp/fold7-apk.sha 2>/dev/null | tr -d '\r')" = "$sum" ]; then echo "already installed: $(basename "$apk")"; exit 0; fi
    # once per build (android-app-builds rule): the marker is written before the result is known, so a failed or
    # interrupted install is never retried automatically
    S "echo $sum > /data/local/tmp/fold7-apk.sha"
    A install -r -g "$apk";;
  cdp)
    p=$(apppid); [ -n "$p" ] || { echo "app not running" >&2; exit 1; }
    A forward tcp:$CDP localabstract:webview_devtools_remote_$p >/dev/null && curl -s -m 5 "localhost:$CDP/json/list";;
  fold)
    # the cutout first (Android applies it with a lag), then the size: SystemUI sizes its bar on the size change
    con fold >/dev/null 2>&1; con sensor set hinge-angle0 0 >/dev/null
    posture_overlay cover; S wm size 1080x2520; echo folded;;
  unfold)
    con unfold >/dev/null 2>&1; con sensor set hinge-angle0 180 >/dev/null
    posture_overlay inner; S wm size reset; echo unfolded;;
  rotate)
    if [ "${1:-}" = auto ]; then S settings put system accelerometer_rotation 1
    else S settings put system accelerometer_rotation 0; S settings put system user_rotation "${1:-0}"; fi;;
  net)
    # clear every earlier mode first (netem on both links: wlan0 = Wi-Fi, eth0 = mobile data)
    S "for d in wlan0 eth0; do tc qdisc del dev \$d root 2>/dev/null; done; iptables -D OUTPUT -p tcp --dport 443 -j DROP 2>/dev/null; ip6tables -D OUTPUT -p tcp --dport 443 -j DROP 2>/dev/null; true"
    case "${1:-on}" in
      on) S svc wifi enable; S svc data enable;;
      off) S svc wifi disable; S svc data disable;;
      hang) S svc wifi enable; S svc data enable; S "iptables -I OUTPUT -p tcp --dport 443 -j DROP; ip6tables -I OUTPUT -p tcp --dport 443 -j DROP";;
      slow) S svc wifi enable; S svc data enable; S "for d in wlan0 eth0; do tc qdisc add dev \$d root netem delay 2000ms rate 64kbit; done";;
      flaky) S svc wifi enable; S svc data enable; S "for d in wlan0 eth0; do tc qdisc add dev \$d root netem delay 300ms 200ms loss 40%; done";;
      *) echo "net on|off|hang|slow|flaky" >&2; exit 2;;
    esac; echo "net ${1:-on}";;
  # always on display 0 (the emulator keeps the cover panel as a second display; monkey may pick it)
  start-app) S am start --display 0 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PKG/.MainActivity" >/dev/null; sleep 1; echo "app pid: $(apppid)";;
  stop-app) S am force-stop "$PKG";;
  home) S input -d 0 keyevent KEYCODE_HOME;;
  other) S am start --display 0 -a android.settings.SETTINGS >/dev/null; echo "Settings in front";;
  tap) S input -d 0 tap "$1" "$2";;
  key) S input -d 0 keyevent "$1";;
  shot) S screencap -d "$(disp0)" -p /data/local/tmp/fold7.png && A pull /data/local/tmp/fold7.png "${1:-/tmp/fold7.png}" >/dev/null && echo "${1:-/tmp/fold7.png}";;
  ui) S uiautomator dump /data/local/tmp/fold7.xml >/dev/null && A pull /data/local/tmp/fold7.xml "${1:-/tmp/fold7.xml}" >/dev/null && echo "${1:-/tmp/fold7.xml}";;
  status)
    running || { echo "not running"; exit 1; }
    echo "serial: $SERIAL booted: $(booted && echo yes || echo no)"
    echo "hinge: $(con sensor get hinge-angle0 2>/dev/null | tr -d '\r')"
    S wm size | tr -d '\r'; S wm density | tr -d '\r'
    S dumpsys display | grep -m1 -o 'DisplayCutout{[^}]*}' || true
    echo "app pid: $(apppid)";;
  *) sed -n 2,30p "$0";;
esac
