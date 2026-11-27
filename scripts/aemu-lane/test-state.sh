#!/bin/bash
# test-state.sh - hermetic test of lane.sh's view of what exists on Ruiko (StaticForge #1346). No Ruiko, no emulator, no adb server:
# a fake ssh / scp / adb first on PATH answer from files in a temp dir, and lane.sh runs with its state, config and coord db there too.
# Prints "ok ..." / "FAIL ..." / "skip ..." per check, exits non-zero on any FAIL. Takes about half a minute.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANE=$HERE/lane.sh
T=$(mktemp -d "${TMPDIR:-/tmp}/lane-test.XXXXXX")
CTL=$T/ctl; mkdir -p "$T/bin" "$T/state" "$T/cfg" "$CTL"
LISTENER=''
cleanup() { [ -n "$LISTENER" ] && kill "$LISTENER" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# ---- the fakes
cat > "$T/bin/ssh" <<'FAKE'
#!/bin/bash
# fake ssh: decodes the -EncodedCommand script, logs it, answers from $FAKE_CTL (states, emus.once, mode)
CTL=${FAKE_CTL:?}
n=$(( $(cat "$CTL/ssh.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$CTL/ssh.n"
echo "${@: -2:1}" >> "$CTL/ssh.hosts"
script=$(printf '%s' "${@: -1}" | sed 's/.*-EncodedCommand //' | base64 -d | iconv -f UTF-16LE -t UTF-8)
{ echo "=== call $n"; printf '%s\n' "$script"; } >> "$CTL/ssh.log"
printf '%s' "$script" | md5sum | cut -c1-32 >> "$CTL/ssh.hashes"
fail() { echo "kex_exchange_identification: read: Connection reset by peer" >&2; echo "Connection reset by 192.168.100.12 port 22" >&2; exit 255; }
mode=$(cat "$CTL/mode" 2>/dev/null || echo ok)
case "$mode" in
  fail-forever) fail;;
  fail-first:*) [ "$n" -le "${mode#fail-first:}" ] && fail;;
  out-then-255) echo "partial output"; echo "Connection reset" >&2; exit 255;;
  exit-1) echo "boom" >&2; exit 1;;
esac
fact() { grep -m1 "^$1 " "$CTL/states" 2>/dev/null | cut -d' ' -f2-5 || true; }
case "$script" in
  *lane-state*)
    ids=$(printf '%s' "$script" | sed -n "s/.*\$ids = '\([^']*\)'.*/\1/p" | head -1)
    w=$(printf '%s' "$script" | sed -n "s/.*\$w = '\([01]\)'.*/\1/p" | head -1)
    for id in $ids; do
      if printf '%s' "$script" | grep -q 'Remove-Item'; then
        sed -i "/^$id /d" "$CTL/states" 2>/dev/null; echo "$id False False False False" >> "$CTL/states"
      fi
      f=$(fact "$id"); [ -n "$f" ] || f='False False False False'
      if [ "$w" = 1 ]; then echo "lane-state $f $id"; else echo "lane-state $f"; fi
    done;;
  *emulator.exe*)
    if [ -f "$CTL/emus.once" ]; then cat "$CTL/emus.once"; rm -f "$CTL/emus.once"; else cat "$CTL/emus" 2>/dev/null; fi;;
  *qemu-system*) echo 'qemu-system-x86_64.exe -avd aemu-fold-4  -port 5572 -no-window -no-audio -gpu host';;
  *Invoke-CimMethod*) echo 'start rc=0';;
esac
exit 0
FAKE
cat > "$T/bin/scp" <<'FAKE'
#!/bin/bash
echo "$*" >> "${FAKE_CTL:?}/scp.calls"
exit 0
FAKE
cat > "$T/bin/adb" <<'FAKE'
#!/bin/bash
# fake adb: the device is not there, or (adb.up-after N) is there from the Nth get-state on
CTL=${FAKE_CTL:?}
up=0
if [ -f "$CTL/adb.up-after" ]; then [ "$(cat "$CTL/adb.n" 2>/dev/null || echo 0)" -ge "$(cat "$CTL/adb.up-after")" ] && up=1; fi
case "$*" in
  *get-state*)
    n=$(( $(cat "$CTL/adb.n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$CTL/adb.n"
    if [ -f "$CTL/adb.up-after" ] && [ "$n" -gt "$(cat "$CTL/adb.up-after")" ]; then echo device; exit 0; fi
    echo "error: device 'emulator-5572' not found" >&2; exit 1;;
  *sys.boot_completed*) [ "$up" = 1 ] && echo 1; exit 0;;
  *) [ -f "$CTL/adb.up-after" ] && exit 0; echo "error: device 'emulator-5572' not found" >&2; exit 1;;
esac
FAKE
chmod +x "$T/bin/"*

# ---- helpers
export FAKE_CTL=$CTL
LANEENV=(env "PATH=$T/bin:$PATH" LANE_NO_LEASE=1 "AEMU_LANE_STATE=$T/state" "AEMU_LANE_CONFIG=$T/cfg" "AGENT_COORD_DB=$T/no-such-coord.db"
  LANE_RUIKO_HOST=fake-ruiko LANE_RPS_RETRY_SLEEP=0 LANE_START_WAIT=0 LANE_STARTING_WAIT=1)
FAILS=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; FAILS=$((FAILS + 1)); }
check() { local desc=$1; shift; if "$@"; then ok "$desc"; else bad "$desc"; fi; }
t() { eval "$1"; }   # check "..." t '[[ compound && condition ]]'

reset_ctl() { rm -f "$CTL"/*; printf '%s\n' 'aemu-fold-1 True True True True' 'aemu-fold-2 True True True False' 'aemu-fold-3 False False True False' > "$CTL/states"; }
run() { rc=0; "${LANEENV[@]}" "$LANE" "$@" > "$T/out" 2> "$T/err" || rc=$?; }
calls() { cat "$CTL/ssh.n" 2>/dev/null || echo 0; }
quiet_state() { : > "$T/state/reap.stamp"; : > "$T/state/aemu-fold-4.last"; }   # no background reap, no background last-use write
rows() { python3 -c '
import json,sys
for r in json.load(sys.stdin):
    print(r["id"], r["state"], str(r["created"]).lower(), str(r["golden"]).lower(), str(r["running"]).lower())' < "$T/out"; }
EXPECT_ROWS='aemu-fold-1 golden true true false
aemu-fold-2 created true false false
aemu-fold-3 partial false false false
aemu-fold-4 absent false false false
aemu-a53-1 absent false false false
aemu-a53-2 absent false false false
aemu-a53-3 absent false false false
aemu-a53-4 absent false false false'
has() { grep -q -- "$2" "$1"; }
hasnt() { [ ! -f "$1" ] || ! grep -q -- "$2" "$1"; }
hasf() { grep -qF -- "$2" "$1"; }

# ---- 1. list: the state of each row
reset_ctl; run list
check "1 list exits 0" [ "$rc" = 0 ]
check "1 list rows: golden / created / partial / absent, with created, golden and running" [ "$(rows)" = "$EXPECT_ROWS" ]
check "1 list uses the ssh host LANE_RUIKO_HOST only" [ "$(sort -u "$CTL/ssh.hosts")" = fake-ruiko ]
check "1 list is two ssh calls (processes, one probe for all ids)" [ "$(calls)" = 2 ]

# ---- 2. the connection fails for ever
reset_ctl; echo fail-forever > "$CTL/mode"; run list
check "2 list with no connection exits 7" [ "$rc" = 7 ]
check "2 list with no connection prints no row on stdout" hasnt "$T/out" created
check "2 list with no connection says 'cannot reach Ruiko' on stderr" has "$T/err" 'cannot reach Ruiko'
check "2 list with no connection tried 4 times" [ "$(calls)" = 4 ]
check "2 the ssh error line is in the message" has "$T/err" 'Connection reset by'

# ---- 3. the connection fails for the first 2 calls only
reset_ctl; echo fail-first:2 > "$CTL/mode"; run list
check "3 list after 2 dropped connections exits 0" [ "$rc" = 0 ]
check "3 list after 2 dropped connections is the same list as check 1" [ "$(rows)" = "$EXPECT_ROWS" ]
reset_ctl; echo fail-first:3 > "$CTL/mode"; run list
check "3 three dropped connections are still within the 4 tries" [ "$rc" = 0 ]

# the default back-off (no LANE_RPS_RETRY_SLEEP): one dropped connection waits 1 s plus jitter, under 3.5 s
reset_ctl; echo fail-first:1 > "$CTL/mode"; t0=$(date +%s%N)
"${LANEENV[@]}" LANE_RPS_RETRY_SLEEP= "$LANE" list > "$T/out" 2> "$T/err"; rc=$?
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
check "3 default back-off: list succeeds after one dropped connection" [ "$rc" = 0 ]
check "3 default back-off waited about 1 s (took ${ms} ms)" t '[[ $ms -ge 1000 && $ms -lt 3500 ]]'

# ---- 4. only a connection failure is retried
for m in out-then-255 exit-1; do
  reset_ctl; echo "$m" > "$CTL/mode"; run list
  check "4 mode $m: list exits 7 (an answer without lane-state is not 'absent')" [ "$rc" = 7 ]
  check "4 mode $m: every ssh call made once, nothing retried (2 calls)" [ "$(calls)" = 2 ]
  check "4 mode $m: no command was sent twice" [ -z "$(sort "$CTL/ssh.hashes" | uniq -d)" ]
  check "4 mode $m: stdout has no row" hasnt "$T/out" created
done
reset_ctl; echo fail-forever > "$CTL/mode"; run reap
check "4 reap with no connection exits 7" [ "$rc" = 7 ]

# ---- instance commands call tunnel() first: it needs a listening local port. aemu-fold-4 gets private high ports through its
# $CFG/aemu-fold-4.ports (the lane's own override, in the temp config dir): another session's real tunnel on 15104 and its console
# on 5572 are never touched, and the test's `con kill` goes to a closed port. A throwaway listener serves as the tunnel port.
read -r CP TP DP < <(python3 -c '
import socket
ss = [socket.socket() for _ in range(3)]
for s in ss: s.bind(("127.0.0.1", 0))
print(*[s.getsockname()[1] for s in ss])')
set_ports() { echo "$CP $TP $DP" > "$T/cfg/aemu-fold-4.ports"; }
python3 -c "
import socket
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', $TP)); s.listen(5); s.settimeout(300)
while True: s.accept()[0].close()   # accept and drop: an unaccepted backlog would make the next connect hang" &
LISTENER=$!
LISTENING=0
for _ in $(seq 1 30); do (exec 3<>/dev/tcp/127.0.0.1/$TP) 2>/dev/null && { LISTENING=1; break; }; sleep 0.1; done
if [ "$LISTENING" = 0 ]; then
  for d in "5 up" "6 create" "7 delete" "8 provision" "9 delete --yes" "10 up (no process)" "11 up (boot in progress)"; do echo "skip ${d%% *} ${d#* }: no free local port for a throwaway tunnel listener"; done
else
  set_ports
  F4=aemu-fold-4

  # ---- 5. up: absent / partial / unreachable
  reset_ctl; quiet_state; run $F4 up
  check "5 up on an absent instance says 'has no AVD yet'" has "$T/err" 'has no AVD yet: lane.sh create fold 4'
  check "5 up on an absent instance exits non-zero (not 7)" t '[[ $rc != 0 && $rc != 7 ]]'
  reset_ctl; quiet_state; echo 'aemu-fold-4 False False True False' > "$CTL/states"; run $F4 up
  check "5 up on a partial instance says 'half-made'" has "$T/err" 'half-made'
  reset_ctl; quiet_state; echo 'aemu-fold-4 True False False False' > "$CTL/states"; run $F4 up
  check "5 up on an .ini alone is partial too" has "$T/err" 'half-made'
  reset_ctl; quiet_state; echo fail-forever > "$CTL/mode"; run $F4 up
  check "5 up with no connection exits 7" [ "$rc" = 7 ]
  check "5 up with no connection says 'cannot reach Ruiko'" has "$T/err" 'cannot reach Ruiko'
  check "5 up with no connection never says 'has no AVD yet'" hasnt "$T/err" 'has no AVD yet'

  # ---- 6. create over a golden instance
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True True' > "$CTL/states"; run create fold 4
  check "6 create over a golden instance refuses" has "$T/err" 'already exists with its golden snapshot'
  check "6 create over a golden instance exits non-zero" [ "$rc" != 0 ]
  check "6 create over a golden instance copied nothing (scp never called)" [ ! -s "$CTL/scp.calls" ]
  reset_ctl; quiet_state; echo fail-forever > "$CTL/mode"; run create fold 4
  check "6 create with no connection exits 7, scp never called" t '[[ $rc = 7 && ! -s $CTL/scp.calls ]]'

  # ---- 7. delete needs --yes
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True True' > "$CTL/states"; run $F4 delete
  check "7 delete without --yes refuses (exit 2)" [ "$rc" = 2 ]
  check "7 delete without --yes says how to confirm" has "$T/err" 'lane.sh aemu-fold-4 delete --yes'
  check "7 delete without --yes sent no removal command" hasnt "$CTL/ssh.log" 'Remove-Item'
  check "7 delete without --yes left the state alone" has "$CTL/states" 'aemu-fold-4 True True True True'

  # ---- 8. provision / golden on an instance that is not running
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True True' > "$CTL/states"; run $F4 provision
  check "8 provision on a stopped instance says 'is not running'" has "$T/err" 'aemu-fold-4 is not running: lane.sh aemu-fold-4 up first'
  check "8 provision on a stopped instance exits non-zero" [ "$rc" != 0 ]
  run $F4 golden
  check "8 golden on a stopped instance says 'is not running'" has "$T/err" 'is not running: lane.sh aemu-fold-4 up first'

  # ---- 9. delete --yes removes the four Ruiko paths and the local leftovers
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True True' > "$CTL/states"
  mkdir -p "$T/state/avd-aemu-fold-4"; : > "$T/state/avd-aemu-fold-4/config.ini"; : > "$T/cfg/aemu-fold-4.env"; : > "$T/cfg/aemu-fold-4.ports"; : > "$T/state/aemu-fold-4.keep"
  : > "$T/cfg/aemu-fold-1.env"
  run $F4 delete --yes
  check "9 delete --yes exits 0" [ "$rc" = 0 ]
  check "9 delete --yes answers deleted + absent" [ "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["ok"], d["deleted"], d["state"])' "$T/out")" = 'True True absent' ]
  check "9 delete --yes removes the AVD folder of this id" hasf "$CTL/ssh.log" "Remove-Item -LiteralPath (\$b + '\\avd\\' + \$id + '.avd') -Recurse"
  check "9 delete --yes removes the .ini of this id" hasf "$CTL/ssh.log" "Remove-Item -LiteralPath (\$b + '\\avd\\' + \$id + '.ini')"
  check "9 delete --yes removes the last-use file of this id" hasf "$CTL/ssh.log" "Remove-Item -LiteralPath (\$b + '\\last\\' + \$id + '.txt')"
  check "9 delete --yes removes the log file of this id" hasf "$CTL/ssh.log" "Remove-Item -LiteralPath (\$b + '\\logs\\' + \$id + '.txt')"
  check "9 delete --yes guards the id inside PowerShell" has "$CTL/ssh.log" "aemu-(fold|a53)-\[1-4\]"
  check "9 local leftovers of this id are gone" t '[[ ! -e $T/state/avd-aemu-fold-4 && ! -e $T/cfg/aemu-fold-4.env && ! -e $T/cfg/aemu-fold-4.ports && ! -e $T/state/aemu-fold-4.keep ]]'
  check "9 another instance's config is untouched" [ -e "$T/cfg/aemu-fold-1.env" ]
  set_ports; quiet_state; run $F4 up
  check "9 after the delete, up says 'has no AVD yet'" has "$T/err" 'has no AVD yet'

  # ---- 10. a start that launches nothing is reported, one attempt per start
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True False' > "$CTL/states"; run $F4 up
  check "10 up whose start launches no process says so" has "$T/err" 'no emulator process of aemu-fold-4 appeared'
  check "10 up whose start launches no process exits non-zero" t '[[ $rc != 0 ]]'
  check "10 up tried exactly two starts" [ "$(grep -c 'Invoke-CimMethod' "$CTL/ssh.log")" = 2 ]

  # ---- 11. up does not kill a boot in progress
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True False' > "$CTL/states"
  echo 'aemu-fold-4 4242 5572' > "$CTL/emus.once"; echo 1 > "$CTL/adb.up-after"
  run $F4 up --nosetup
  check "11 up on an instance that is starting waits for it" has "$T/err" 'aemu-fold-4 is already starting: waiting for it'
  check "11 up on an instance that is starting answers booted" [ "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["ok"], d["state"], d["noAudio"])' "$T/out")" = 'True booted True' ]
  check "11 up on an instance that is starting stopped nothing and started nothing" bash -c "! grep -q -e Stop-Process -e Invoke-CimMethod '$CTL/ssh.log'"
  reset_ctl; quiet_state; echo 'aemu-fold-4 True True True False' > "$CTL/states"; echo 'aemu-fold-4 4242 5572' > "$CTL/emus.once"
  run $F4 up
  check "11 a boot that never completes is stopped, then started fresh" has "$T/err" 'is up but adb does not see it' && has "$CTL/ssh.log" 'Invoke-CimMethod'
fi

echo
if [ "$FAILS" = 0 ]; then echo "all checks passed"; else echo "$FAILS check(s) FAILED"; exit 1; fi
