#!/bin/bash
# reboot-recovery.sh <lane-id> [--port N] [--no-reboot] [--budget SECS] [--out DIR]
#
# Part B of StaticForge #1309 / #1312: after a lane instance reboots and NOBODY touches it (no tap, no adb tcpip, no Shizuku start from
# here), everything the phone is meant to recover by itself is back:
#   port      adbd listens on the app's local ADB port again (the app asked its own adbd for it over Wireless debugging's TLS door)
#   shizuku   a Shizuku server runs (the app, or Shizuku's own boot start, started it)
#   link      the ActiveSync service is connected to the server (CaféReady: the device is online as a service)
#   notice    a one-device test notice sent after the boot reaches the device and the app posts it (the server's delivery row says
#             posted, dumpsys notification has it, shade shot when the lane can take one). No alert is set by this script and the lane
#             runs -no-audio with every volume 0: nothing plays (Yukimi: no test sounds on any phone or emulator)
#   bars      Melaton Bars' accessibility service is bound and enabled (its overlay windows exist only while the page gives it bars)
# and one INFO line, not counted: whether the app itself has Shizuku's binder (Shizuku 13.6 sends it only when the app's uid starts, so an
# app process that was up before the server only has it after its next process start).
#
# Why --port (default 5556): a lane emulator's adbd listens on 5555 after EVERY cold boot (no USB gadget, adbd falls back to its default
# port, and the emulator's own adb link rides it), so "5555 is back" would prove nothing there. The app's local ADB port is configurable
# (Advanced Tools > Port); the test sets it to 5556, which nothing listens on until the app opens it itself. The same move closes the lane's
# adb link (adbd leaves 5555), so reads go through a console redirect to that port (con redir + adb connect 127.0.0.1:<console+101> on
# Ruiko's adb server), and the app's own relay (the server's Remote Commands) as the last resort.
# The reboot is guest-side (`svc power reboot` as the shell user): `adb reboot` makes the emulator process exit in this build.
#
# Prints PASS / FAIL per item with how long after the boot it came; exit 0 only when every item passed.
# Reads only after the reboot (ss, pidof, dumpsys, logcat, the server's test-device list) and sends the one silent notice.
#   --no-reboot   check the instance as it is; --budget  seconds each item may take (default 240)
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANE=$HERE/../lane.sh
ID=${1:?usage: reboot-recovery.sh <lane-id> [--port N] [--no-reboot] [--budget SECS] [--out DIR]}; shift
REBOOT=1; BUDGET=240; APP_PORT=5556; OUT=${TMPDIR:-/tmp}/reboot-recovery-$ID-$(date +%Y%m%d-%H%M%S)
while [ $# -gt 0 ]; do
  case "$1" in
    --no-reboot) REBOOT=0; shift;;
    --port) APP_PORT=${2:?--port N}; shift 2;;
    --budget) BUDGET=${2:?--budget SECS}; shift 2;;
    --out) OUT=${2:?--out DIR}; shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
mkdir -p "$OUT"
# the pool row of lane.sh (pool_row): console port, tunnel (Ruiko's adb server) port. Keep it in step with lane.sh; an instance that still
# runs on old ports has them in $AEMU_LANE_CONFIG/<id>.ports ("<console> <tunnel> <cdp>"), which wins as it does in lane.sh.
case "$ID" in
  aemu-fold-1) CONSOLE=5556; TPORT=15101;; aemu-fold-2) CONSOLE=5558; TPORT=15102;; aemu-fold-3) CONSOLE=5564; TPORT=15103;; aemu-fold-4) CONSOLE=5572; TPORT=15104;;
  aemu-a53-1) CONSOLE=5560; TPORT=15111;; aemu-a53-2) CONSOLE=5562; TPORT=15112;; aemu-a53-3) CONSOLE=5566; TPORT=15113;; aemu-a53-4) CONSOLE=5568; TPORT=15114;;
  *) echo "not a lane id: $ID" >&2; exit 2;;
esac
PORTS_FILE=${AEMU_LANE_CONFIG:-$HOME/.config/aemu-lane}/$ID.ports
if [ -f "$PORTS_FILE" ]; then read -r pc pt _ < "$PORTS_FILE"; [ -n "${pc:-}" ] && [ -n "${pt:-}" ] && { CONSOLE=$pc; TPORT=$pt; }; fi
SERIAL=emulator-$CONSOLE
CHAN_PORT=$((CONSOLE + 101))
CHAN=127.0.0.1:$CHAN_PORT                  # the console redirect to the app's port, as seen by Ruiko's adb server
AGENT=${COORD_AGENT_ID:-${AGENT_COORD_ID:-claude-${CLAUDE_CODE_SESSION_ID:0:8}}}

L() { "$LANE" --agent "$AGENT" "$ID" "$@"; }
ADB() { ADB_SERVER_SOCKET=tcp:127.0.0.1:$TPORT adb "$@"; }
# one command in the guest: the lane's adb link while it is up, else the redirect to the app's port, else the app's own relay (server API)
G() {
  local out
  if out=$(ADB -s "$SERIAL" shell "$*" 2>&1) && ! echo "$out" | grep -q 'device offline\|not found\|closed'; then echo "$out" | tr -d '\r'; return 0; fi
  if ADB -s "$CHAN" get-state >/dev/null 2>&1 || { python3 "$HERE/../lib/con.py" "$CONSOLE" redir add tcp:$CHAN_PORT:"$APP_PORT" >/dev/null 2>&1; ADB connect "$CHAN" >/dev/null 2>&1; ADB -s "$CHAN" get-state >/dev/null 2>&1; }; then
    ADB -s "$CHAN" shell "$*" 2>&1 | tr -d '\r'; return 0
  fi
  [ -n "${DEV:-}" ] && api POST "/api/activesync/adb/$DEV/shell" "$(python3 -c 'import json,sys; print(json.dumps({"command": sys.argv[1]}))' "$*")" 2>/dev/null \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("output") or "")'
}
uptime_s() { G 'cut -d. -f1 /proc/uptime' | tail -1; }
pass=0; fail=0
result() { # result PASS|FAIL|INFO <item> <detail>
  printf '%-5s %-8s %s\n' "$1" "$2" "$3"
  case "$1" in PASS) pass=$((pass+1));; FAIL) fail=$((fail+1));; esac
}

# wait_for <item> <what it measures> <cmd...>: runs <cmd> every 4 s until it succeeds or the budget is spent
wait_for() {
  local item=$1 what=$2; shift 2
  local t0 up
  t0=$(date +%s)
  while :; do
    if "$@"; then up=$(uptime_s); result PASS "$item" "$what; guest uptime ${up:-?} s, $(( $(date +%s) - T_CHECK )) s after the first check"; return 0; fi
    [ $(( $(date +%s) - t0 )) -ge "$BUDGET" ] && { result FAIL "$item" "$what: not within ${BUDGET} s"; return 1; }
    sleep 4
  done
}

# ---------------------------------------------------------------- the server's side (admin API on loopback, the key lane.sh uses)
KEY=$(tr -d '[:space:]' < ~/.secrets/dreamscape-claude.key)
api() { curl -sS -m 60 -X "$1" -H "Authorization: Bearer $KEY" -H "X-StaticForge-App-Key: $KEY" -H 'User-Agent: claude-code' -H 'Content-Type: application/json' ${3:+--data "$3"} "http://127.0.0.1:9220$2"; }
lane_device_id() { api GET /api/test-devices | python3 -c '
import sys, json
want = sys.argv[1]
for x in json.load(sys.stdin).get("devices", []):
    if want in (x.get("name") or ""): print(x["id"]); break' "$ID"; }
c_link() { api GET /api/test-devices | python3 -c '
import sys, json
want = sys.argv[1]
for x in json.load(sys.stdin).get("devices", []):
    if x["id"] == want and x.get("online") and x.get("service"): sys.exit(0)
sys.exit(1)' "$DEV"; }
delivery_posted() { api GET "/api/test-devices/deliveries?device=$DEV" | python3 -c '
import sys, json
nid = sys.argv[1]
for d in json.load(sys.stdin).get("deliveries", []):
    if d.get("id") == nid and d.get("postedAt"): sys.exit(0)
sys.exit(1)' "$1"; }

# ---------------------------------------------------------------- the checks (reads only)
c_port()    { G "ss -ltn 2>/dev/null | grep -E ':$APP_PORT '" | grep -q LISTEN; }
c_shizuku() { [ -n "$(G 'pidof shizuku_server' | tail -1)" ]; }
c_bars()    { G "dumpsys accessibility" | grep -q 'Bound services.*Melaton Bars'; }
notif_has() { G "dumpsys notification --noredact" | grep -q "$1"; }

# ---------------------------------------------------------------- run
echo "reboot-recovery on $ID (app port $APP_PORT), evidence in $OUT"
DEV=$(lane_device_id)
[ -n "$DEV" ] || { result FAIL setup "no test device named like \"$ID\" in /api/test-devices (lane.sh $ID provision)"; exit 1; }
if [ "$REBOOT" = 1 ]; then
  # arrange (before the reboot, so it is setup and not recovery): the app's local ADB port is $APP_PORT and the recovery settings are on, as on the Fold
  L eval "window.AndroidActiveSync.setAdbSettings(JSON.stringify({allow:true,autoRestore:true,shizukuAutoStart:true,shizukuRecover:true,wifiDebugOff:true,preferred:'adb',port:$APP_PORT,features:{radioRead:true,radioModify:true,install:true,screenshots:true,castRead:true,castInteract:true,commands:true,portForward:true,filesRead:true,filesWrite:true}}))" > "$OUT/arrange.json" 2>&1
  grep -q '"value":true' "$OUT/arrange.json" || { result FAIL setup "could not set the app's port/settings through the page: $(head -c 200 "$OUT/arrange.json")"; exit 1; }
  api PUT "/api/activesync/adb/$DEV/settings" '{"features":{"commands":true}}' > /dev/null 2>&1    # the server's copy, so its relay may run commands
  echo "before: listening $(G "ss -ltn 2>/dev/null | grep -oE ':55[0-9][0-9] ' | tr -d '\n'"), service.adb.tcp.port '$(G 'getprop service.adb.tcp.port')'"
  echo "rebooting the guest (svc power reboot) at $(date +%T) ..."
  G 'svc power reboot' > "$OUT/reboot.txt" 2>&1 || true
  sleep 20
  # booted? through G: the lane's adb link while it is up, else the redirect to the app's port once the app opened it, else the app's relay.
  # (Not the lane's link alone: the app moves adbd off 5555, which takes that link offline for good, and the loop would run its whole 240 s.)
  for _ in $(seq 1 60); do [ "$(G 'getprop sys.boot_completed' 2>/dev/null | tail -1)" = 1 ] && break; sleep 4; done
fi
T_CHECK=$(date +%s)
echo "from here nothing is touched; guest uptime $(uptime_s) s"

wait_for port    "adbd listens on the app's port $APP_PORT (nobody ran adb tcpip)"        c_port
wait_for shizuku "a Shizuku server runs"                                                  c_shizuku
wait_for link    "the ActiveSync service is connected to the server"                      c_link
TS=$(date +%s)
NID="b1312:reboot:$TS"
TITLE="reboot-test $TS"
# stored for the test lane (mode get), then handed to THIS device only (catch-up)
api POST /api/test-devices/notice "{\"id\":\"$NID\",\"mode\":\"get\",\"title\":\"$TITLE\",\"text\":\"sent after the reboot, nobody touched the phone\"}" > "$OUT/notice.json" 2>&1
api POST "/api/test-devices/$DEV/catch-up" > "$OUT/catch-up.json" 2>&1
wait_for notice  "the notice \"$TITLE\" reached this device and the app posted it (server delivery row posted)" delivery_posted "$NID"
# Since #1321 no Dreamscape notice is an Android notification (the app's own box, or the "..." holder when no box can show): the server's
# delivery row (the app's as_event inbox.posted, how box|held) is the proof that the app took it; Android must hold NO copy of it.
if notif_has "$TITLE"; then result FAIL notice "an Android notification carries \"$TITLE\" (#1321: none may)"; else result PASS notice "Android holds no copy of the notice (#1321: the app's own box / holder)"; fi
L shade "$OUT/shade.png" > "$OUT/shade.json" 2>&1 && echo "      shade shot: $OUT/shade.png (only when the lane's adb link is up)"
api POST "/api/test-devices/notice/$NID/clear" > /dev/null 2>&1
wait_for bars    "Melaton Bars' accessibility service is bound"                           c_bars

# ---------------------------------------------------------------- evidence
G "logcat -d | grep -E 'LocalAdb|AdbWireless|ActiveSyncBoot|Shizuku|shizuku_server|BinderSender: Uid .*(starts|dead)' | grep -vE 'avc:|nativeloader|dex2oat'" > "$OUT/logcat-recovery.txt" 2>&1 || true
last=$(grep 'LocalAdb: pass (' "$OUT/logcat-recovery.txt" | tail -1)
if echo "$last" | grep -q 'shizukuUsable=true'; then result INFO shizuku-app "the app has Shizuku's binder (usable): $(echo "$last" | cut -c1-200)"
else result INFO shizuku-app "the app does not have Shizuku's binder yet (Shizuku 13.6 sends it when the app's process next starts): ${last:-no pass line}"; fi
echo "--- recovery log lines (LocalAdb / AdbWireless / ActiveSyncBoot / Shizuku), full file $OUT/logcat-recovery.txt:"
grep -E 'LocalAdb|AdbWireless|ActiveSyncBoot|start_server' "$OUT/logcat-recovery.txt" | cut -c1-250 | head -40
echo "--- $pass passed, $fail failed"
[ "$fail" = 0 ]
