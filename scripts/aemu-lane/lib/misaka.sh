#!/bin/bash
# lib/misaka.sh - the Fat Misaka backend of the emulator lane (sourced by lane.sh; never run on its own).
#
# Pool ids aemu-fold-m1, aemu-fold-m2 (Fold-shaped, API 37) and aemu-a53-m1, aemu-a53-m2 (A53-shaped, API 36) run on Fat
# Misaka (DL580 G7, 80 threads, ~500 GB RAM, no GPU, no AVX) instead of Ruiko. Same lane commands, same coord leases.
#
# How:
#  - emulator lifecycle and adb: `ssh fat-misaka` (login hvadmin, `sudo -u rack`), the SDK is the host's /opt/android-sdk, the lane's
#    own AVD home, logs and last-use files are /var/lib/rack/lane (start.sh there = scripts/aemu-lane/misaka/start.sh).
#    The adb server is rack's own on the host (127.0.0.1:5037); the tunnel forwards it to Dreamscape like Ruiko's.
#  - power and leases: Dreamscape's Fleet socket (rack.sock, line-JSON, audited): `up` / `create` / `reset` / `reboot` power the host on
#    when it is off ({"op":"power","action":"on","wait":true}); every lane command takes or renews a rack lease (120 min, the id is
#    kept in $CFG/<id>.racklease), `down` and the reaper release it. The host idle-shuts-down 3 h after the last lease.
#  - GPU: swiftshader_indirect (the host has no GPU; `-gpu host` does not exist there). LANE_MISAKA_GPU changes it.
#  - guards: the host's own free memory and CPU, and a cap on the cores the lane's instances use together (24 = 6 instances of 4 cores)
#    so the Chromium build keeps its share (LANE_MISAKA_MAX_CORES).
# Ports (pool_row): host console port PORT (even, 5576..5582, top of adb's scan range, away from the role's 5554...), adb PORT+1;
# Dreamscape side: adb-server tunnel TPORT, console forward PORT+10000, DevTools CDP (the adb forward lives on the host, same number).

MK_SSH=${LANE_MISAKA_SSH:-fat-misaka}
MK_BASE=/var/lib/rack/lane
MK_ADB=/opt/android-sdk/platform-tools/adb
MK_GPU=${LANE_MISAKA_GPU:-}   # default per shape (misaka_activate): fold swiftshader_indirect, a53 guest
MK_MAX_CORES=${LANE_MISAKA_MAX_CORES:-24}
MK_LEASE_MIN=${LANE_MISAKA_LEASE_MIN:-120}
MISAKA_IDS="aemu-fold-m1 aemu-fold-m2 aemu-a53-m1 aemu-a53-m2"
MK_ERRF=${STATE:-/tmp}/mk-err
RACKPY=$HERE/lib/rack.py

# mrun '<bash script>' : run as user rack on the host (script passed base64, no quoting problems). Only a call that did not connect
# (ssh 255, nothing on stdout) is retried, 3 tries; then return 75 (the reason in $MK_ERRF).
mrun() {
  local enc try out rc errf; enc=$(printf '%s' "$1" | base64 -w0)
  errf=$(mktemp "$STATE/mk.XXXXXX" 2>/dev/null) || errf=/dev/null
  for try in 1 2 3; do
    out=$(ssh -o ConnectTimeout=10 -o BatchMode=yes -o ControlMaster=auto -o "ControlPath=$STATE/cm-misaka" -o ControlPersist=300 "$MK_SSH" \
      "echo $enc | base64 -d | sudo -n -u rack env HOME=/var/lib/rack bash" 2>"$errf" </dev/null); rc=$?
    if [ "$rc" = 255 ] && [ -z "$out" ]; then
      printf '%s\n' "$(tail -1 "$errf" 2>/dev/null)" > "$MK_ERRF" 2>/dev/null
      [ "$try" = 3 ] && break
      sleep "$try"; continue
    fi
    [ "$errf" = /dev/null ] || { cat "$errf" >&2; rm -f "$errf"; }
    printf '%s\n' "$out" | sed '$ { /^$/d }'
    return 0
  done
  [ "$errf" = /dev/null ] || rm -f "$errf"
  return 75
}

mk_json() { python3 -c "import json,sys
try: d=json.loads(sys.stdin.read())
except Exception: sys.exit(3)
for k in sys.argv[1].split('.'):
    d=d.get(k) if isinstance(d,dict) else None
print('' if d is None else d)" "$1"; }
mk_power_state() { python3 "$RACKPY" '{"op":"power","server":"misaka","action":"status"}' 20 | mk_json result.state; }

# the host must be on: power it on (iLO, ~3 min) and wait, never for status / reap
mk_ensure_on() {
  local st; st=$(mk_power_state)
  [ "$st" = up ] && return 0
  progress "Fat Misaka is $st: powering it on (about 3-5 minutes)"
  python3 "$RACKPY" "{\"op\":\"power\",\"server\":\"misaka\",\"action\":\"on\",\"wait\":true,\"by\":\"${AGENT:-lane}\",\"reason\":\"lane $ID\"}" 720 >/dev/null
  st=$(mk_power_state)
  [ "$st" = up ] || die "Fat Misaka did not come up (power state: ${st:-unknown}); see rack_power status" 7
  # rackd is up before the user session is: wait for ssh
  local i; for i in 1 2 3 4 5 6 7 8 9 10; do ssh -o ConnectTimeout=6 -o BatchMode=yes "$MK_SSH" true >/dev/null 2>&1 && return 0; sleep 6; done
  die "Fat Misaka is up but ssh $MK_SSH does not answer" 7
}
mk_need_on() { # a driving command on a host that is off: say so, never power it on for a plain command
  local st; st=$(mk_power_state)
  [ "$st" = up ] || die "Fat Misaka is off ($st), so $ID is not running: lane.sh $ID up powers it on" 7
}
# the rack lease: take (purpose lane <id> (<agent>), 120 min) or renew the one in $CFG/<id>.racklease; best effort, never fatal
mk_lease() {
  local f=$CFG/$ID.racklease lid out
  lid=$(cat "$f" 2>/dev/null)
  if [ -n "$lid" ]; then
    out=$(python3 "$RACKPY" "{\"op\":\"lease\",\"server\":\"misaka\",\"id\":\"$lid\",\"minutes\":$MK_LEASE_MIN,\"purpose\":\"lane $ID (${AGENT:-?})\",\"by\":\"${AGENT:-lane}\"}" 20)
    [ "$(printf '%s' "$out" | mk_json ok)" = True ] && return 0
  fi
  out=$(python3 "$RACKPY" "{\"op\":\"lease\",\"server\":\"misaka\",\"purpose\":\"lane $ID (${AGENT:-?})\",\"minutes\":$MK_LEASE_MIN,\"by\":\"${AGENT:-lane}\"}" 20)
  lid=$(printf '%s' "$out" | mk_json result.lease.id)
  [ -n "$lid" ] && printf '%s\n' "$lid" > "$f"
  return 0
}
mk_lease_release() { # mk_lease_release [id] : the lane's lease of an instance ($CFG/<id>.racklease)
  local f=$CFG/${1:-$ID}.racklease lid; lid=$(cat "$f" 2>/dev/null); [ -n "$lid" ] || return 0
  python3 "$RACKPY" "{\"op\":\"lease_release\",\"id\":\"$lid\",\"by\":\"${AGENT:-lane}\"}" 20 >/dev/null; rm -f "$f"
}

# ---- pool level (list / reap), work with no instance chosen
mk_list_json() { # a JSON array of the four misaka rows (the host being off is an answer, not an error)
  local st emus present id row set_ first=1 stt created golden run pid lease
  st=$(mk_power_state)
  if [ "$st" = up ]; then
    emus=$(mk_emus_raw); present=$(mrun "$(mk_probe_sh "$MISAKA_IDS" 1)") || { printf '[]'; return 0; }
  fi
  printf '['
  for id in $MISAKA_IDS; do
    row=$(pool_row "$id"); set -- $row
    created=false; golden=false; run=false; pid=''; stt=unknown
    if [ "$st" = up ]; then
      stt=$(probe_state "$present" "$id" 2>/dev/null || echo unknown)
      case "$stt" in created|golden) created=true;; esac; [ "$stt" = golden ] && golden=true
      grep -q "^$id " <<<"$emus" && { run=true; pid=$(awk -v i="$id" '$1==i{print $2}' <<<"$emus"); }
    fi
    lease=$(lease_row "$id")
    [ $first = 1 ] || printf ','; first=0
    J id="$id" shape="$1" backend=misaka "host=misaka ($st)" serial="emulator-$3" "console=n:$3" "cdp=n:$5" "created=b:$created" "running=b:$run" "golden=b:$golden" "state=$stt" "pid=n:${pid:-0}" \
      "leaseHolder=${lease%%|*}" "leaseEndsAt=n:$(echo "${lease:-|0}" | cut -d'|' -f2)" | tr -d '\n'
  done
  printf ']\n'
}
mk_emus_raw() { # "<avd> <pid> <console port>" per running lane emulator on the host
  mrun "pgrep -af 'qemu-system.* -avd aemu-' | sed -n 's/^\([0-9]*\) .* -avd \(aemu-[a-z0-9-]*\) \(.* \)\?-port \([0-9]*\).*/\2 \1 \4/p'"
}
mk_probe_sh() { # mk_probe_sh '<ids>' [1] : "lane-state <ini> <cfg> <dir> <golden>[ <id>]" per id, same words as Ruiko's probe
  cat <<EOF
b=$MK_BASE; w=${2:-0}
t() { [ -e "\$1" ] && echo True || echo False; }
for id in $1; do
  case \$id in aemu-fold-m[12]|aemu-a53-m[12]) ;; *) echo 'not a lane id'; exit 1;; esac
  a=\$b/avd/\$id
  l="lane-state \$(t \$a.ini) \$(t \$a.avd/config.ini) \$(t \$a.avd) \$(t \$a.avd/snapshots/golden)"
  [ "\$w" = 1 ] && l="\$l \$id"
  echo "\$l"
done
EOF
}
lane_list_all() { # Ruiko's rows and Fat Misaka's rows in one array (LANE_NO_MISAKA=1: Ruiko's alone, for the lane's hermetic test)
  local a b rc=0
  a=$(cmd_list) || rc=$?
  [ $rc = 0 ] || { [ -z "$a" ] || printf '%s\n' "$a"; return $rc; }
  [ -n "${LANE_NO_MISAKA:-}" ] && { printf '%s\n' "$a"; return 0; }
  b=$(mk_list_json)
  python3 -c "import json,sys; print(json.dumps(json.loads(sys.argv[1])+json.loads(sys.argv[2])))" "$a" "${b:-[]}"
}
mk_reap() { # stop misaka instances nobody used for IDLE_MIN min, and those with no coord lease idle 5 min; release their rack leases; never powers the host on
  [ -n "${LANE_NO_MISAKA:-}" ] && return 0
  [ "$(mk_power_state)" = up ] || return 0
  local emus id last now age idle_stop='' none_stop=''; emus=$(mk_emus_raw) || return 0; now=$(date +%s)
  for id in $MISAKA_IDS; do
    grep -q "^$id " <<<"$emus" || { mk_lease_release "$id"; continue; }
    last=$(mrun "cat $MK_BASE/last/$id.txt 2>/dev/null"); [ -n "$last" ] || continue   # no last-use file: unknown, never reaped on a guess
    age=$(( (now - last) / 60 ))
    if [ "$age" -ge "$IDLE_MIN" ]; then idle_stop="$idle_stop $id"
    elif [ "$age" -ge 5 ] && [ -z "$(lease_row "$id")" ]; then none_stop="$none_stop $id"; fi
  done
  for id in $idle_stop $none_stop; do "$0" --agent "${AGENT:-reaper}" "$id" down >/dev/null 2>&1 || LANE_NO_LEASE=1 "$0" "$id" down >/dev/null 2>&1; done
  J ok=b:true backend=misaka "idleReaped=${idle_stop# }" "leaseEndedStopped=${none_stop# }"
}

# ---- the overrides for one misaka instance (called by lane.sh once the id is known and the shell functions exist)
misaka_activate() {
  BACKEND=misaka
  [ -n "$MK_GPU" ] || { [ "$SHAPE" = a53 ] && MK_GPU=guest || MK_GPU=swiftshader_indirect; }
  CPORT=$(( PORT + 10000 ))
  export AEMU_CONSOLE_TOKEN=$HOME/.secrets/aemu-console-misaka.token
  die_unreachable() { local e; e=$(head -1 "$MK_ERRF" 2>/dev/null); die "cannot reach Fat Misaka over ssh after 3 tries (${e:-no answer}): nothing was changed, run the command again" 7; }
  instance_gb() { case "$SHAPE" in a53) echo "${LANE_MISAKA_A53_GB:-4.8}";; *) echo "${LANE_MISAKA_FOLD_GB:-5.5}";; esac; }
  con() { "$HERE/lib/con.py" "$CPORT" "$@"; }
  tunnel() {
    local old; old=$(pgrep -ax ssh 2>/dev/null | grep -- "-L $TPORT:127.0.0.1:5037" | head -1)
    if open_port "$TPORT"; then
      case "$old" in *"-L $CPORT:127.0.0.1:$PORT "*"-L $CDP:127.0.0.1:$CDP "*) return 0;; "") return 0;; esac
      kill "${old%% *}" 2>/dev/null; sleep 1
    fi
    nohup ssh -o ConnectTimeout=8 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -L "$TPORT:127.0.0.1:5037" -L "$CPORT:127.0.0.1:$PORT" -L "$CDP:127.0.0.1:$CDP" "$MK_SSH" \
      "sudo -n -u rack env HOME=/var/lib/rack $MK_ADB start-server >/dev/null 2>&1; while true; do sleep 30; sudo -n -u rack env HOME=/var/lib/rack $MK_ADB start-server >/dev/null 2>&1; done" \
      > "$TLOG" 2>&1 &
    local _; for _ in $(seq 1 12); do sleep 1; open_port "$TPORT" && return 0; done
    die "tunnel to Fat Misaka failed (see $TLOG)"
  }
  touch_last() {
    local f=$STATE/$ID.last t; t=$(date +%s)
    [ -f "$STATE/$ID.keep" ] && [ "$(cat "$STATE/$ID.keep")" -gt "$t" ] && return 0
    [ -f "$f" ] && [ $(( t - $(stat -c %Y "$f") )) -lt 60 ] && return 0
    : > "$f"
    mrun "mkdir -p $MK_BASE/last; echo $t > $MK_BASE/last/$ID.txt" >/dev/null 2>&1 &
    TOUCH_PID=$!
  }
  noaudio_check() { # 0 = the qemu process of this instance carries -no-audio
    local c; c=$(mrun "pgrep -af 'qemu-system.* -avd $ID ' | head -1") || { [ "$BASHPID" = "$$" ] && die_unreachable; return 2; }
    case "$c " in *' -no-audio '*) return 0;; esac
    return 1
  }
  ruiko_emus() { mk_emus_raw; }
  ruiko_free_gb() { local o; o=$(mrun "awk '/MemAvailable/ {printf \"%.1f\", \$2/1048576}' /proc/meminfo") || return 1; printf '%s\n' "$o" | tail -1; }
  ruiko_cpu() { # the host's CPU load %, mean of 3 samples over ~6 s
    local o; o=$(mrun 'for i in 1 2 3; do read -r _ a b c d e f g _ < /proc/stat; t1=$((a+b+c+d+e+f+g)); i1=$((d+e)); sleep 2; read -r _ a b c d e f g _ < /proc/stat; t2=$((a+b+c+d+e+f+g)); i2=$((d+e)); echo $(( 100 * ( (t2-t1) - (i2-i1) ) / (t2-t1) )); done | awk "{s+=\$1} END {printf \"%d\", s/NR}"') || return 1
    printf '%s\n' "$o" | tail -1
  }
  mem_guard() { # exit 4 memory, exit 5 CPU or the lane's core cap, exit 7 host unreachable
    local free need cpu mine
    free=$(ruiko_free_gb) || die_unreachable; need=$(instance_gb)
    case "$free" in ''|*[!0-9.]*) ;; *) if awk "BEGIN{exit !($free - $need < $KEEP_FREE_GB)}"; then die "Fat Misaka has only $free GB free: one more $SHAPE instance (about $need GB) would leave it under $KEEP_FREE_GB GB" 4; fi;; esac
    mine=$(mk_emus_raw | grep -vc "^$ID " || true)
    if [ $(( (${mine:-0} + 1) * 4 )) -gt "$MK_MAX_CORES" ]; then die "the lane already uses $((${mine:-0} * 4)) of its $MK_MAX_CORES cores on Fat Misaka (4 per instance, the rest is for the builds): lane.sh <id> down one first, or lane.sh reap" 5; fi
    # The host's CPU % is NOT a gate by default: a Chromium build keeps the 80 threads at 99 % for hours, and the lane's share is the
    # core cap above (24). LANE_MISAKA_MAX_CPU=<percent> turns the util guard on.
    [ -n "${LANE_MISAKA_MAX_CPU:-}" ] || return 0
    cpu=$(ruiko_cpu) || die_unreachable
    case "$cpu" in ''|*[!0-9]*) ;; *) if [ "$cpu" -gt "$LANE_MISAKA_MAX_CPU" ]; then die "Fat Misaka's CPU is at $cpu % (mean over 6 s), above $LANE_MISAKA_MAX_CPU %: wait, or stop an instance you do not need" 5; fi;; esac
  }
  progress() { # lane.sh's, and every progress line of a long step (provision, first-start wait) keeps the idle clock fresh: the reaper stopped an instance mid-provision otherwise
    echo "[lane $ID] $*" >&2
    local f=$STATE/$ID.lastw t; t=$(date +%s)
    [ -f "$f" ] && [ $(( t - $(stat -c %Y "$f") )) -lt 100 ] && return 0
    : > "$f"; mrun "mkdir -p $MK_BASE/last; echo $t > $MK_BASE/last/$ID.txt" >/dev/null 2>&1
    return 0
  }
  wait_boot() { # wait_boot <secs> : as lane.sh's, and it keeps the idle clock fresh every 2 minutes (a boot is use; the reaper must not stop it)
    local t0 now lt; t0=$(date +%s); lt=$t0
    while :; do
      if running && booted; then echo $(( $(date +%s) - t0 )); return 0; fi
      [ $(( $(date +%s) - t0 )) -ge 40 ] && [ "$(A get-state 2>/dev/null | tr -d '\r')" != device ] && adb_register
      now=$(date +%s); [ $(( now - t0 )) -gt $(( ${1:-240} * ${LANE_MISAKA_BOOT_FACTOR:-3} )) ] && return 1   # the host is busy with builds: boots take longer
      if [ $(( now - lt )) -ge 120 ]; then lt=$now; mrun "mkdir -p $MK_BASE/last; echo $now > $MK_BASE/last/$ID.txt" >/dev/null 2>&1; fi
      sleep 4
    done
  }
  avd_state() { local o; o=$(mrun "$(mk_probe_sh "$ID" 0)") || return 1; probe_state "$o" || { printf '%s\n' "no lane-state line: $(printf '%s' "$o" | head -c 120)" > "$MK_ERRF"; return 1; }; }
  start_emulator() { # start_emulator <extra emulator args>
    local extra=$1 t0
    mk_ensure_on
    mrun "$MK_BASE/start.sh $ID $PORT $MK_GPU $extra ${LANE_MISAKA_ARGS:-} </dev/null >/dev/null 2>&1 &
sleep 1; echo started" >/dev/null || die_unreachable
    t0=$(date +%s)
    while :; do
      emu_up && return 0
      [ $(( $(date +%s) - t0 )) -ge "${LANE_START_WAIT:-30}" ] && break
      sleep 3
    done
    progress "start.sh ran but no emulator process of $ID appeared on Fat Misaka (log: $MK_BASE/logs/$ID.txt)"
    return 1
  }
  stop_instance() {
    con kill >/dev/null 2>&1
    local i; for i in $(seq 1 20); do emu_gone && break; sleep 2; done
    mrun "case $ID in aemu-fold-m[12]|aemu-a53-m[12]) ;; *) exit 1;; esac
pkill -f 'qemu-system.* -avd $ID ' 2>/dev/null; sleep 2; rm -f $MK_BASE/avd/$ID.avd/*.lock" >/dev/null
  }
  make_avd() { # the AVD on the host from the Ruiko template of the shape: unix paths, 4 GB, 4 cores, swiftshader, no audio output
    local target=android-37.0 sysdir=android-37.0 d="$MK_BASE/avd/$ID.avd"; [ "$SHAPE" = a53 ] && { target=android-36; sysdir=android-36; }
    local t=$STATE/avd-$ID; mkdir -p "$t"
    sed -e "s/@AVD@/$ID/g" -e "s#^image.sysdir.1=.*#image.sysdir.1=system-images/$sysdir/google_apis/x86_64/#" -e "s/^hw.ramSize=.*/hw.ramSize=${LANE_MISAKA_RAM_MB:-4096}/" \
      -e "s/^hw.cpu.ncore=.*/hw.cpu.ncore=4/" -e "s/^hw.gpu.mode=.*/hw.gpu.mode=$MK_GPU/" -e "s/^hw.audioOutput=.*/hw.audioOutput=no/" "$HERE/ruiko/$SHAPE.ini" > "$t/config.ini"
    printf 'avd.ini.encoding=UTF-8\npath=%s\ntarget=%s\n' "$d" "$target" > "$t/$ID.ini"
    mk_ensure_on
    mrun "mkdir -p $d $MK_BASE/logs $MK_BASE/last $MK_BASE/home/.android" >/dev/null || die_unreachable
    local enc1 enc2; enc1=$(base64 -w0 "$t/config.ini"); enc2=$(base64 -w0 "$t/$ID.ini")
    mrun "echo $enc1 | base64 -d > $d/config.ini && echo $enc2 | base64 -d > $MK_BASE/avd/$ID.ini && echo copied" | grep -q copied \
      || die "writing the AVD files on Fat Misaka failed (the AVD is half-made: lane.sh create $SHAPE $N finishes it, lane.sh $ID delete --yes removes it)" 7
    # start.sh and the console token (the same token file the console client reads)
    local s; s=$(base64 -w0 "$HERE/misaka/start.sh"); tok=$(tr -d '[:space:]' < "$AEMU_CONSOLE_TOKEN")
    mrun "echo $s | base64 -d > $MK_BASE/start.sh && chmod +x $MK_BASE/start.sh; umask 077; printf %s '$tok' > $MK_BASE/home/.emulator_console_auth_token" >/dev/null || die_unreachable
  }
  misaka_delete() {
    [ "${1:-}" = --yes ] || die "this removes the instance's disk and snapshots on Fat Misaka; say: lane.sh $ID delete --yes" 2
    [ "$(mk_power_state)" = up ] || die "Fat Misaka is off: nothing of $ID is running; power it on (lane.sh $ID up) to delete its files" 7
    provision_lock
    stop_instance
    emu_up; local ec=$?
    [ "$ec" = 2 ] && die_unreachable
    [ "$ec" = 0 ] && die "an emulator process of $ID is still on Fat Misaka after stopping it: nothing was deleted"
    mrun "case $ID in aemu-fold-m[12]|aemu-a53-m[12]) ;; *) exit 1;; esac
rm -rf $MK_BASE/avd/$ID.avd $MK_BASE/avd/$ID.ini $MK_BASE/last/$ID.txt $MK_BASE/logs/$ID.txt" >/dev/null || die_unreachable
    rm -f "$CFG/$ID.env" "$CFG/$ID.ports" "$STATE/$ID.last" "$STATE/$ID.keep"; rm -rf "$STATE/avd-$ID"; mk_lease_release
    J ok=b:true id="$ID" deleted=b:true state=absent
  }
  misaka_keep() { local t=$1; mrun "mkdir -p $MK_BASE/last; echo $t > $MK_BASE/last/$ID.txt" >/dev/null || die_unreachable; }
}
