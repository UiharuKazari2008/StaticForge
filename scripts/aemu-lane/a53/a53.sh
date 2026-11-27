#!/bin/bash
# a53.sh - the agents' own Galaxy A53: find it, bring it back, unlock it. No person involved (StaticForge #1309 part D).
#
# It runs on the Dreamscape server with the server's adb (~/.local/bin/adb) and is pinned to the A53 on every call
# (never `adb devices`, never kill-server, never the Fold, never an _adb-tls-connect serial that is not this phone's IP).
# The A53 is taken with the live tree's device queue first (coord id "a53"); this script refuses the perceptible
# commands unless your agent id holds the lease (A53_AGENT / COORD_AGENT_ID, or A53_NO_LEASE=1).
#
#   a53.sh status            read-only facts (still needs the lease: it dials the phone): link, boot, lock, Wi-Fi, battery, adb ports, Wireless debugging, volumes
#   a53.sh up                climb the recovery ladder until adb answers, then wake + unlock (prints every rung)
#   a53.sh unlock            wake and unlock with the PIN (locksettings verify first; never prints the PIN)
#   a53.sh find              the phone's address when it is not at A53_IP (its MAC in the ARP table after a ping sweep)
#   a53.sh wd-pair           (once) pair this server's adb with the phone's Wireless debugging (adb input + uiautomator)
#   a53.sh wd-on             turn Wireless debugging on, tap "Always allow on this network" if asked
#   a53.sh deadman <sec>     TEST HARNESS: one sleeping shell on the phone turns Wi-Fi on once after <sec> s (no loop, no wakelock)
#   a53.sh deadman-cancel    cancel it
#   a53.sh deadman-selftest  prove the timer survives the link dropping (harmless touch of a file, link disconnected host side)
#   a53.sh wifi off|on       Wi-Fi via the phone's own `cmd wifi set-wifi-enabled`; off arms a 90 s dead-man first
#   a53.sh tcp-off           restart adbd WITHOUT tcp (state "5555 closed")
#   a53.sh reboot            adb reboot, then `up` with progress
#   a53.sh keepawake on|off  stay_on_while_plugged_in 3 / 0 (off by default: other tests look at screen-off behaviour)
#
# Config: ~/.config/a53/a53.env  (A53_IP, A53_MAC), PIN: ~/.secrets/ruiko-windows-pin.token (never printed).
set -u
ADB=${A53_ADB:-$HOME/.local/bin/adb}
ENV_FILE=${A53_ENV:-$HOME/.config/a53/a53.env}
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"
IP=${A53_IP:-192.168.100.240}
PORT=5555
SER="$IP:$PORT"
PIN_FILE=${A53_PIN_FILE:-$HOME/.secrets/ruiko-windows-pin.token}
TREE=${A53_TREE:-/home/kanmi/staticforge}
AGENT=${A53_AGENT:-${COORD_AGENT_ID:-claude-${CLAUDE_CODE_SESSION_ID:0:8}}}

say() { printf '%s\n' "$*"; }
a() { timeout "${A53_T:-25}" "$ADB" -s "$SER" "$@"; }
ash() { a shell "$@"; }

lease_ok() {
  [ "${A53_NO_LEASE:-}" = 1 ] && return 0
  local h
  h=$(cd "$TREE" && node -e 'const q=require("./modules/agentCoord/deviceQueue");const s=q.status("a53").devices[0];process.stdout.write(s.holder?s.holder.agentId:"")' 2>/dev/null)
  [ "$h" = "$AGENT" ] || { say "refused: the A53 lease is held by '${h:-nobody}', not by '$AGENT' (coord_device_request a53 first)"; return 1; }
}

# state of adb at SER: device | unauthorized | offline | none
adb_state() {
  timeout 12 "$ADB" connect "$SER" >/dev/null 2>&1
  local s
  s=$(timeout 8 "$ADB" -s "$SER" get-state 2>&1 | tr -d '\r')
  case "$s" in
    device) echo device ;;
    *unauthorized*) echo unauthorized ;;
    *offline*) echo offline ;;
    *) echo none ;;
  esac
}

host_up() { ping -c1 -W2 "$IP" >/dev/null 2>&1; }

# TLS services advertised by THIS phone's address only (adb mdns services, never a loop over other devices)
tls_ports() {
  timeout 10 "$ADB" mdns services 2>/dev/null | awk -v ip="$IP" '$2 ~ /^_adb-tls-connect\._tcp/ { n=split($3,p,":"); if (p[1]==ip) print p[2] }'
}

subnet() { echo "${IP%.*}"; }

# the phone's MAC from the ARP table after a ping sweep of our own /24 (when it is not at A53_IP any more)
find_ip() {
  [ -n "${A53_MAC:-}" ] || { say "find: no A53_MAC known (a53.sh status stores it while the phone is reachable)"; return 1; }
  local m i sn
  m=$(echo "$A53_MAC" | tr 'A-Z' 'a-z'); sn=$(subnet)
  for i in $(seq 1 254); do ping -c1 -W1 "$sn.$i" >/dev/null 2>&1 & done; wait
  ip neigh 2>/dev/null | awk -v m="$m" 'tolower($5)==m && $1 !~ /:/ {print $1; exit}'
}

save_env() { # key value
  mkdir -p "$(dirname "$ENV_FILE")"; touch "$ENV_FILE"
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null; echo "$1=$2" >> "$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"
}

cmd_status() {
  lease_ok || return 1
  local st; st=$(adb_state)
  say "ip=$IP serial=$SER adb=$st hostPing=$(host_up && echo yes || echo no)"
  say "tlsPorts=$(tls_ports | tr '\n' ' ')"
  [ "$st" = device ] || return 0
  ash 'echo boot=$(getprop sys.boot_completed) uptime="$(cut -d" " -f1 /proc/uptime)s"
       echo persistTcp=$(getprop persist.adb.tcp.port) serviceTcp=$(getprop service.adb.tcp.port)
       echo adbWifiEnabled=$(settings get global adb_wifi_enabled) wifiOn=$(settings get global wifi_on) stayOn=$(settings get global stay_on_while_plugged_in)
       echo keyguard=$(dumpsys window | grep -o "isKeyguardShowing=[a-z]*" | head -1) screen=$(dumpsys power | grep -o "mWakefulness=[A-Za-z]*" | head -1)
       dumpsys battery | grep -E "AC powered|USB powered|level|status" | tr -s " " | tr "\n" ";"; echo
       echo vol_ring=$(settings get system volume_ring 2>/dev/null) ringer=$(dumpsys audio | grep -o "ringer mode: [A-Z_]*\|mRingerMode=[0-9]*" | head -1)
       echo ip=$(ip -o -4 addr show wlan0 2>/dev/null | tr -s " " | cut -d" " -f4)
       echo mac=$(cat /sys/class/net/wlan0/address 2>/dev/null)' 2>&1 | tr -d '\r'
  local mac; mac=$(ash 'cat /sys/class/net/wlan0/address' 2>/dev/null | tr -d '\r\n')
  case "$mac" in ??:??:??:??:??:??) [ "$mac" = "${A53_MAC:-}" ] || save_env A53_MAC "$mac" ;; esac
}

cmd_unlock() {
  lease_ok || return 1
  [ "$(adb_state)" = device ] || { say "unlock: adb does not answer (run: a53.sh up)"; return 1; }
  [ -r "$PIN_FILE" ] || { say "unlock: no PIN file"; return 1; }
  local pin showing
  pin=$(tr -d '[:space:]' < "$PIN_FILE")
  showing() { ash 'dumpsys window | grep -o "isKeyguardShowing=[a-z]*" | head -1' 2>/dev/null | tr -d '\r\n'; }
  if [ "$(showing)" = "isKeyguardShowing=false" ]; then say "unlock: already unlocked"; return 0; fi
  # a wrong guess counts toward the lockout: verify first, type only when the PIN is right
  local v; v=$(ash "locksettings verify --old $pin" 2>&1 | tr -d '\r')
  case "$v" in *"verified successfully"*) ;; *) say "unlock: STOP, the stored PIN did not verify ($(echo "$v" | head -1 | sed "s/$pin/***/g"))"; return 1 ;; esac
  ash 'input keyevent KEYCODE_WAKEUP' >/dev/null; sleep 1
  ash 'wm dismiss-keyguard' >/dev/null 2>&1; sleep 1
  ash 'input swipe 540 1900 540 700 200' >/dev/null; sleep 1
  ash "input text $pin" >/dev/null; sleep 1
  ash 'input keyevent KEYCODE_ENTER' >/dev/null; sleep 2
  [ "$(showing)" = "isKeyguardShowing=false" ] && { say "unlock: unlocked"; return 0; }
  say "unlock: still locked ($(showing))"; return 1
}

# ---------------------------------------------------------------- the ladder
cmd_up() {
  lease_ok || return 1
  local st n
  st=$(adb_state); say "rung 1 adb over Wi-Fi at $SER: $st"
  if [ "$st" = unauthorized ]; then
    say "rung 1b: this adb key is not allowed: another channel taps Always allow (see 'a53.sh approve')"
    cmd_approve && st=$(adb_state)
  fi
  if [ "$st" != device ]; then
    if host_up; then
      say "rung 2 host answers ping, 5555 is closed: ask adbd for tcpip over Wireless debugging"
      for n in $(tls_ports); do
        say "  tls $IP:$n"
        timeout 12 "$ADB" connect "$IP:$n" >/dev/null 2>&1
        if [ "$(timeout 8 "$ADB" -s "$IP:$n" get-state 2>&1 | tr -d '\r')" = device ]; then
          timeout 15 "$ADB" -s "$IP:$n" tcpip "$PORT" 2>&1 | tr -d '\r' | sed 's/^/  /'
          timeout 5 "$ADB" disconnect "$IP:$n" >/dev/null 2>&1
          sleep 3; st=$(adb_state); say "  5555 now: $st"; break
        else
          say "  tls $IP:$n: not usable (not paired with this server?)"
        fi
      done
      [ -n "$(tls_ports)" ] || say "  no Wireless debugging service of this phone on the LAN"
    else
      say "rung 3 host does not answer ping at $IP: Wi-Fi off or a new address"
      local nip; nip=$(find_ip)
      if [ -n "$nip" ] && [ "$nip" != "$IP" ]; then
        say "  found by MAC at $nip"; IP=$nip; SER="$IP:$PORT"; save_env A53_IP "$IP"; st=$(adb_state)
      else
        say "  not found on $(subnet).0/24; the on-phone dead-man (a53.sh deadman) re-enables Wi-Fi by itself when one was armed"
      fi
    fi
  fi
  [ "$st" = device ] || { say "up: FAILED, adb is $st"; return 1; }
  cmd_unlock || return 1
  say "up: ok ($SER)"
}

cmd_approve() { # the server key shows "Allow USB debugging?" -> tap Always allow via Ruiko's adb (an already allowed key)
  say "approve: not wired for this state yet (needs a second allowed channel: Ruiko adb)"; return 1
}

cmd_find() { local n; n=$(find_ip); [ -n "$n" ] && { say "$n"; return 0; }; return 1; }

cmd_reboot() {
  lease_ok || return 1
  [ "$(adb_state)" = device ] || { say "reboot: adb does not answer"; return 1; }
  # a wrong PIN must not be the reason the phone cannot be unlocked after the reboot
  local pin v; pin=$(tr -d '[:space:]' < "$PIN_FILE")
  v=$(ash "locksettings verify --old $pin" 2>&1 | tr -d '\r')
  case "$v" in *"verified successfully"*) ;; *) say "reboot: STOP, the PIN does not verify, not rebooting"; return 1 ;; esac
  say "reboot: adb reboot at $(date +%T)"
  a reboot >/dev/null 2>&1
  local i t0=$SECONDS
  for i in $(seq 1 36); do
    sleep 10
    local s; s=$(adb_state)
    say "  +$((SECONDS-t0))s adb=$s boot=$( [ "$s" = device ] && ash 'getprop sys.boot_completed' 2>/dev/null | tr -d '\r' )"
    if [ "$s" = device ] && [ "$(ash 'getprop sys.boot_completed' 2>/dev/null | tr -d '\r')" = 1 ]; then
      say "reboot: back after $((SECONDS-t0))s"; cmd_unlock; return $?
    fi
  done
  say "reboot: not back after 360 s; running the ladder"; cmd_up
}

cmd_tcp_off() { # adbd restarts without tcp: 5555 closes and the link drops
  lease_ok || return 1
  say "tcp-off: adb usb (restarts adbd without tcp) at $(date +%T)"
  # persist.adb.tcp.port stays: this is the state "someone did adb usb", the same one a failed tcpip leaves
  a usb 2>&1 | tr -d '\r'
}

cmd_deadman() {
  # TEST HARNESS ONLY, one shot: no loop, no wakelock, no notice, no file left behind. One shell process on the phone sleeps
  # <sec> seconds, runs `cmd wifi set-wifi-enabled enabled` once and exits; setsid + nohup so it outlives the adb shell and
  # the Wi-Fi link that goes down under it. A permanent version of this belongs in the app (written up for the planner).
  lease_ok || return 1
  local sec=${1:-}; case "$sec" in ''|*[!0-9]*) say "deadman: seconds needed"; return 1 ;; esac
  [ "$(adb_state)" = device ] || { say "deadman: adb does not answer"; return 1; }
  ash "setsid nohup sh -c 'echo \$\$ > /data/local/tmp/a53-deadman.pid; sleep $sec; cmd wifi set-wifi-enabled enabled; rm -f /data/local/tmp/a53-deadman.pid' </dev/null >/dev/null 2>&1 &" </dev/null
  sleep 1
  say "deadman: armed, Wi-Fi on in ${sec}s (pid $(ash 'cat /data/local/tmp/a53-deadman.pid' 2>/dev/null | tr -d '\r'))"
}

cmd_deadman_selftest() {
  # proves the one-shot timer outlives the adb link: harmless command, link dropped host side, file checked after
  lease_ok || return 1
  [ "$(adb_state)" = device ] || { say "selftest: adb does not answer"; return 1; }
  ash 'rm -f /data/local/tmp/ds-deadman-ok'
  ash "setsid nohup sh -c 'sleep 20; touch /data/local/tmp/ds-deadman-ok' </dev/null >/dev/null 2>&1 &" </dev/null
  say "selftest: armed 20 s at $(date +%T); dropping the adb link"
  timeout 5 "$ADB" disconnect "$SER" >/dev/null 2>&1
  sleep 25
  [ "$(adb_state)" = device ] || { say "selftest: link did not come back"; return 1; }
  if [ "$(ash 'ls /data/local/tmp/ds-deadman-ok 2>/dev/null' | tr -d '\r')" = /data/local/tmp/ds-deadman-ok ]; then say "selftest: OK, the timer fired with the link down at $(date +%T)"; ash 'rm -f /data/local/tmp/ds-deadman-ok'; else say "selftest: FAILED, the timer did not survive"; return 1; fi
}

cmd_deadman_cancel() {
  local pid; pid=$(ash 'cat /data/local/tmp/a53-deadman.pid 2>/dev/null' | tr -d '\r\n')
  if [ -n "$pid" ]; then ash "kill $pid; rm -f /data/local/tmp/a53-deadman.pid"; say "deadman: cancelled ($pid)"; else say "deadman: none armed"; fi
}

cmd_wifi() {
  lease_ok || return 1
  case "${1:-}" in
    off) cmd_deadman 90 || return 1
         say "wifi: off at $(date +%T) (dead-man brings it back in 90 s)"
         ash 'cmd wifi set-wifi-enabled disabled' 2>&1 | tr -d '\r' ;;
    on)  ash 'cmd wifi set-wifi-enabled enabled' 2>&1 | tr -d '\r' ;;
    *)   say "wifi off|on"; return 1 ;;
  esac
}

cmd_keepawake() {
  lease_ok || return 1
  case "${1:-}" in on) ash 'settings put global stay_on_while_plugged_in 3' ;; off) ash 'settings put global stay_on_while_plugged_in 0' ;; *) say "keepawake on|off"; return 1 ;; esac
  say "stay_on_while_plugged_in=$(ash 'settings get global stay_on_while_plugged_in' | tr -d '\r')"
}

case "${1:-}" in
  status) cmd_status ;;
  up) cmd_up ;;
  unlock) cmd_unlock ;;
  find) cmd_find ;;
  reboot) cmd_reboot ;;
  tcp-off) cmd_tcp_off ;;
  deadman) shift; cmd_deadman "${1:-}" ;;
  deadman-cancel) cmd_deadman_cancel ;;
  deadman-selftest) cmd_deadman_selftest ;;
  wifi) shift; cmd_wifi "${1:-}" ;;
  keepawake) shift; cmd_keepawake "${1:-}" ;;
  wd-pair|wd-on) say "$1: see the next version of this script"; exit 2 ;;
  *) sed -n 2,26p "$0" ;;
esac
