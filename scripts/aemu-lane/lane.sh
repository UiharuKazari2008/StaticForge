#!/bin/bash
# lane.sh - the Android emulator lane on Ruiko (StaticForge #1309 / #1312). One command per action, JSON answers.
# Docs: docs/testing/emulator-lane.md. Pool: aemu-fold-1..4, aemu-a53-1..4.
#
#   lane.sh list                                   every pool id: created, running, golden, lease holder (JSON)
#   lane.sh create <fold|a53> <n>                  make the AVD, boot, provision (app, Shizuku, sign-in, partner), save `golden`
#   lane.sh reap                                   stop instances nobody used for 30 min (also run by a Ruiko scheduled task)
#   lane.sh <id> up [--golden] | down | status | reset | reboot | wait-boot [secs]
#   lane.sh <id> provision                         the setup steps of `create` again on an existing instance
#   lane.sh <id> posture closed|half|open          fold: cover / hinge 90 / inner
#   lane.sh <id> rotate 0..3|auto
#   lane.sh <id> display add-external [WxH@dpi] | remove-external     a second display (DeX / NexDock)
#   lane.sh <id> shot <out.png> [display-id|inner|cover|external|all] | shade <out.png> | notifs | logcat [secs] [--all]
#   lane.sh <id> sound [--since <ms>] [--wav] | notice push|get '<json>' | notice clear <noticeId>
#   lane.sh <id> kill-page | kill-app | start-app | stop-app | home | other | doze on|off | screen on|off
#   lane.sh <id> net on|off|hang|slow|flaky
#   lane.sh <id> install-release [buildId] | shizuku start|stop|status | adbd status|tcpip|wireless on|off
#   lane.sh <id> cdp | eval '<js>' | tap X Y | key KEYCODE | text 'str' | tap-text '<regex>' | sh '<cmd>' | adb <args>
#
# Caller identity for the coord lease check: --agent <id> or env COORD_AGENT_ID (else AGENT_COORD_ID, else
# claude-<first 8 of CLAUDE_CODE_SESSION_ID>). Driving commands refuse an instance whose lease the caller does not hold
# (coord_device_request <id> first). LANE_NO_LEASE=1 turns the check off (for the lane's own tests).
# Every adb call is pinned to the instance serial emulator-<port>; the Fold and the other emulators on Ruiko's shared
# adb server are never addressed.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE=${AEMU_LANE_STATE:-$HOME/.cache/claude-run/aemu-lane}
CFG=${AEMU_LANE_CONFIG:-$HOME/.config/aemu-lane}
RBASE='C:\Users\ykaza\claude-lane'
RADB='E:\Users\kazari\android\sdk\platform-tools\adb.exe'
PKG=jp.net.seventhreeseven.dreamscape
SHZ=moe.shizuku.privileged.api
SHZ_APK=${LANE_SHIZUKU_APK:-$HOME/.cache/claude-run/aemu-lane/shizuku-13.6.0.apk}
COORD_DB=${AGENT_COORD_DB:-$HOME/.local/state/dreamscape-agents/coord.db}
IDLE_MIN=${LANE_IDLE_MIN:-30}
MAX_RUNNING=${LANE_MAX_RUNNING:-8}   # hard ceiling; the real limit is Ruiko's free memory (mem_guard)
# what one more running instance takes (observed qemu working set): fold 4.1-4.9 GB (3 GB guest); a53 with a 2 GB guest: see the docs
instance_gb() { case "${SHAPE:-fold}" in a53) echo "${LANE_A53_GB:-3.3}";; *) echo "${LANE_FOLD_GB:-4.6}";; esac; }
KEEP_FREE_GB=3                 # Ruiko keeps at least this free after one more instance starts
# The emulator's guest adbd ALWAYS listens on *:5555 (even with service.adb.tcp.port empty after a boot): that is the listener the
# host adb link uses, and moving it (`adb tcpip 5556`) takes the instance offline. So "5555 is back after a reboot" is true on the
# lane whatever the app does; it proves nothing about a phone. `adbd gate on|off` is a manual shim (see the docs).
LANE_ADB_PORT=5555
mkdir -p "$STATE" "$CFG" "$STATE/apk" "$STATE/shots"

# ------------------------------------------------------------------ pool table: id shape n console-port tunnel-port cdp-port
# Console ports are EVEN and inside adb's scan range 5554..5584 (adb port = console + 1): adb's server finds and RECONNECTS
# emulators there by itself. Outside it (5600 ...) an emulator is registered once at its start and stays `offline` for ever
# after a guest reboot (`adb reboot`), which no reboot test can live with. 5570 / 5580 belong to other sessions.
pool_row() {
  local r
  case "$1" in
    aemu-fold-1) r="fold 1 5556 15101 9381";;
    aemu-fold-2) r="fold 2 5558 15102 9382";;
    aemu-a53-1)  r="a53 1 5560 15111 9391";;
    aemu-a53-2)  r="a53 2 5562 15112 9392";;
    aemu-fold-3) r="fold 3 5564 15103 9383";;
    aemu-a53-3)  r="a53 3 5566 15113 9393";;
    aemu-a53-4)  r="a53 4 5568 15114 9394";;
    aemu-fold-4) r="fold 4 5572 15104 9384";;
    *) return 1;;
  esac
  # an instance still running on its old ports keeps them until it is restarted: $CFG/<id>.ports = "<console> <tunnel> <cdp>"
  if [ -f "$CFG/$1.ports" ]; then
    local shape n c t d; read -r shape n _ _ _ <<<"$r"; read -r c t d < "$CFG/$1.ports"
    [ -n "$c" ] && [ -n "$t" ] && [ -n "$d" ] && r="$shape $n $c $t $d"
  fi
  echo "$r"
}
POOL_IDS="aemu-fold-1 aemu-fold-2 aemu-fold-3 aemu-fold-4 aemu-a53-1 aemu-a53-2 aemu-a53-3 aemu-a53-4"

# ------------------------------------------------------------------ output
# J k=v ...  -> one JSON object (v is a string; n:<num>, b:<bool>, j:<json> are typed)
J() { python3 - "$@" <<'PY'
import json, sys
o = {}
for a in sys.argv[1:]:
    k, _, v = a.partition('=')
    if v[:2] == 'n:':
        try: v = int(v[2:])
        except ValueError:
            try: v = float(v[2:])
            except ValueError: v = None
    elif v[:2] == 'b:': v = v[2:] == 'true'
    elif v[:2] == 'j:':
        try: v = json.loads(v[2:])
        except ValueError: v = None
    o[k] = v
print(json.dumps(o))
PY
}
die() { local code=${2:-1}; J ok=b:false "error=$1" >&2; exit "$code"; }
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# ------------------------------------------------------------------ Ruiko (PowerShell through -EncodedCommand)
rps() {
  local enc; enc=$(printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)
  ssh -o ConnectTimeout=10 -o BatchMode=yes ruiko "powershell -NoProfile -NonInteractive -EncodedCommand $enc" 2>&1 \
    | grep -v '^#< CLIXML' | grep -v '^<Objs' | sed 's/\r$//'
}

# ------------------------------------------------------------------ argument parsing
AGENT=${COORD_AGENT_ID:-${AGENT_COORD_ID:-}}
[ -z "$AGENT" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && AGENT="claude-${CLAUDE_CODE_SESSION_ID:0:8}"
while [ "${1:-}" = --agent ]; do AGENT=${2:?--agent <id>}; shift 2; done
ID=''; cmd=${1:-help}
case "$cmd" in
  create)
    shift; [ "${1:-}" = fold ] || [ "${1:-}" = a53 ] || die "usage: lane.sh create <fold|a53> <n>" 2
    case "${2:-}" in [1-4]) ;; *) die "usage: lane.sh create <fold|a53> <1|2|3|4>" 2;; esac
    exec "$0" ${AGENT:+--agent "$AGENT"} "aemu-$1-$2" create;;
  list|reap|help|-h|--help) shift || true;;
  aemu-*) ID=$cmd; shift; cmd=${1:-status}; shift || true;;
  *) die "unknown command: $cmd (lane.sh help)" 2;;
esac

if [ -n "$ID" ]; then
  row=$(pool_row "$ID") || die "not a lane id: $ID (aemu-fold-1..4, aemu-a53-1..4)" 2
  read -r SHAPE N PORT TPORT CDP <<<"$row"
  SERIAL=emulator-$PORT
  export ADB_SERVER_SOCKET=tcp:127.0.0.1:$TPORT
  TLOG=$STATE/tunnel-$ID.log
fi

# Every adb call goes through these two, pinned to the lane serial (never `adb devices`, never another serial).
A() { adb -s "$SERIAL" "$@"; }
S() { adb -s "$SERIAL" shell "$@"; }
SR() { adb -s "$SERIAL" shell "$@" | tr -d '\r'; }
open_port() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null; }

tunnel() {
  # one ssh session per instance: Ruiko's adb server (kept alive by the remote loop), the emulator console, the DevTools port
  open_port "$TPORT" && return 0
  nohup ssh -o ConnectTimeout=8 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
    -L "$TPORT:127.0.0.1:5037" -L "$PORT:127.0.0.1:$PORT" -L "$CDP:127.0.0.1:$CDP" ruiko \
    "\$a='$RADB'; & \$a start-server | Out-Null; while (\$true) { Start-Sleep 30; & \$a start-server | Out-Null }" \
    > "$TLOG" 2>&1 &
  local _; for _ in $(seq 1 12); do sleep 1; open_port "$TPORT" && return 0; done
  die "tunnel to Ruiko failed (see $TLOG)"
}

running() { [ "$(A get-state 2>/dev/null | tr -d '\r')" = device ]; }
booted() { [ "$(SR getprop sys.boot_completed 2>/dev/null)" = 1 ]; }
apppid() { SR pidof "$PKG" 2>/dev/null | awk '{print $1}'; }
# adbd stays the shell user, as on the phone (never `adb root`: restarting adbd would kill Shizuku and 5555 would not
# be what the phone has). Root things go through the userdebug image's su: SU '<script>'.
SU() { printf '%s\n' "$*" | adb -s "$SERIAL" shell su 0 sh; }
adbd_uid() { SR id -u 2>/dev/null; }

con() { "$HERE/lib/con.py" "$PORT" "$@"; }

# ------------------------------------------------------------------ the coord lease (read-only from agent-coord's sqlite file)
lease_row() { # prints: agent_id|ends_at|consent|why   (empty when nobody holds it)
  [ -r "$COORD_DB" ] || return 0
  sqlite3 -readonly -separator '|' "$COORD_DB" "select agent_id, coalesce(ends_at,0), consent, replace(why,'|','/') from device_queue where device='$1' and state='held' order by id limit 1" 2>/dev/null
}
need_lease() {
  [ "${LANE_NO_LEASE:-0}" = 1 ] && return 0
  local row holder ends nowms; row=$(lease_row "$ID")
  if [ -z "$row" ]; then
    die "$ID has no coord lease: request it first with coord_device_request device=$ID (then release it with coord_device_release)" 3
  fi
  holder=${row%%|*}; ends=$(echo "$row" | cut -d'|' -f2); nowms=$(now_ms)
  if [ -z "$AGENT" ]; then
    die "$ID is leased to $holder; tell lane.sh who you are: --agent <your coord id> or env COORD_AGENT_ID" 3
  fi
  if [ "$holder" != "$AGENT" ]; then
    die "$ID is leased to $holder, not to $AGENT: drive only an instance you hold (coord_device_request $ID)" 3
  fi
  if [ "$ends" -gt 0 ] && [ "$ends" -lt "$nowms" ]; then
    die "your lease on $ID ended: renew it (coord_device_renew $ID)" 3
  fi
}

# ------------------------------------------------------------------ last use (the reaper reads it on Ruiko)
touch_last() {
  local f=$STATE/$ID.last t; t=$(date +%s)
  [ -f "$STATE/$ID.keep" ] && [ "$(cat "$STATE/$ID.keep")" -gt "$t" ] && return 0   # `keep` holds the idle clock in the future
  [ -f "$f" ] && [ $(( t - $(stat -c %Y "$f") )) -lt 60 ] && return 0
  : > "$f"
  rps "New-Item -ItemType Directory -Force '$RBASE\\last' | Out-Null; Set-Content -Path '$RBASE\\last\\$ID.txt' -Value $t" >/dev/null 2>&1 &
}

# ------------------------------------------------------------------ meta (per-instance facts kept locally)
meta_get() { [ -f "$CFG/$ID.env" ] && sed -n "s/^$1=//p" "$CFG/$ID.env" | tail -1; }
meta_set() { touch "$CFG/$ID.env"; grep -v "^$1=" "$CFG/$ID.env" > "$CFG/$ID.env.new" 2>/dev/null; echo "$1=$2" >> "$CFG/$ID.env.new"; mv "$CFG/$ID.env.new" "$CFG/$ID.env"; }

# ------------------------------------------------------------------ admin API on loopback (the server this script runs on)
api() { # api METHOD path [json]
  local k; k=$(tr -d '[:space:]' < ~/.secrets/dreamscape-claude.key)
  curl -sS -m 60 -X "$1" -H "Authorization: Bearer $k" -H "X-StaticForge-App-Key: $k" -H 'User-Agent: claude-code' \
    -H 'Content-Type: application/json' ${3:+--data "$3"} "http://127.0.0.1:9220$2"
}

# ------------------------------------------------------------------ Fold7 cutout + postures (as scripts/fold7-emu.sh)
INNER_CUTOUT='M 1450,18 L 1520,18 L 1520,88 L 1450,88 Z @left'
COVER_CUTOUT='M 929.333,0 L 1038.667,0 L 1038.667,185.867 L 929.333,185.867 Z @left'
posture_overlay() { # inner|cover : the Fold7's camera as Android's display cutout (fabricated overlay, root)
  local path=$INNER_CUTOUT want='1450, 18 - 1520, 88' _
  [ "$1" = cover ] && { path=$COVER_CUTOUT; want='929, 0 - 1039, 186'; }
  SU "cmd overlay fabricate --target android --name fold7cam android:string/config_mainBuiltInDisplayCutout 0x03 '$path' >/dev/null 2>&1; cmd overlay enable --user 0 com.android.shell:fold7cam >/dev/null 2>&1" || true
  for _ in $(seq 1 10); do
    S "dumpsys window displays 2>/dev/null | grep -m1 'mDisplayCutout='" | grep -q "$want" && return 0
    sleep 0.5
  done
}

# LANE RULE (Yukimi, Nov 26 2026): no alarm sound, no ringtone; test notices only soft (notification stream 2 of 7) or checked
# silently through logs. Alarm / ring / system / voice streams 0, ringer silent, media 2.
quiet_volumes() {
  local kv
  for kv in "4 0" "2 0" "1 0" "0 0" "5 2" "3 2"; do set -- $kv; S "cmd audio set-volume $1 $2" >/dev/null 2>&1; done
  S cmd audio set-ringer-mode SILENT >/dev/null 2>&1
}

noaudio_check() { # true when the qemu process of this instance carries -no-audio (never Ruiko's speakers)
  local c; c=$(rps "\$id = '$ID'
$(cat <<'PS'
(Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu-system*' -and $_.CommandLine -match ('-avd ' + $id + ' ') }).CommandLine
PS
)")
  case "$c" in *' -no-audio '*) return 0;; esac
  return 1
}

setup_device() { # root, never sleeps or locks, adb on, cutout (fold)
  A wait-for-device
  [ "$(adbd_uid)" = 0 ] && { A unroot >/dev/null 2>&1; sleep 2; A wait-for-device; }
  S settings put global stay_on_while_plugged_in 15
  S settings put system screen_off_timeout 2147483647
  S settings put global development_settings_enabled 1
  S settings put global adb_enabled 1
  S settings put global package_verifier_enable 0
  S settings put global verifier_verify_adb_installs 0
  S settings put secure show_ime_with_hard_keyboard 0
  quiet_volumes
  S locksettings set-disabled true >/dev/null 2>&1 || true
  S wm dismiss-keyguard >/dev/null 2>&1 || true
  if [ "$SHAPE" = fold ]; then S wm density 360 >/dev/null; posture_overlay inner; fi
}

dev_skew() { # device clock minus this server's clock, ms (the emulator takes Ruiko's clock)
  local d l; l=$(now_ms); d=$(SR 'date +%s%3N'); echo $(( ${d:-$l} - l ))
}
disp0() { SR dumpsys SurfaceFlinger --display-id 2>/dev/null | awk '/HWC display 0/ {print $2; exit}'; }

# ------------------------------------------------------------------ Ruiko-side process state
ruiko_emus() { # prints "<avd> <pid> <port>" per running lane emulator
  rps "$(cat <<'PS'
foreach ($x in (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'emulator.exe' })) {
  if ($x.CommandLine -match '-avd (aemu-[a-z0-9-]+).* -port (\d+)') { $matches[1] + ' ' + $x.ProcessId + ' ' + $matches[2] }
}
PS
)"
}

ruiko_free_gb() { rps '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)' | tail -1; }
ruiko_cpu() { # Ruiko's CPU load %, the mean of 5 samples over ~10 s (Win32_Processor LoadPercentage)
  rps '$v = @(); 1..5 | ForEach-Object { $v += (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; Start-Sleep -Seconds 2 }; [math]::Round(($v | Measure-Object -Average).Average, 0)' | tail -1
}
mem_guard() { # refuses when Ruiko cannot take one more instance: exit 4 = memory (under KEEP_FREE_GB free after it), exit 5 = CPU above LANE_MAX_CPU %
  local free need cpu; free=$(ruiko_free_gb); need=$(instance_gb)
  case "$free" in ''|*[!0-9.]*) ;; *)
    if awk "BEGIN{exit !($free - $need < $KEEP_FREE_GB)}"; then
      die "Ruiko has only $free GB free: one more $SHAPE instance (about $need GB) would leave it under $KEEP_FREE_GB GB. Stop one you do not need (lane.sh <id> down) or wait; instances nobody used for $IDLE_MIN min, or whose lease ended, are stopped by the reaper" 4
    fi;; esac
  cpu=$(ruiko_cpu)
  case "$cpu" in ''|*[!0-9]*) ;; *)
    if [ "$cpu" -gt "${LANE_MAX_CPU:-85}" ]; then
      die "Ruiko's CPU is at $cpu % (mean over 10 s), above ${LANE_MAX_CPU:-85} %: starting another instance would slow every running one (page downloads crawl, adb times out). Wait, or stop an instance you do not need (lane.sh <id> down)" 5
    fi;; esac
}

# only ONE create / provision runs at a time (they download ~200 MB and install ~8,000 files each): a lock file
provision_lock() {
  exec 9>"$STATE/provision.lock"
  if ! flock -n 9; then die "another create/provision is running ($(cat "$STATE/provision.lock" 2>/dev/null | head -1)): wait for it, they share Ruiko's CPU and the server's pack (exit 6)" 6; fi
  printf '%s pid %s since %s\n' "$ID" "$$" "$(date +%H:%M:%S)" > "$STATE/provision.lock"
}

start_emulator() { # start_emulator <extra emulator args>
  local extra=$1 out
  out=$(rps "\$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd.exe /c $RBASE\\start.cmd $ID $PORT $extra'; CurrentDirectory = '$RBASE' }; 'start rc=' + \$r.ReturnValue")
  echo "$out" | grep -q 'rc=0' || die "start failed: $out"
}

wait_boot() { # wait_boot <secs>
  local t0 now; t0=$(date +%s)
  while :; do
    if running && booted; then echo $(( $(date +%s) - t0 )); return 0; fi
    now=$(date +%s); [ $(( now - t0 )) -gt "${1:-240}" ] && return 1
    sleep 4
  done
}

avd_present() { [ "$(rps "if (Test-Path '$RBASE\\avd\\$ID.avd\\config.ini') { 'yes' }")" = yes ]; }
golden_present() { [ "$(rps "if (Test-Path '$RBASE\\avd\\$ID.avd\\snapshots\\golden') { 'yes' }")" = yes ]; }

# ------------------------------------------------------------------ commands: pool level
cmd_list() {
  local emus out first=1 id row lease
  emus=$(ruiko_emus)
  local present; present=$(rps "foreach (\$i in '$POOL_IDS'.Split(' ')) { \$d='$RBASE\\avd\\'+\$i+'.avd'; \$c = Test-Path \"\$d\\config.ini\"; \$g = Test-Path \"\$d\\snapshots\\golden\"; \"\$i \$c \$g\" }")
  printf '['
  for id in $POOL_IDS; do
    row=$(pool_row "$id"); set -- $row
    local created=false golden=false run=false pid=''
    echo "$present" | grep -q "^$id True" && created=true
    echo "$present" | grep -q "^$id True True" && golden=true
    echo "$emus" | grep -q "^$id " && { run=true; pid=$(echo "$emus" | awk -v i="$id" '$1==i{print $2}'); }
    lease=$(lease_row "$id")
    [ $first = 1 ] || printf ','
    first=0
    J id="$id" shape="$1" serial="emulator-$3" "console=n:$3" "cdp=n:$5" "created=b:$created" "running=b:$run" "golden=b:$golden" "pid=n:${pid:-0}" \
      "leaseHolder=${lease%%|*}" "leaseEndsAt=n:$(echo "${lease:-|0}" | cut -d'|' -f2)" | tr -d '\n'
  done
  printf ']\n'
}

cmd_reap() { # stop lane instances nobody used for IDLE_MIN minutes, and those whose coord lease ended and idle for 5 minutes
  local idle stopped='' id row j
  idle=$(rps "if (Test-Path '$RBASE\\reap.ps1') { & '$RBASE\\reap.ps1' -IdleMinutes $IDLE_MIN }" | tail -1)
  # lease ended: no held lease on a running instance that has been idle for 5 minutes (a creator / a driver holds its lease)
  local all names=''; all=$(rps "if (Test-Path '$RBASE\\reap.ps1') { & '$RBASE\\reap.ps1' -IdleMinutes 100000 -DryRun }" | tail -1)
  names=$(printf '%s' "$all" | python3 -c "
import json,sys,subprocess
try: rows=json.load(sys.stdin)
except Exception: rows=[]
rows=rows if isinstance(rows,list) else [rows]
out=[]
for r in rows:
    if r.get('idleMinutes',0)>=5: out.append(r['avd'])
print(' '.join(out))")
  local nolease=''
  for id in $names; do
    row=$(lease_row "$id"); [ -z "$row" ] && nolease="$nolease,$id"
  done
  nolease=${nolease#,}
  if [ -n "$nolease" ]; then
    rps "& '$RBASE\\reap.ps1' -IdleMinutes 0 -Names $(printf "'%s'" "$nolease" | sed "s/,/','/g")" >/dev/null
  fi
  J ok=b:true "idleReaped=j:${idle:-[]}" "leaseEndedStopped=$nolease" "idleMinutes=n:$IDLE_MIN"
}

# ------------------------------------------------------------------ dispatch
case "$cmd" in
  help|-h|--help) sed -n 2,24p "$0"; exit 0;;
  list) cmd_list; exit 0;;
  reap) cmd_reap; exit 0;;
esac

# ------------------------------------------------------------------ instance helpers
shz_dir() { SR pm path "$SHZ" 2>/dev/null | head -1 | sed 's/^package://; s#/base.apk$##'; }
shz_pid() { SR pidof shizuku_server 2>/dev/null | awk '{print $1}'; }
app_version() { SR dumpsys package "$PKG" 2>/dev/null | sed -n 's/^ *versionCode=\([0-9]*\).*/\1/p' | head -1; }
page_forward() { # forward the app's DevTools to localhost:$CDP (through the tunnel); prints the pid or nothing
  local p; p=$(apppid); [ -n "$p" ] || return 1
  A forward "tcp:$CDP" "localabstract:webview_devtools_remote_$p" >/dev/null 2>&1 || return 1
  echo "$p"
}
cdp_js() { NODE_PATH=${NODE_PATH:-/home/kanmi/staticforge/node_modules} node "$HERE/lib/cdp.js" "$CDP" "$@"; }
ui_dump() { # ui_dump -> path of a local uiautomator dump of the window hierarchy
  local f=$STATE/ui-$ID.xml
  S uiautomator dump /data/local/tmp/lane-ui.xml >/dev/null 2>&1 && A pull /data/local/tmp/lane-ui.xml "$f" >/dev/null 2>&1 && echo "$f"
}
tap_text() { # tap_text <regex> : tap the first Android view whose text / content-desc matches; false if none
  local f xy; f=$(ui_dump) || return 1
  xy=$(python3 "$HERE/lib/uitap.py" "$f" "$1") || return 1
  S input -d 0 tap $xy >/dev/null 2>&1; echo "$xy"
}
top_activity() { SR dumpsys activity activities 2>/dev/null | grep -m1 -E 'topResumedActivity' | sed 's/.* u0 //; s/ t[0-9]*}.*//'; }
hwc() { SR dumpsys SurfaceFlinger --display-id 2>/dev/null | awk -v n="$1" '$0 ~ "HWC display " n "\\)" {print $2; exit}'; }
wifi_dialog() { # the wireless debugging "Allow on this network?" box (Always allow + Allow), when it is up
  case "$(top_activity)" in *WifiDebuggingActivity*) ;; *) return 1;; esac
  local f xy; f=$(ui_dump) || return 1
  xy=$(python3 "$HERE/lib/uitap.py" "$f" 'Always allow on this network' 2>/dev/null) && S input -d 0 tap $xy >/dev/null
  tap_text 'Allow' >/dev/null
}
progress() { echo "[lane $ID] $*" >&2; }

shz_start() { # Shizuku the phone's way: the shell user runs the starter from the app's lib dir (never root, never adb root)
  [ "$(adbd_uid)" = 2000 ] || die "adbd is not the shell user (uid $(adbd_uid)); lane.sh $ID adb unroot first"
  local d; d=$(shz_dir); [ -n "$d" ] || die "Shizuku is not installed (lane.sh $ID provision)"
  local out; out=$(S "$d/lib/x86_64/libshizuku.so" 2>&1 | tr -d '\r' | tail -4 | tr '\n' ' ')
  local i; for i in 1 2 3 4 5 6 7 8; do [ -n "$(shz_pid)" ] && break; sleep 1; done
  [ -n "$(shz_pid)" ] || die "Shizuku did not start: $out"
  echo "$out"
}
shz_grant() { # Dreamscape asks, Shizuku's own dialog is tapped (uiautomator): the app's Shizuku applet "Allow Access"
  local g; g=$(SR dumpsys package "$PKG" 2>/dev/null | grep -c 'moe.shizuku.manager.permission.API_V23: granted=true')
  [ "$g" -gt 0 ] && { echo already; return 0; }
  page_forward >/dev/null || die "the app is not running"
  cdp_js eval "AndroidApplets.action('shizuku','allow','')" >/dev/null
  local i; for i in 1 2 3 4 5 6; do sleep 1.5; tap_text 'Allow all the time' >/dev/null && break; done
  sleep 1.5
  g=$(SR dumpsys package "$PKG" 2>/dev/null | grep -c 'moe.shizuku.manager.permission.API_V23: granted=true')
  [ "$g" -gt 0 ] && { echo granted; return 0; }
  die "Dreamscape was not granted Shizuku's permission"
}

latest_build() { # prints "<id> <versionCode> <sha256>" of the newest release on the server
  api GET /api/android-builds | python3 -c "
import json,sys
d=json.load(sys.stdin); b=sorted(d.get('builds',[]), key=lambda x:x['versionCode'])
print(b[-1]['id'], b[-1]['versionCode'], b[-1]['sha256']) if b else sys.exit(1)"
}
fetch_apk() { # fetch_apk <id> <versionCode> <sha256> -> path of the verified APK in the cache
  local f=$STATE/apk/dsapp-$2.apk k; k=$(tr -d '[:space:]' < ~/.secrets/dreamscape-claude.key)
  if [ ! -s "$f" ] || [ "$(sha256sum "$f" | cut -c1-64)" != "$3" ]; then
    curl -sS -m 300 -o "$f.part" -H "Authorization: Bearer $k" -H "X-StaticForge-App-Key: $k" -H 'User-Agent: claude-code' "http://127.0.0.1:9220/api/android-builds/$1/apk" || return 1
    [ "$(sha256sum "$f.part" | cut -c1-64)" = "$3" ] || { rm -f "$f.part"; return 1; }
    mv "$f.part" "$f"
  fi
  echo "$f"
}
install_release() { # install_release [buildId] [--force] : adb install -r on THIS emulator, once per build
  local want='' force=0 a; for a in "$@"; do case "$a" in --force) force=1;; *) want=$a;; esac; done
  local row bid vc sha; if [ -n "$want" ]; then
    row=$(api GET /api/android-builds | python3 -c "
import json,sys
for b in json.load(sys.stdin).get('builds',[]):
    if str(b['id'])==sys.argv[1] or str(b['versionCode'])==sys.argv[1]: print(b['id'],b['versionCode'],b['sha256'])" "$want")
  else row=$(latest_build); fi
  [ -n "$row" ] || die "no such Android build on the server ($want)"
  read -r bid vc sha <<<"$row"
  local have; have=$(S "cat /data/local/tmp/lane-apk.sha 2>/dev/null" | tr -d '\r')
  if [ "$have" = "$sha" ] && [ "$force" = 0 ]; then J ok=b:true "build=n:$bid" "versionCode=n:$vc" installed=b:false note="already installed (marker /data/local/tmp/lane-apk.sha)"; return 0; fi
  local apk; apk=$(fetch_apk "$bid" "$vc" "$sha") || die "download of build $bid failed or its sha256 differs"
  # once per build (android-app-builds rule): the marker is written before the result is known, so a failed or
  # interrupted install is never retried by this script
  S "echo $sha > /data/local/tmp/lane-apk.sha"
  local out; out=$(A install -r -g "$apk" 2>&1 | tr -d '\r' | tail -2 | tr '\n' ' ')
  case "$out" in *Success*) meta_set apk_versionCode "$vc"; J ok=b:true "build=n:$bid" "versionCode=n:$vc" installed=b:true "sha256=$sha";; *) die "install failed: $out";; esac
}
install_shizuku() {
  [ -n "$(shz_dir)" ] && [ "${1:-}" != --force ] && return 0
  [ -r "$SHZ_APK" ] || die "no Shizuku APK at $SHZ_APK (see docs/testing/emulator-lane.md)"
  A install -r "$SHZ_APK" 2>&1 | tr -d '\r' | grep -q Success || die "Shizuku install failed"
}
dev_id() { # the ActiveSync device id the app made (root reads its prefs; cached in the lane config)
  local d; d=$(SU "cat /data/data/$PKG/shared_prefs/activesync.xml 2>/dev/null" | sed -n 's/.*name="device_id">\([0-9a-f]\{32\}\)<.*/\1/p' | head -1)
  [ -n "$d" ] && { meta_set device_id "$d"; echo "$d"; return 0; }
  meta_get device_id
}
mark_test_device() { # mark_test_device <deviceId> : the fence (modules/testDevices.js), named "Lane <id>"
  api PUT "/api/test-devices/$1" "$(J "name=Lane $ID")" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('success') else 1)"
}
adb_state() { # 5555 / wireless debugging facts as JSON
  local l p ap; l=$(SR "ss -ltn 2>/dev/null | grep -c ':5555 '"); ap=$(meta_get adb_port); ap=${ap:-$LANE_ADB_PORT}
  p=$(SR "ss -ltn 2>/dev/null | grep -c ':$ap '")
  J "listening5555=b:$([ "${l:-0}" -gt 0 ] && echo true || echo false)" "note5555=always listening on the emulator (not the phone's rule): use appPort" "appPort=n:$ap" "listeningAppPort=b:$([ "${p:-0}" -gt 0 ] && echo true || echo false)" "serviceAdbTcpPort=$(SR getprop service.adb.tcp.port)" "persistAdbTcpPort=$(SR getprop persist.adb.tcp.port)" \
    "adbEnabled=$(SR settings get global adb_enabled)" "adbWifiEnabled=$(SR settings get global adb_wifi_enabled)" "adbdUid=n:$(adbd_uid)"
}
status_json() {
  local boot=false hinge='' size dens rot
  booted && boot=true
  hinge=$(con sensor get hinge-angle0 2>/dev/null | tr -d '\r' | sed 's/.*= *//')
  size=$(SR wm size | tail -1 | sed 's/.*: //'); dens=$(SR wm density | tail -1 | sed 's/.*: //')
  rot=$(SR settings get system user_rotation)
  local sp; sp=$(shz_pid)
  J ok=b:true "id=$ID" "serial=$SERIAL" shape="$SHAPE" running=b:true "booted=b:$boot" "uptimeSecs=n:$(SR cat /proc/uptime | cut -d. -f1)" \
    "androidSdk=$(SR getprop ro.build.version.sdk)" "wmSize=$size" "wmDensity=$dens" "hingeAngle=$hinge" "rotation=$rot" \
    "autoRotate=$(SR settings get system accelerometer_rotation)" "screen=$(SR dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)" \
    "doze=$(SR dumpsys deviceidle | grep -m1 -o 'mState=[A-Z_]*' | cut -d= -f2)" \
    "appPid=n:${PID_APP:-$(apppid)}" "appVersionCode=n:$(app_version)" "top=$(top_activity)" \
    "externalDisplay=$(meta_get ext_sf)" "noAudio=b:$(noaudio_check && echo true || echo false)" "shizukuRunning=b:$([ -n "$sp" ] && echo true || echo false)" "shizukuPid=n:${sp:-0}" \
    "adb=j:$(adb_state)" "deviceId=$(meta_get device_id)" "displays=j:$(SR dumpsys SurfaceFlinger --display-id | grep -o 'HWC display [0-9]*' | awk '{print $3}' | tr '\n' ' ' | python3 -c "import sys,json; print(json.dumps([int(x) for x in sys.stdin.read().split()]))")"
}

do_shot() { # do_shot <out.png> <selector>
  local out=$1 sel=${2:-0} id
  case "$sel" in
    ''|0|inner) id=$(hwc 0);;
    cover) [ "$SHAPE" = fold ] || die "$ID has no cover display"; id=$(hwc 1);;
    external) id=$(meta_get ext_sf); [ -n "$id" ] || die "no external display: lane.sh $ID display add-external";;
    [0-9]|[0-9][0-9]) id=$(hwc "$sel");;
    *) id=$sel;;
  esac
  [ -n "$id" ] || die "display not found: $sel"
  S screencap -d "$id" -p /data/local/tmp/lane-shot.png >/dev/null 2>&1 && A pull /data/local/tmp/lane-shot.png "$out" >/dev/null 2>&1 || die "screencap of display $sel failed"
}

stop_instance() { # stop_instance : console kill, then (after 40 s) by pid; only processes whose command line names THIS aemu-* AVD
  con kill >/dev/null 2>&1
  local i; for i in $(seq 1 20); do ruiko_emus | grep -q "^$ID " || break; sleep 2; done
  rps "\$id = '$ID'
$(cat <<'PS'
foreach ($x in (Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'emulator|qemu' -and $_.CommandLine -match ('-avd ' + $id + ' ') })) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Get-ChildItem ('C:\Users\ykaza\claude-lane\avd\' + $id + '.avd') -Filter *.lock -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
PS
)" >/dev/null
}

kill_emulator_wait() { # wait until the emulator is gone from Ruiko (max 60 s)
  local i; for i in $(seq 1 30); do ruiko_emus | grep -q "^$ID " || return 0; sleep 2; done; return 1
}
wait_page() { # wait_page <max secs> : until the page is past the launch / Software Update screen (data-wm-boot done or a desktop)
  local t0 now r stuck=0; t0=$(date +%s)
  while :; do
    page_forward >/dev/null 2>&1 && r=$(cdp_js eval 'JSON.stringify({p:location.pathname,b:document.documentElement.dataset.wmBoot||"",t:document.body?document.body.innerText.slice(0,60).replace(/\n/g," / "):""})' 2>/dev/null) || r=''
    case "$r" in *'\"b\":\"done\"'*) echo done; return 0;; esac
    # the first install is a whole-pack download; the server rebuilds the pack on every publish (many agents publish), so it can fail
    # ("Couldn't download updates"): press RETRY, as a person would
    case "$r" in *Couldn*download*) cdp_js eval '[].slice.call(document.querySelectorAll("*")).filter(function(x){return /^\s*RETRY\s*$/i.test(x.textContent||"")&&x.children.length==0}).forEach(function(x){x.click()})' >/dev/null 2>&1;; esac
    now=$(date +%s); progress "page: ${r:-no page yet}"
    [ $(( now - t0 )) -gt "$1" ] && return 1
    sleep 15
  done
}

provision() {
  progress "device setup"; setup_device
  progress "Shizuku app $SHZ_APK"; install_shizuku
  progress "DSApp (newest release)"; install_release >&2
  # the app starts Shizuku over 5555 from lib/arm64 (a phone's lib dir name); the x86_64 emulator's package has lib/x86_64: alias it
  local d; d=$(shz_dir); [ -n "$d" ] && SU "[ -e $d/lib/arm64 ] || ln -s x86_64 $d/lib/arm64" >/dev/null 2>&1
  progress "adb tcpip $LANE_ADB_PORT (the app's local-ADB port on the lane) and wireless debugging"
  meta_set adb_port "$LANE_ADB_PORT"
  A tcpip "$LANE_ADB_PORT" >/dev/null 2>&1; sleep 4; A wait-for-device
  S settings put global adb_wifi_enabled 1; sleep 2; wifi_dialog >/dev/null 2>&1 || true
  progress "Shizuku start (shell user)"; shz_start >/dev/null
  progress "app setup (bars service, notification listener, home app)"
  S settings put secure enabled_accessibility_services "$PKG/$PKG.MelatonBarService"
  S settings put secure accessibility_enabled 1
  S cmd notification allow_listener "$PKG/$PKG.activesync.ActiveSyncNotificationListener" >/dev/null 2>&1
  S pm enable "$PKG/$PKG.HomeAlias" >/dev/null 2>&1
  S cmd package set-home-activity "$PKG/$PKG.HomeAlias" >/dev/null 2>&1
  progress "start the app, sign in"
  S am start --display 0 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 12
  page_forward >/dev/null || die "the app did not start"
  local si; si=$(NODE_PATH=${NODE_PATH:-/home/kanmi/staticforge/node_modules} node "$HERE/lib/signin.js" "$CDP" 2>&1) || die "sign-in failed: $si"
  tap_text '^Restart$' >/dev/null 2>&1 || true
  progress "waiting for the app's first install (about 8000 files, several minutes)"
  wait_page 1500 >/dev/null || die "the page never finished its first start (lane.sh $ID eval 'document.body.innerText')"
  local dev; dev=$(dev_id); [ -n "$dev" ] || die "no ActiveSync device id in the app"
  progress "test device $dev (fence)"
  mark_test_device "$dev" || die "could not mark $dev as a test device"
  page_forward >/dev/null; NODE_PATH=${NODE_PATH:-/home/kanmi/staticforge/node_modules} node "$HERE/lib/signin.js" "$CDP" --register --device "$dev" >/dev/null 2>&1
  progress "ActiveSync partnership"; partner_device "$dev" || progress "partnership not accepted (lane.sh $ID partner to retry)"
  progress "Shizuku permission for Dreamscape"; shz_grant >/dev/null
  progress "app local-ADB settings: port $LANE_ADB_PORT, restore on"; adb_settings "{\"allow\":true,\"autoRestore\":true,\"shizukuAutoStart\":true,\"shizukuRecover\":true,\"preferred\":\"adb\",\"port\":$LANE_ADB_PORT}" >/dev/null
  meta_set provisioned "$(date +%s)"
  J ok=b:true id="$ID" "deviceId=$dev" provisioned=b:true
}

adb_settings() { # the app's Android Bridge > Advanced Tools settings (LocalAdb): allow, autoRestore, shizukuAutoStart, shizukuRecover, port, ...
  page_forward >/dev/null || die "the app is not running"
  local js; js=$(python3 -c "import json,sys; json.loads(sys.argv[1]); print('AndroidActiveSync.setAdbSettings(JSON.stringify(' + sys.argv[1] + ')); AndroidActiveSync.adbStatus()')" "$1") || die "the settings are not JSON"
  cdp_js eval "$js"
}

partner_device() { # propose the ActiveSync partnership as the lane's harness computer and accept it on the page
  local dev=$1 out
  ( NODE_PATH=${NODE_PATH:-/home/kanmi/staticforge/node_modules} timeout 150 node "$HERE/lib/partner.js" "$dev" "Lane $ID" > "$STATE/partner-$ID.out" 2>&1 ) &
  local pp=$! i
  for i in $(seq 1 20); do
    sleep 3
    page_forward >/dev/null 2>&1 && cdp_js eval "$PARTNER_ACCEPT_JS" 2>/dev/null | grep -q '"clicked"' && break
  done
  wait $pp; grep -q '"accepted":true' "$STATE/partner-$ID.out"
}
# The page's confirm for an incoming partnership: click its accept button (found by the page's own markup).
PARTNER_ACCEPT_JS='(function(){var b=[].slice.call(document.querySelectorAll("button,.wm-btn,[role=button],a")).filter(function(x){return /^\s*(Yes|Accept|Allow)\s*$/i.test(x.textContent||"")&&x.offsetParent});if(b.length){b[0].click();return "clicked"}return "none"})()'

make_avd() { # the AVD of this instance on Ruiko (its own userdata, so its own ActiveSync device id)
  local target=android-37.0; [ "$SHAPE" = a53 ] && target=android-36
  local d="$RBASE\\avd\\$ID.avd" t=$STATE/avd-$ID
  mkdir -p "$t"
  sed "s/@AVD@/$ID/g" "$HERE/ruiko/$SHAPE.ini" > "$t/config.ini"
  printf 'avd.ini.encoding=UTF-8\r\npath=%s\r\npath.rel=avd\\%s.avd\r\ntarget=%s\r\n' "$d" "$ID" "$target" > "$t/$ID.ini"
  rps "New-Item -ItemType Directory -Force '$d' | Out-Null; New-Item -ItemType Directory -Force '$RBASE\\logs' | Out-Null" >/dev/null
  scp -q "$HERE/ruiko/start.cmd" "ruiko:C:/Users/ykaza/claude-lane/start.cmd"; scp -q "$HERE/ruiko/reap.ps1" "ruiko:C:/Users/ykaza/claude-lane/reap.ps1"
  scp -q "$t/config.ini" "ruiko:C:/Users/ykaza/claude-lane/avd/$ID.avd/config.ini"
  scp -q "$t/$ID.ini" "ruiko:C:/Users/ykaza/claude-lane/avd/$ID.ini"
}

# ------------------------------------------------------------------ commands: one instance
[ -n "$ID" ] || die "$cmd needs an instance id" 2
case "$cmd" in status|wait-boot) ;; *) need_lease;; esac
tunnel
touch_last
# stop idle instances (nobody used for $IDLE_MIN min) from here too, at most every 5 minutes (also a Ruiko scheduled task): no polling loop
case "$cmd" in status|list|wait-boot) ;; *)
  rs=$STATE/reap.stamp; nowt=$(date +%s)
  if [ ! -f "$rs" ] || [ $(( nowt - $(stat -c %Y "$rs") )) -gt 300 ]; then : > "$rs"; ( "$0" reap >/dev/null 2>&1 & ); fi;;
esac

case "$cmd" in
  create)
    provision_lock
    avd_present && die "$ID already exists (lane.sh $ID provision / reset; delete it on Ruiko to start over)"
    mem=$(rps '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)')
    progress "Ruiko free memory $mem GB"
    mem_guard
    progress "AVD"; make_avd
    progress "first boot (cold, 2-4 minutes)"
    "$0" ${AGENT:+--agent "$AGENT"} "$ID" up >&2 || die "the first boot failed"
    provision >&2 || die "provision failed (lane.sh $ID provision to continue)"
    CON_TIMEOUT=240 con avd snapshot save golden >/dev/null 2>&1 || die "snapshot save failed"
    J ok=b:true id="$ID" created=b:true golden=b:true;;
  up)
    if running && booted; then J ok=b:true id="$ID" state=running; exit 0; fi
    avd_present || die "$ID has no AVD yet: lane.sh create $SHAPE $N"
    # a process of this AVD that adb does not see (a hung or half-stopped one) is stopped first: it holds the AVD's lock
    ruiko_emus | grep -q "^$ID " && { progress "a process of $ID is up but adb does not see it: stopping it"; stop_instance; }
    others=$(ruiko_emus | grep -vc "^$ID " || true)
    [ "${others:-0}" -ge "$MAX_RUNNING" ] && die "already $MAX_RUNNING lane instances running: lane.sh <id> down one first, or lane.sh reap"
    mode=cold; setup=1
    for a in "$@"; do case "$a" in --golden) mode=golden;; --nosetup) setup=0;; esac; done
    [ "$mode" = golden ] && { golden_present || die "$ID has no golden snapshot"; }
    mem_guard
    secs=''
    for attempt in 1 2; do
      if [ "$mode" = golden ]; then start_emulator "-snapshot golden -force-snapshot-load"; else start_emulator "-no-snapshot-load"; fi
      secs=$(wait_boot 300) && break
      # adb's server did not register the emulator (it registers once at the emulator's start): a second start fixes it
      progress "attempt $attempt: adb does not see $SERIAL after 300 s: restarting it"; stop_instance
    done
    [ -n "$secs" ] || die "not booted (Ruiko $RBASE\\logs\\$ID.txt): adb never saw $SERIAL"
    noaudio_check || { con kill >/dev/null 2>&1; die "the emulator started without -no-audio: stopped it (never Ruiko's speakers)"; }
    if [ "$mode" = golden ] || [ "$setup" = 0 ]; then quiet_volumes; else setup_device; fi
    J ok=b:true id="$ID" state=booted "bootSecs=n:$secs" noAudio=b:true;;
  wait-boot)
    secs=$(wait_boot "${1:-240}") || die "not booted"
    J ok=b:true id="$ID" state=booted "waitedSecs=n:$secs";;
  down) stop_instance; J ok=b:true id="$ID" state=stopped;;
  status)
    running || { J ok=b:true id="$ID" running=b:false; exit 0; }
    status_json;;
  provision) provision_lock; provision;;
  partner) dev=$(dev_id); partner_device "$dev" && J ok=b:true id="$ID" partnered=b:true || die "partnership not accepted: $(cat "$STATE/partner-$ID.out" 2>/dev/null | tail -2)";;
  reset)
    golden_present || die "$ID has no golden snapshot (lane.sh $ID provision, then lane.sh $ID golden)"
    stop_instance
    start_emulator "-snapshot golden -force-snapshot-load"
    secs=$(wait_boot 300) || die "golden did not boot (Ruiko $RBASE\\logs\\$ID.txt)"
    noaudio_check || { con kill >/dev/null 2>&1; die "the emulator started without -no-audio: stopped it"; }
    quiet_volumes
    J ok=b:true id="$ID" state=golden "bootSecs=n:$secs" noAudio=b:true;;
  golden)
    running && booted || die "$ID is not running"
    CON_TIMEOUT=240 con avd snapshot save golden >/dev/null 2>&1 || die "snapshot save failed"
    J ok=b:true id="$ID" golden=b:true;;
  reboot)
    # A reboot = a clean guest shutdown and a cold boot of a fresh emulator process (the instance's disk is kept). `adb reboot`
    # inside the running process leaves adb's transport flapping offline a minute later (seen on aemu-a53-1 / aemu-fold-1), so
    # it is not used. What comes back by itself is what the phone would bring back: nothing is set up again (`up --nosetup`).
    t0=$(date +%s)
    S 'svc power shutdown' >/dev/null 2>&1 || S 'reboot -p' >/dev/null 2>&1
    for i in $(seq 1 45); do ruiko_emus | grep -q "^$ID " || break; sleep 2; done
    stop_instance
    "$0" ${AGENT:+--agent "$AGENT"} "$ID" up --nosetup >/dev/null || die "not booted after the reboot"
    J ok=b:true id="$ID" state=booted "rebootSecs=n:$(( $(date +%s) - t0 ))" method="clean shutdown + cold boot";;
  adb)
    case "${1:-}" in -s|-d|-e|-t|-H|-P|-L|kill-server|start-server|connect|disconnect|devices|mdns|pair|reconnect|server|wait-for-any-device) die "lane.sh $ID adb: '$1' is refused (every adb call is pinned to $SERIAL)" 2;; esac
    case " $* " in *' --remove-all '*|*emulator-55[78]*|*_adb-tls-connect*|*192.168.*) die "lane.sh $ID adb: refused (another device)" 2;; esac
    A "$@";;
  sh) S "$*";;
  su) SU "$*";;
  shot)
    out=${1:?usage: shot <out.png> [display-id|inner|cover|external|all]}; sel=${2:-0}
    if [ "$sel" = all ]; then
      base=${out%.png}; files=()
      for w in inner cover external; do
        [ "$w" = cover ] && [ "$SHAPE" != fold ] && continue
        [ "$w" = external ] && [ -z "$(meta_get ext_sf)" ] && continue
        do_shot "$base-$w.png" "$w" && files+=("$base-$w.png")
      done
      J ok=b:true "files=j:$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "${files[@]}")"
    else do_shot "$out" "$sel"; J ok=b:true "file=$out" "display=$sel"; fi;;
  shade)
    out=${1:?usage: shade <out.png> [display]}
    S cmd statusbar expand-notifications >/dev/null 2>&1; sleep 2
    do_shot "$out" "${2:-0}"; rc=$?
    S cmd statusbar collapse >/dev/null 2>&1
    [ $rc = 0 ] && J ok=b:true "file=$out";;
  posture)
    [ "$SHAPE" = fold ] || die "$ID is not a fold: no postures"
    case "${1:-}" in
      closed) con fold >/dev/null 2>&1; con sensor set hinge-angle0 0 >/dev/null; posture_overlay cover; S wm size 1080x2520 >/dev/null; J ok=b:true posture=closed hinge=n:0 display="cover (logical display 0 = 1080x2520)";;
      half) con unfold >/dev/null 2>&1; con sensor set hinge-angle0 90 >/dev/null; posture_overlay inner; S wm size reset >/dev/null; J ok=b:true posture=half hinge=n:90;;
      open) con unfold >/dev/null 2>&1; con sensor set hinge-angle0 180 >/dev/null; posture_overlay inner; S wm size reset >/dev/null; J ok=b:true posture=open hinge=n:180;;
      *) die "posture closed|half|open" 2;;
    esac;;
  rotate)
    if [ "${1:-}" = auto ]; then S settings put system accelerometer_rotation 1
    else S settings put system accelerometer_rotation 0; S settings put system user_rotation "${1:-0}"; fi
    J ok=b:true "rotation=${1:-0}";;
  screen)
    case "${1:-}" in
      on) S input keyevent KEYCODE_WAKEUP; S wm dismiss-keyguard >/dev/null 2>&1;;
      off) S input keyevent KEYCODE_SLEEP;;
      *) die "screen on|off" 2;;
    esac; sleep 1; J ok=b:true "screen=$(SR dumpsys power | grep -m1 -o 'mWakefulness=[A-Za-z]*' | cut -d= -f2)";;
  doze)
    case "${1:-}" in
      on) S dumpsys battery unplug >/dev/null; S dumpsys deviceidle force-idle >/dev/null;;
      off) S dumpsys deviceidle unforce >/dev/null; S dumpsys battery reset >/dev/null;;
      *) die "doze on|off" 2;;
    esac; J ok=b:true "doze=$(SR dumpsys deviceidle | grep -m1 -o 'mState=[A-Z_]*' | cut -d= -f2)";;
  net)
    mode=${1:-on}
    SU 'for d in wlan0 eth0; do tc qdisc del dev $d root 2>/dev/null; done; iptables -D OUTPUT -p tcp --dport 443 -j DROP 2>/dev/null; ip6tables -D OUTPUT -p tcp --dport 443 -j DROP 2>/dev/null; true' >/dev/null
    case "$mode" in
      on) S svc wifi enable; S svc data enable;;
      off) S svc wifi disable; S svc data disable;;
      hang) S svc wifi enable; S svc data enable; SU 'iptables -I OUTPUT -p tcp --dport 443 -j DROP; ip6tables -I OUTPUT -p tcp --dport 443 -j DROP' >/dev/null;;
      slow) S svc wifi enable; S svc data enable; SU 'for d in wlan0 eth0; do tc qdisc add dev $d root netem delay 2000ms rate 64kbit; done' >/dev/null;;
      flaky) S svc wifi enable; S svc data enable; SU 'for d in wlan0 eth0; do tc qdisc add dev $d root netem delay 300ms 200ms loss 40%; done' >/dev/null;;
      *) die "net on|off|hang|slow|flaky" 2;;
    esac; J ok=b:true "net=$mode";;
  kill-page)
    pids=$(SR "ps -A -o PID,NAME | grep -E 'sandboxed_process|webview_service|privileged_process' | awk '{print \$1}'" | tr '\n' ' ')
    [ -n "$pids" ] && SU "kill -9 $pids" >/dev/null
    J ok=b:true "killedRendererPids=${pids:-none}";;
  kill-app) p=$(apppid); [ -n "$p" ] && SU "kill -9 $p" >/dev/null; sleep 1; J ok=b:true "killedPid=n:${p:-0}" "appPid=n:$(apppid || echo 0)";;
  stop-app) S am force-stop "$PKG"; J ok=b:true;;
  start-app)
    dsp=0; [ "${1:-}" = --display ] && { dsp=${2:-0}; [ "$dsp" = external ] && dsp=$(meta_get ext_logical); [ -n "$dsp" ] || die "no external display"; }
    S am start --display "$dsp" -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 2; J ok=b:true "appPid=n:$(apppid || echo 0)" "display=$dsp";;
  home) S input -d 0 keyevent KEYCODE_HOME; J ok=b:true;;
  other) S am start --display 0 -a android.settings.SETTINGS >/dev/null; J ok=b:true note="Settings in front";;
  tap) S input -d 0 tap "${1:?x}" "${2:?y}"; J ok=b:true;;
  key) S input -d 0 keyevent "${1:?KEYCODE}"; J ok=b:true;;
  text) S input -d 0 text "$(printf '%s' "${1:?text}" | sed 's/ /%s/g')"; J ok=b:true;;
  tap-text) xy=$(tap_text "${1:?regex}") && J ok=b:true "tapped=$xy" || die "no Android view matching: $1";;
  cdp) page_forward >/dev/null || die "the app is not running"; cdp_js list;;
  eval) page_forward >/dev/null || die "the app is not running"; cdp_js eval "$*";;
  install-release) install_release "$@";;
  shizuku)
    case "${1:-status}" in
      start) o=$(shz_start); J ok=b:true shizukuPid="n:$(shz_pid)" "starter=$o";;
      stop) p=$(shz_pid); [ -n "$p" ] && S kill "$p"; sleep 1; J ok=b:true "stoppedPid=n:${p:-0}" "running=b:$([ -n "$(shz_pid)" ] && echo true || echo false)";;
      grant) J ok=b:true "permission=$(shz_grant)";;
      status) p=$(shz_pid); g=$(SR dumpsys package "$PKG" | grep -c 'moe.shizuku.manager.permission.API_V23: granted=true')
        J ok=b:true "running=b:$([ -n "$p" ] && echo true || echo false)" "pid=n:${p:-0}" "uid=$(SR "ps -A -o USER,NAME | grep -m1 shizuku_server | awk '{print \$1}'")" "installed=b:$([ -n "$(shz_dir)" ] && echo true || echo false)" "appPermission=b:$([ "$g" -gt 0 ] && echo true || echo false)";;
      *) die "shizuku start|stop|grant|status" 2;;
    esac;;
  adbsettings)
    if [ -n "${1:-}" ]; then adb_settings "$1"; else page_forward >/dev/null || die "the app is not running"; cdp_js eval "AndroidActiveSync.adbStatus()"; fi;;
  adbd)
    case "${1:-status}" in
      status) adb_state;;
      tcpip) tp=${2:-$(meta_get adb_port)}; A tcpip "${tp:-$LANE_ADB_PORT}" >/dev/null 2>&1; sleep 4; A wait-for-device; adb_state;;
      gate)
        # MANUAL shim: close / open the app's route to 127.0.0.1:5555 only (loopback); the host adb link keeps working. The emulator's
        # adbd always listens on 5555, so this is the only way to show the app a closed port. Lost at the next boot.
        case "${2:-}" in
          on) SU 'for t in iptables ip6tables; do $t -C INPUT -i lo -p tcp --dport 5555 -j REJECT --reject-with tcp-reset 2>/dev/null || $t -I INPUT -i lo -p tcp --dport 5555 -j REJECT --reject-with tcp-reset; done' >/dev/null;;
          off) SU 'for t in iptables ip6tables; do while $t -D INPUT -i lo -p tcp --dport 5555 -j REJECT --reject-with tcp-reset 2>/dev/null; do :; done; done' >/dev/null;;
          *) die "adbd gate on|off" 2;;
        esac
        J ok=b:true "gate=${2}" "appSees5555Closed=b:$([ "$(SR "ss -ltn >/dev/null; iptables -S INPUT | grep -c 'dport 5555'")" -gt 0 ] && echo true || echo false)";;
      usb) A usb >/dev/null 2>&1; sleep 4; A wait-for-device; adb_state;;
      wireless) case "${2:-}" in on) S settings put global adb_wifi_enabled 1;; off) S settings put global adb_wifi_enabled 0;; *) die "adbd wireless on|off" 2;; esac; sleep 2; wifi_dialog >/dev/null 2>&1; adb_state;;
      *) die "adbd status|tcpip [port]|usb|gate on|off|wireless on|off" 2;;
    esac;;
  keep)
    m=${1:-60}; t=$(( $(date +%s) + m * 60 )); echo "$t" > "$STATE/$ID.keep"
    rps "New-Item -ItemType Directory -Force '$RBASE\\last' | Out-Null; Set-Content -Path '$RBASE\\last\\$ID.txt' -Value $t" >/dev/null
    J ok=b:true id="$ID" "keepMinutes=n:$m" "keepUntil=n:$t";;
  display)
    case "${1:-}" in
      add-external)
        spec=${2:-1920x1080@160}
        case "$spec" in [0-9]*x[0-9]*@[0-9]*) ;; *) die "display add-external [WxH@dpi], e.g. 1920x1080@160" 2;; esac
        ew=${spec%%x*}; rest=${spec#*x}; eh=${rest%%@*}; edpi=${rest##*@}
        con multidisplay del 6 >/dev/null 2>&1
        out=$(con multidisplay add 6 "$ew" "$eh" "$edpi" 0 2>&1) || out="KO: $out"
        sleep 4
        # the emulator's own multi-display is a virtual display the SurfaceFlinger lists (screencap -d works on its id)
        extsf=$(SR dumpsys SurfaceFlinger --display-id | awk '/Virtual display/ && /multidisplay/ {print $2; exit}')
        extlog=$(SR "dumpsys display | grep -E 'Display Id=' | tail -1 | sed 's/.*Display Id=//'")
        method=multidisplay
        if [ -z "$extsf" ]; then
          # fallback: Android's simulated secondary display (no SurfaceFlinger id: shots of it are not possible)
          S settings put global overlay_display_devices "${ew}x${eh}/${edpi}"; method=overlay_display_devices; sleep 3
        fi
        # DeX / NexDock-like: Android's desktop windowing / freeform on the external display
        for k in force_desktop_mode_on_external_displays enable_freeform_support freeform_window_management force_resizable_activities; do S settings put global $k 1; done
        meta_set ext_sf "$extsf"; meta_set ext_logical "$extlog"; meta_set ext_method "$method"
        J ok=b:true "method=$method" "size=${ew}x${eh}" "dpi=n:$edpi" "surfaceFlingerId=$extsf" "logicalDisplayId=$extlog" "console=$out" "freeform=on";;
      remove-external)
        con multidisplay del 6 >/dev/null 2>&1; S settings put global overlay_display_devices "" >/dev/null 2>&1
        meta_set ext_sf ""; meta_set ext_logical ""; meta_set ext_method ""
        J ok=b:true removed=b:true;;
      *) die "display add-external [WxH@dpi] | remove-external" 2;;
    esac;;
  now) J ok=b:true "deviceMs=n:$(SR 'date +%s%3N')" "localMs=n:$(now_ms)" "skewMs=n:$(dev_skew)";;
  notifs)
    SR dumpsys notification --noredact | python3 "$HERE/lib/notifs.py" "$PKG";;
  logcat)
    secs=60; all=0
    for a in "$@"; do case "$a" in --all) all=1;; [0-9]*) secs=$a;; esac; done
    nowd=$(SR date +%s)
    SR "logcat -d -v epoch -b main -b system -b crash" | awk -v from=$(( nowd - secs )) '{ t=$1+0; if (t >= from) print }' > "$STATE/logcat-$ID.txt"
    if [ $all = 1 ]; then cat "$STATE/logcat-$ID.txt"
    else grep -E "$PKG|dreamscape|AndroidRuntime|NoteAlerts|MelatonBars|ApkInstall|LocalAdb|ActiveSync|Shizuku|CafeReady|AppNote|ShellService" "$STATE/logcat-$ID.txt"; fi;;
  sound)
    since=''; wav=0
    while [ $# -gt 0 ]; do case "$1" in --since) since=$2; shift 2;; --wav) wav=1; shift;; *) shift;; esac; done
    [ -n "$since" ] || since=$(( $(now_ms) - 60000 ))
    skew=$(dev_skew); sdev=$(( since + skew ))
    SR "logcat -d -v epoch -b main -b events" > "$STATE/sound-$ID.log"
    SR dumpsys audio > "$STATE/sound-$ID.playback"
    wavinfo=-
    if [ $wav = 1 ]; then wavinfo=$STATE/sound-$ID.wav.json; wav_info > "$wavinfo" 2>/dev/null || wavinfo=-; fi
    python3 "$HERE/lib/sound.py" "$sdev" "$STATE/sound-$ID.log" "$STATE/sound-$ID.playback" "$wavinfo";;
  notice)
    sub=${1:-}; shift || true
    dev=$(meta_get device_id); [ -n "$dev" ] || dev=$(dev_id); [ -n "$dev" ] || die "no device id for $ID (lane.sh $ID provision)"
    case "$sub" in
      push|get)
        body=${1:-'{}'}; body=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); d['mode']=sys.argv[2]; print(json.dumps(d))" "$body" "$sub") || die "the notice is not JSON"
        r=$(api POST "/api/test-devices/$dev/notice" "$body")
        if echo "$r" | grep -q '"success":true'; then echo "$r"; exit 0; fi
        # the one-device route needs a server restart to go live: the same thing with the routes that are live
        # (store without the live send to all, then THAT device's hello catch-up)
        r=$(api POST /api/test-devices/notice "$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); d['mode']='get'; print(json.dumps(d))" "$body")")
        echo "$r" | grep -q '"success":true' || die "the server refused the notice: $(echo "$r" | head -c 200)"
        if [ "$sub" = push ]; then c=$(api POST "/api/test-devices/$dev/catch-up"); else c='{"sent":0}'; fi
        python3 -c "import json,sys; n=json.loads(sys.argv[1]); c=json.loads(sys.argv[2]); print(json.dumps({'ok':True,'mode':sys.argv[3],'deviceId':sys.argv[4],'notice':n.get('notice'),'sent':c.get('sent',0),'route':'store+catch-up'}))" "$r" "$c" "$sub" "$dev";;
      clear) [ -n "${1:-}" ] || die "notice clear <noticeId>"; api POST "/api/test-devices/notice/$1/clear";;
      reset) api DELETE /api/test-devices/notices;;
      *) die "notice push|get '<json>' | clear <id> | reset" 2;;
    esac;;
  *) die "unknown command for an instance: $cmd (lane.sh help)" 2;;
esac
