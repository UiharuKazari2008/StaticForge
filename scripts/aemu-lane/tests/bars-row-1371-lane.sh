#!/bin/bash
# bars-row-1371-lane.sh --agent <agent id that holds the instance> <lane id, e.g. aemu-fold-3> <step> [args]
#
# StaticForge #1371 (Fleet item 230), part B2: the proof, on a Fold-shaped lane emulator (it has Shizuku, as the owner's phone), that
# Melaton Bars keeps Android's Back / Home / Recents row empty ("the row held") across the app's own silent self-update.
#
# What holds the row: the shell process `melaton_navblank`, which keeps a status bar disable token (dumpsys statusbar: a record
# `pkg=com.android.shell token`, what1=0x03600000, while held). The fix under test (DSApp tmp/1331-bars-heal-3): the new app process starts
# a NEW holder first and kills the old one only after the new one answered OK; the old holder lives GRACE_MS (10 s) after its app died.
# The truth of "are Android's buttons hidden" is the disable record and its history, never a screenshot (memory #335).
#
# Steps (each prints PASS / FAIL / INFO lines with the measured numbers; exit 0 only when no check failed, 3 when it refused to start):
#   baseline                      status (booted, Shizuku, versionCode, noAudio), the feature on (the page's own setter), held; the holder's pid,
#                                 its parent chain (Shizuku's server or adbd?), melaton_navblank.out, the disable record
#   install <buildId>             lane.sh install-release <buildId> once, wait until held, the gap in the history (an old build -> the first fixed
#                                 build is EXPECTED to show one: the old side has no grace; reported as the baseline, not a failure)
#   adbd                          lane.sh adbd tcpip 5555: did Shizuku survive, did the holder keep its pid with no CLEAR row, or die and how long until held
#   self-update <from> <to>       the proof: the instance runs <from>, <to> is staged by the server; Restart Now once; the row never empty
#   self-update-screen-off <from> <to>   the same with the display off first (lane.sh screen off / on)
#   crash                         kill -9 the app's MAIN pid once (display on): the system restarts it; the row judged by SystemUI's net-flag log; when the Bars
#                                 service is bound again; no `gesture fallback on` while it came back within 30 s; observes 150 s
#   unbound-start                 the Bars service taken out of enabled_accessibility_services (the exact old value saved), the main pid killed in the same
#                                 root call: early hold, then (about +30 s) the not-bound warning + `gesture fallback on`, the no-hint overlay, no holder / record;
#                                 or the app's heal puts the service back (also valid). Then RESTORES the saved value exactly and brings the room back
#                                 (screen off / on after 60 s); the final state must equal the baseline. A trap restores the setting on any exit
#   idle [seconds] [--screen-off] D14: nothing happens (default 180 s): no holder start, no MelatonBars retry line, no wake lock of the app
#   end                           remove the sampler file and the guest helper, print the final state line
# Options: --grace <seconds> (the old side's grace, default 10; 20 from build 35), --agent <id> (else env COORD_AGENT_ID), --dry-run (print the plan, run nothing), --light (self-update steps: the sampler reads the
# pids only, no `dumpsys statusbar` in its loop, and the wait loops poll the pids only; the SystemUI net-flag log then decides the row).
#
# It never boots, creates, resets or reboots an instance (the caller does `lane.sh <id> up` under its coord lease), never forces an install,
# never touches the Fold, taps nothing on the soft key bar, makes no sound (the lane has none), and only reads / drives <lane id>.
# Evidence: docs/testing/evidence/1371/<lane id>/ (log.txt with host times; <step>-<time>-sample.txt, -statusbar-before/after.txt, -logcat.txt,
# -proof.txt, shots). Env: BARS1371_EVIDENCE (other folder), BARS1371_LANE (another lane.sh, for the hermetic test).
# shellcheck disable=SC2015,SC2329
set -u

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
LANE=${BARS1371_LANE:-$HERE/../lane.sh}
PKG=jp.net.seventhreeseven.dreamscape
GH=/data/local/tmp/bars1371-g.sh            # the guest helper this script pushes
GS=/data/local/tmp/bars1371-sample.txt      # the sampler's file on the guest
GRACE_S=${BARS1371_GRACE_S:-10}             # GRACE_MS of the OLD side of the update, in seconds (build 35 and later: 20); --grace <s> sets it
FAILS=0
LOG=''
EV=''
SAMPLER_ON=0
SCREEN_OFF_BY_ME=0
SKIPPED=0

usage() {
  sed -n '2,/^set -u/{/^set -u/!p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-2}"
}

# ------------------------------------------------------------------ arguments
AGENT=${COORD_AGENT_ID:-${AGENT_COORD_ID:-}}
[ -z "$AGENT" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ] && AGENT="claude-${CLAUDE_CODE_SESSION_ID:0:8}"
DRY=0; LIGHT=0; POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) [ -n "${2:-}" ] || usage 2; AGENT=$2; shift 2;;
    --dry-run) DRY=1; shift;;
    --grace) [[ ${2:-} =~ ^[0-9]+$ ]] || usage 2; GRACE_S=$2; shift 2;;
    --light) LIGHT=1; shift;;       # the self-update steps: a pids-only sampler (no dumpsys statusbar in the loop) and light polling; the net-flag log decides the row
    -h|--help) usage 0;;
    *) POS+=("$1"); shift;;
  esac
done
ID=${POS[0]:-}; STEP=${POS[1]:-}; ARGS=()
[ "${#POS[@]}" -gt 2 ] && ARGS=("${POS[@]:2}")
[ -n "$ID" ] && [ -n "$STEP" ] || usage 2
case "$ID" in
  aemu-fold-[1-4]) ;;
  aemu-a53-[1-4]) echo "REFUSED: $ID is an A53-shaped instance. This proof is for the Shizuku route of a Fold-shaped one (aemu-fold-1..4)." >&2; exit 3;;
  *) echo "usage error: not a lane id: $ID (aemu-fold-1..4)" >&2; exit 2;;
esac
INT_RE='^[0-9]+$'
case "$STEP" in
  baseline|adbd|end|crash|unbound-start) [ "${#ARGS[@]}" = 0 ] || usage 2;;
  install) [ "${#ARGS[@]}" = 1 ] || usage 2;;
  self-update|self-update-screen-off)
    [ "${#ARGS[@]}" = 2 ] && [[ ${ARGS[0]} =~ $INT_RE ]] && [[ ${ARGS[1]} =~ $INT_RE ]] || usage 2
    [ "${ARGS[1]}" -gt "${ARGS[0]}" ] || { echo "usage error: <to> (${ARGS[1]}) must be greater than <from> (${ARGS[0]})" >&2; exit 2; };;
  idle)
    IDLE_SECS=180; IDLE_OFF=0
    for a in "${ARGS[@]+"${ARGS[@]}"}"; do
      case "$a" in --screen-off) IDLE_OFF=1;; *) [[ $a =~ $INT_RE ]] && [ "$a" -ge 30 ] && [ "$a" -le 3600 ] && IDLE_SECS=$a || usage 2;; esac
    done;;
  *) usage 2;;
esac

plan() {
  echo "bars-row-1371-lane.sh $STEP on $ID (agent ${AGENT:-?}): plan only, nothing is run"
  case "$STEP" in
    baseline) cat <<'EOF'
  1. lane.sh <id> status: booted, shape fold, shizukuRunning, appVersionCode, noAudio must be true (else refuse, exit 3); lane.sh <id> now (lease check)
  2. push the guest helper to /data/local/tmp/bars1371-g.sh; lane.sh <id> eval AndroidBars.setConfig({enabled,softkeys,room: true}) (the page's own setter)
  3. wait until held (a holder pid and a `pkg=com.android.shell token` record), up to 90 s
  4. record: holder pid, ps -A -o PID,PPID,NAME of it and its parent, the parent chain (adbd? shizuku_server? init?), melaton_navblank.out, the disable record, accessibility service bound
  5. PASS: held, exactly one holder and one record, .out is OK (not OK nolink / ERR), the holder is no descendant of adbd, MelatonBarService bound and not crashed
EOF
    ;;
    install) cat <<'EOF'
  1. preflight as baseline (row held now); start the guest sampler (0.2 s: <ms> recs= pids= app=)
  2. lane.sh <id> install-release <buildId> ONCE (never --force); wait until the app and a holder are back and held (120 s)
  3. 15 s settle, sampler pulled into the evidence folder and removed; the statusbar history window read
  4. PASS: installed (versionCode as the build says) and held again within 120 s. The gap (history CLEAR -> BACK, sampler recs=0) is reported, not judged
EOF
    ;;
    adbd) cat <<'EOF'
  1. preflight (row held now); sampler on; shizuku_server and holder pids noted
  2. lane.sh <id> adbd tcpip 5555 (adbd restarts)
  3. report: did Shizuku survive; did the holder keep its pid with no CLEAR row (survived), or die and was held again (after how long)
  4. PASS: the row is held at the end (60 s). The survive / died finding is printed as INFO FINDING, not judged
EOF
    ;;
    self-update|self-update-screen-off) cat <<'EOF'
  1. preflight (row held now); the instance must run <from>; sampler on; wait up to 180 s until `update state` shows <to> staged (never pushed by hand)
  2. (screen-off variant: lane.sh <id> screen off first, switched on again at the end)
  3. lane.sh <id> update restart-now ONCE; wait until versionCode is <to>, the app is back and a NEW holder pid holds (120 s); wait for the old holder to go (30 s)
  4. sampler pulled and removed; lane.sh <id> update proof; statusbar dump before / after; logcat of the window
  5. PASS only if all hold: no recs=0 sample from the moment the old app pid disappeared; two holder pids at some sample or the pid changed with recs never 0;
     in the history the new token's BACK HOME RECENT SEARCH row comes BEFORE the old token's CLEAR tag=binderDied (no CLEAR followed by a later BACK in the window);
     silent route (ApkInstall lines name `via shizuku` or `via local adb`), 0 packageinstaller activities / notifications; no /data/local/tmp/ds-install-* file;
     MelatonBarService bound, not in Crashed services
  6. report: old app pid gone -> new holder's row, how much of the 10 s grace was used, when the new process started, whether the old holder's grace ran out first
EOF
    ;;
    idle) cat <<EOF
  1. preflight (row held now); holder pid, melaton_navblank.out mtime, alarm count noted; the display off first only with --screen-off
  2. ${IDLE_SECS:-180} s with only a read every 15 s (dumpsys power | grep -i wake, filtered for the app's uid / package)
  3. PASS: holder pid set unchanged, .out untouched, no holder-related MelatonBars log line, no wake lock of the app in any sample (all MelatonBars lines are printed)
EOF
    ;;
    crash) cat <<'EOF'
  1. preflight (row held, Bars service bound, display on); light sampler on; lane.sh <id> kill-app once (kill -9 of the MAIN pid)
  2. 150 s of one-line observations (holder, app, Bars bound, setting, navbar overlay, records); logcat of the window
  3. PASS: the app restarted; SystemUI's net flags never dropped the row (else the seconds with no bar drawn are reported); no `gesture fallback on` when the service
     rebound within 30 s; at the end held, bound, mode 0, three-button overlay. Reports early hold / link times, grace or replaced, BarsHeal / BarsServiceWatch lines
EOF
    ;;
    unbound-start) cat <<'EOF'
  1. preflight as crash; save `settings get secure enabled_accessibility_services` and accessibility_enabled exactly; one root call: remove the Melaton entry and kill -9 the main pid
  2. observe 80 s: early hold at process start, the service not binding, the not-bound warning and `gesture fallback on (...)` at about +30 s, the overlay, holder / records gone
     (or the heal puts the service back: reported, also valid)
  3. RESTORE: put the saved value back exactly, wait for the service, wait 60 s after the switch, screen off / on (lane.sh screen off|on), wait for the baseline
     (mode 0, three-button overlay [x], held, bound); one app restart only if the room did not come back. A trap restores the setting if the script dies
EOF
    ;;
    end) cat <<'EOF'
  1. stop the sampler if any; remove /data/local/tmp/bars1371-sample.txt, bars1371-sampler.pid and the guest helper; print the final state line. The instance keeps running
EOF
    ;;
  esac
  echo "  commands relied on: lane.sh <id> status | now | sh | su | adb push/pull | eval | shot | other | home | screen on|off | install-release | update state|restart-now|proof | adbd tcpip"
}
if [ "$DRY" = 1 ]; then plan; exit 0; fi

# ------------------------------------------------------------------ evidence, logging
EV=${BARS1371_EVIDENCE:-$ROOT/docs/testing/evidence/1371/$ID}
mkdir -p "$EV" || { echo "cannot create $EV" >&2; exit 2; }
LOG=$EV/log.txt
RUN=$(date +%Y%m%d-%H%M%S)
P=$EV/$STEP-$RUN                            # the prefix of this run's files
say()  { local m; m="[$(date +%H:%M:%S)] $*"; echo "$m"; echo "$m" >> "$LOG"; }
ok()   { say "PASS  $*"; }
no()   { say "FAIL  $*"; FAILS=$((FAILS + 1)); }
info() { say "INFO  $*"; }
refuse() { say "REFUSED  $*"; exit 3; }
rawlines() { # rawlines <label> <text> : the lines as found, indented, into the log too
  local l; [ -n "$2" ] || { say "      ($1: none)"; return 0; }
  while IFS= read -r l; do say "      $1: $l"; done <<<"$2"
}

# ------------------------------------------------------------------ lane access (all pinned to <lane id> by lane.sh itself)
L() { timeout "${LTO:-180}" "$LANE" --agent "$AGENT" "$ID" "$@"; }
G() { L sh "$*" 2>&1 | tr -d '\r'; }                 # a command in the guest (the shell user)
GR() { L su "$*" 2>&1 | tr -d '\r'; }                # a command in the guest as root (userdebug su), reads only
gh() { G "sh $GH $*"; }                              # the guest helper
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
kv() { sed -n "s/^$1=//p" | head -1; }               # one KEY=value line out of an analysis
na() { printf '%s' "${1:-n/a}"; }
sgn() { awk -v v="${1:-}" 'BEGIN{ if (v=="") printf "n/a"; else printf "%+.1f s", v }'; }
field() { sed -n "s/.*\\b$1=\\([^ ]*\\).*/\\1/p" | head -1; }   # one key=value out of a quick/state line
PYAN() { python3 -I -c "$PYSRC" "$@"; }

A11Y_MODIFIED=0; A11Y_SAVED=''; A11Y_EN_SAVED=''
restore_a11y() { # puts the saved enabled_accessibility_services / accessibility_enabled back EXACTLY (null = deleted); safe to call twice
  [ "$A11Y_MODIFIED" = 1 ] || return 0
  local sc
  if [ "$A11Y_SAVED" = null ]; then sc="settings delete secure enabled_accessibility_services"; else sc="settings put secure enabled_accessibility_services '$A11Y_SAVED'"; fi
  if [ "$A11Y_EN_SAVED" = null ]; then sc="$sc; settings delete secure accessibility_enabled"; else sc="$sc; settings put secure accessibility_enabled '$A11Y_EN_SAVED'"; fi
  GR "$sc" >/dev/null 2>&1
  A11Y_MODIFIED=0
}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ "$A11Y_MODIFIED" = 1 ]; then restore_a11y; say "cleanup: enabled_accessibility_services restored to the saved value"; fi
  if [ "$SAMPLER_ON" = 1 ]; then L sh "rm -f /data/local/tmp/bars1371-sampler.pid" >/dev/null 2>&1; fi
  if [ "$SCREEN_OFF_BY_ME" = 1 ]; then L screen on >/dev/null 2>&1; say "cleanup: display switched on again"; fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------------------ the guest helper (mksh / toybox only; pushed, removed by `end`)
write_guest() {
  cat > "$EV/guest-helpers.sh" <<'GUEST'
# bars1371 guest helper: pushed by scripts/aemu-lane/tests/bars-row-1371-lane.sh, removed by its `end` step.
PKG=jp.net.seventhreeseven.dreamscape
D=/data/local/tmp
N=melaton_navblank
PF=$D/bars1371-sampler.pid
OUT=$D/bars1371-sample.txt
c=$1
[ $# -gt 0 ] && shift
rec_count() { dumpsys statusbar 2>/dev/null | grep -c 'pkg=com.android.shell token'; }
join() { tr ' ' ','; }
vc() {
  v=$(pm list packages --show-versioncode 2>/dev/null | grep "^package:$PKG versionCode:" | sed 's/.*versionCode://; s/[^0-9].*//' | head -1)
  [ -n "$v" ] || v=$(dumpsys package $PKG 2>/dev/null | sed -n 's/^ *versionCode=\([0-9]*\).*/\1/p' | head -1)
  echo "$v"
}
procline() {
  q=$1
  s=$(cat /proc/$q/stat 2>/dev/null)
  [ -n "$s" ] || return 1
  r=$(echo "$s" | sed 's/^.*) //')
  set -- $r
  echo "pid=$q ppid=$2 pgrp=$3 sid=$4 uid=$(grep '^Uid:' /proc/$q/status 2>/dev/null | cut -f2) comm=[$(cat /proc/$q/comm 2>/dev/null)] cmd=[$(tr '\0' ' ' < /proc/$q/cmdline 2>/dev/null | cut -c1-300)] cgroup=[$(tr '\n' ' ' < /proc/$q/cgroup 2>/dev/null)] ctx=[$(tr -d '\0' < /proc/$q/attr/current 2>/dev/null)]"
  return 0
}
case $c in
selftest) echo "ms=$(date +%s%3N)";;
clock) echo "$(date +%s%3N) $(date '+%s %Y-%m-%d %H:%M:%S')";;
quick)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  echo "holder=${h:--} app=${a:--} recs=$(rec_count)";;
state)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  o=$(cat $D/$N.out 2>/dev/null | tr '\n' ' ')
  echo "holder=${h:--} app=${a:--} recs=$(rec_count) out=[$o] vc=$(vc) shizuku=$(pidof shizuku_server | join) adbd=$(pidof adbd | join) mode=$(settings get secure navigation_mode) overlay=$(cmd overlay list 2>/dev/null | grep -E '\[x\].*navbar' | sed 's/.*navbar\.//' | tr '\n' ,)";;
vc) vc;;
obs)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  b=$(dumpsys accessibility 2>/dev/null | grep 'Bound services' | grep -ci 'melaton')
  sv=$(settings get secure enabled_accessibility_services | grep -c 'MelatonBarService')
  o=$(cmd overlay list 2>/dev/null | grep -E '\[x\].*navbar' | sed 's/.*navbar\.//' | tr '\n' ,)
  echo "ms=$(date +%s%3N) holder=${h:--} app=${a:--} bound=$b svc=$sv ovl=${o:--} recs=$(rec_count)";;
procs) echo "shizuku=$(pidof shizuku_server | join) adbd=$(pidof adbd | join) holder=$(pidof $N | join) app=$(pidof $PKG | join)";;
chain)
  q=$1; n=0
  while [ -n "$q" ] && [ "$q" -gt 0 ] 2>/dev/null && [ $n -lt 10 ]; do
    l=$(procline $q) || break
    echo "$l"
    q=$(echo "$l" | sed 's/^pid=[0-9]* ppid=\([0-9]*\).*/\1/')
    n=$((n+1))
  done;;
procline) procline $1;;
psrows) ps -A -o PID,PPID,NAME | sed -n 1p; ps -A -o PID,PPID,NAME | grep -E "^ *($1|$2) ";;
a11y) dumpsys accessibility 2>/dev/null | grep -E 'Bound services|Crashed services|Binding services';;
pids)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  echo "holder=${h:--} app=${a:--} recs=-";;
sample)
  ME=$$; K=0; LT=0
  for x in "$@"; do [ "$x" = keep ] && K=1; [ "$x" = light ] && LT=1; done
  [ $K = 1 ] || : > $OUT
  echo $ME > $PF
  i=0
  while [ "$(cat $PF 2>/dev/null)" = "$ME" ] && [ $i -lt 6000 ]; do
    t=$(date +%s%3N)
    if [ $LT = 1 ]; then r=-; else r=$(rec_count); fi
    h=$(pidof $N | join)
    a=$(pidof $PKG | join)
    echo "$t recs=$r pids=${h:--} app=${a:--}" >> $OUT
    i=$((i+1))
    sleep 0.2
  done;;
sampler)
  p=$(cat $PF 2>/dev/null)
  if [ -n "$p" ] && [ -d /proc/$p ]; then echo "alive $p lines=$(wc -l < $OUT)"; else echo dead; fi;;
sampler-stop) rm -f $PF;;
snap)
  U=$(pm list packages -U 2>/dev/null | grep "^package:$PKG " | sed 's/.*uid://; s/[^0-9].*//' | head -1)
  [ -n "$U" ] || U=none
  w=$(dumpsys power 2>/dev/null | grep -i wake | grep -E "uid=$U[ )]|[{ ]$U[ }]|$PKG")
  h=$(pidof $N | join)
  f=$(pidof $N | sed 's/ .*//')
  echo "snap ms=$(date +%s%3N) holder=${h:--} wl=$(echo "$w" | grep -c .) outmt=$(stat -c %Y $D/$N.out 2>/dev/null) vcs=$(grep '^voluntary_ctxt_switches' /proc/${f:-0}/status 2>/dev/null | tr -dc 0-9) uid=$U"
  echo "$w" | grep . | sed 's/^/WL: /'
  if [ "$1" = full ]; then echo "alarms=$(dumpsys alarm 2>/dev/null | grep -c "$PKG")"; fi;;
end) rm -f $PF $OUT $D/bars1371-g.sh;;
*) echo "unknown helper command: $c"; exit 2;;
esac
GUEST
}
ensure_guest() {
  write_guest
  L adb push "$EV/guest-helpers.sh" "$GH" >/dev/null 2>&1 || refuse "cannot push the guest helper to $GH (lane.sh $ID adb push failed)"
  local s; s=$(gh selftest | tail -1)
  [[ $s =~ ^ms=[0-9]{13}$ ]] || refuse "the guest's date does not give milliseconds (date +%s%3N said '$s'): the sampler needs them"
}

# ------------------------------------------------------------------ the analyses (python, no network, reads the pulled files)
read -r -d '' PYSRC <<'PY'
import sys, re, time, calendar

def rel(t, t0): return round((t - t0) / 1000.0, 1)

def load(path):
    S = []
    for ln in open(path, errors='replace'):
        m = re.match(r'^(\d{13}) recs=(\d+|-) pids=(\S+) app=(\S+)\s*$', ln)
        if not m: continue
        S.append((int(m.group(1)), int(m.group(2)) if m.group(2) != '-' else -1,
                  frozenset(x for x in m.group(3).split(',') if x not in ('', '-')),
                  frozenset(x for x in m.group(4).split(',') if x not in ('', '-'))))
    return S

def zero_spans(S):
    out, i, n = [], 0, len(S)
    while i < n:
        if S[i][1] == 0:
            j = i
            while j + 1 < n and S[j + 1][1] == 0: j += 1
            lo = S[j][0] - S[i][0]
            hi = (S[j + 1][0] if j + 1 < n else S[j][0]) - (S[i - 1][0] if i > 0 else S[i][0])
            out.append((S[i][0], S[j][0], lo, hi, j - i + 1))
            i = j + 1
        else: i += 1
    return out

def cmd_sample(a):
    f, from_ms = a[0], int(a[2])
    old_apps = set(x for x in a[1].split(',') if x and x != '-')
    old_h = set(x for x in (a[3].split(',') if len(a) > 3 else []) if x and x != '-')
    S = load(f)
    print('SAMPLES=%d' % len(S))
    W = [s for s in S if s[0] >= from_ms]
    if len(W) < 2:
        print('RESULT=FAIL'); print('WHY=%d samples in the window (the sampler did not run or its file is empty)' % len(W)); return
    gaps = [W[i + 1][0] - W[i][0] for i in range(len(W) - 1)]
    med = sorted(gaps)[len(gaps) // 2]
    blind = [(rel(W[i][0], W[0][0]), gaps[i]) for i in range(len(gaps)) if gaps[i] > 1500]
    print('WINDOW_SAMPLES=%d BLIND_GAPS_OVER_1500MS=%s' % (len(W), ','.join('+%.1fs:%dms' % b for b in blind) or 'none'))
    print('PERIOD_MEDIAN_MS=%d' % med)
    print('MAXGAP_MS=%d' % max(gaps))
    tl, last = [], None
    for s in W:
        key = (tuple(sorted(s[2])), tuple(sorted(s[3])))
        if key != last:
            tl.append('+%.1fs holder=%s app=%s recs=%d' % (rel(s[0], W[0][0]), ','.join(key[0]) or '-', ','.join(key[1]) or '-', s[1]))
            last = key
    print('TIMELINE (offset from the first window sample; a line per change of the holder / app pids):')
    for x in tl[:40]: print('  ' + x)
    zs = zero_spans(W)
    nrec = [s[1] for s in W if s[1] >= 0]
    print('RECS_SAMPLED=%s' % ('yes' if nrec else 'no (light sampler: the pids only; the SystemUI net-flag log decides the row)'))
    print('ZERO_SAMPLES_IN_WINDOW=%d MINRECS=%s' % (sum(z[4] for z in zs), min(nrec) if nrec else 'n/a'))
    for z in zs[:10]:
        print('  recs=0 span: %d samples, %.1f s at +%.1f s (the row was empty between %.1f and %.1f s, sampler resolution)' % (z[4], (z[1] - z[0]) / 1000.0, rel(z[0], W[0][0]), z[2] / 1000.0, z[3] / 1000.0))
    print('ZERO_SPAN_MAX_S=%.1f' % (max([z[3] for z in zs] or [0]) / 1000.0))
    if not old_apps:
        print('RESULT=INFO'); return
    old_app = ','.join(sorted(old_apps))
    death = next((s for s in W if not (old_apps & s[3])), None)
    if death is None:
        print('RESULT=FAIL'); print('WHY=the old app pid %s never disappeared in the samples (no update happened in the window)' % old_app); return
    td = death[0]
    prev = [s for s in W if s[0] < td]
    if not old_h and prev: old_h = set(prev[-1][2])
    post = [s for s in W if s[0] >= td]
    zeros = [s for s in post if s[1] == 0]
    newh = set().union(*[s[2] for s in post]) - old_h
    overlap = [s for s in W if len(s[2]) >= 2]
    first_new = next((s for s in post if s[2] & newh), None)
    first_new_rec = next((s for s in post if (s[2] & newh) and (s[1] >= 1 or s[1] < 0)), None)
    old_gone = next((s for s in post if old_h and not (s[2] & old_h)), None)
    app_back = next((s for s in post if s[3] and not (old_apps & s[3])), None)
    print('T_DEATH_MS=%d' % td)
    print('OLD_APP=%s OLD_HOLDERS=%s NEW_HOLDERS=%s' % (old_app, ','.join(sorted(old_h)) or '-', ','.join(sorted(newh)) or '-'))
    print('ZEROS_AFTER_DEATH=%d' % len(zeros))
    if zeros: print('  recs=0 first at +%.1f s, last at +%.1f s after the old app pid disappeared' % (rel(zeros[0][0], td), rel(zeros[-1][0], td)))
    print('OVERLAP_SAMPLES=%d' % len(overlap))
    print('OVERLAP_SPAN_S=%s' % (('%.1f' % ((overlap[-1][0] - overlap[0][0]) / 1000.0)) if overlap else '0'))
    if overlap: print('  two holder pids alive from +%.1f s to +%.1f s (relative to the old app pid disappearing)' % (rel(overlap[0][0], td), rel(overlap[-1][0], td)))
    print('APP_BACK_S=%s' % (rel(app_back[0], td) if app_back else 'none'))
    print('NEW_PID_S=%s' % (rel(first_new[0], td) if first_new else 'none'))
    print('NEW_REC_S=%s' % (rel(first_new_rec[0], td) if first_new_rec else 'none'))
    print('OLD_GONE_S=%s' % (rel(old_gone[0], td) if old_gone else 'none'))
    why = []
    if zeros: why.append('recs=0 in %d samples after the old app pid disappeared' % len(zeros))
    if not newh: why.append('no new holder pid ever appeared')
    print('RESULT=%s' % ('FAIL' if why else 'PASS'))
    print('WHY=%s' % ('; '.join(why) if why else ('recs never 0 after the old app pid disappeared' if nrec else 'recs not sampled (light mode)') + '; new holder pid(s) %s%s' % (','.join(sorted(newh)), '; two holders alive at once' if overlap else '; the pid changed with no overlap seen at this sampling')))

ROW = re.compile(r'^\s*\[(\d+)\]\s+(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(.*)$')
def hist_rows(path):
    out = []
    for ln in open(path, errors='replace'):
        m = ROW.match(ln.rstrip('\n'))
        if not m: continue
        idx, ts, rest = m.group(1), m.group(2), m.group(3)
        if 'pkg=com.android.shell' not in rest: continue
        mt = re.search(r'\btag=(\S+)', rest); tag = mt.group(1) if mt else ''
        mw = re.search(r'\bwhat=(.*?)(?:\s+token=|\s+tag=|\s*$)', rest); what = mw.group(1).strip() if mw else ''
        mk = re.search(r'\btoken=(\S+)', rest); tok = mk.group(1) if mk else ''
        up = what.upper()
        if tag == 'binderDied' or 'CLEAR' in up or what == '': kind = 'CLEAR'
        elif 'BACK' in up and 'HOME' in up: kind = 'BACK'
        else: kind = 'OTHER'
        out.append((ts, int(idx), kind, what, tag, tok))
    out.sort(key=lambda r: (r[0], r[1]))
    return out

def cmd_hist(a):
    path, marker, cal_s, cal_local, mode = a[0], a[1], int(a[2]), a[3], a[4]
    t0 = int(a[5]) if len(a) > 5 and a[5] not in ('', '-') else None
    ct = time.strptime(cal_local, '%Y-%m-%d %H:%M:%S')
    off = cal_s * 1000 - calendar.timegm(ct) * 1000
    def ms(ts):
        m = re.match(r'(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d+)', ts)
        mo, d, h, mi, s, fr = m.groups(); y = ct.tm_year
        v = calendar.timegm((y, int(mo), int(d), int(h), int(mi), int(s), 0, 0, 0)) * 1000 + int((fr + '000')[:3]) + off
        if v > cal_s * 1000 + 86400000 * 2: v = calendar.timegm((y - 1, int(mo), int(d), int(h), int(mi), int(s), 0, 0, 0)) * 1000 + int((fr + '000')[:3]) + off
        return v
    R = hist_rows(path)
    W = [r for r in R if r[0] >= marker]
    print('HISTORY rows of pkg=com.android.shell in the dump: %d, in the window (>= %s device time): %d   (* = in the window)' % (len(R), marker, len(W)))
    for r in R[-14:]:
        star = '*' if r[0] >= marker else ' '
        extra = ' (+%.1f s)' % ((ms(r[0]) - t0) / 1000.0) if (t0 and r[0] >= marker) else ''
        print('  %s [%d] %s%s %-5s what=%s tag=%s token=%s' % (star, r[1], r[0], extra, r[2], r[3], r[4] or '-', r[5] or '-'))
    if not R and mode in ('order', 'survive'):
        print('NOROWS=1')
        print('RESULT=FAIL'); print('WHY=no history row of pkg=com.android.shell could be read from the dump (format not as assumed: look at the -statusbar-*.txt file)'); return
    backs = [r for r in W if r[2] == 'BACK']; clears = [r for r in W if r[2] == 'CLEAR']
    old = [r for r in R if r[0] < marker and r[2] == 'BACK']
    print('NEW_TOKENS=%s OLD_TOKEN=%s' % (','.join(sorted(set(r[5] for r in backs))) or '-', old[-1][5] if old else '-'))
    if backs: print('BACK_FIRST_MS=%d' % ms(backs[0][0]))
    if clears: print('CLEAR_FIRST_MS=%d' % ms(clears[0][0]))
    seq = [r for r in W if r[2] in ('BACK', 'CLEAR')]
    ci = next((i for i, r in enumerate(seq) if r[2] == 'CLEAR'), None)
    later_back = next((r for r in seq[ci:] if r[2] == 'BACK'), None) if ci is not None else None
    gap = ((ms(later_back[0]) - ms(seq[ci][0])) / 1000.0) if later_back else None
    if gap is not None: print('GAP_S=%.1f' % gap)
    if mode == 'order':
        if not backs: print('RESULT=FAIL'); print('WHY=no BACK HOME RECENT SEARCH row of a new token in the window (the new holder never set the flags)'); return
        if later_back: print('RESULT=FAIL'); print('WHY=a CLEAR row (%s, tag=%s) is followed by a BACK HOME RECENT SEARCH row (%s) %.1f s later: the row was given back before the new holder took it' % (seq[ci][0], seq[ci][4], later_back[0], gap)); return
        if ci is not None:
            d = (ms(clears[0][0]) - ms(backs[0][0])) / 1000.0
            print('RESULT=PASS'); print('WHY=the new token\'s BACK row (%s) comes %.1f s BEFORE the old token\'s CLEAR (%s, tag=%s)' % (backs[0][0], d, clears[0][0], clears[0][4]))
        else:
            print('RESULT=PASS'); print('WHY=the new token\'s BACK row (%s) and no CLEAR row in the window (the history may log net state only)' % backs[0][0])
    elif mode == 'survive':
        if not backs and not clears: print('RESULT=PASS'); print('WHY=no CLEAR and no BACK row in the window: the holder kept its token')
        else: print('RESULT=FAIL'); print('WHY=%d CLEAR and %d BACK rows in the window%s' % (len(clears), len(backs), ('; CLEAR at %s, next BACK %.1f s later' % (seq[ci][0], gap)) if gap is not None else ''))
    else:
        print('RESULT=INFO')
        print('WHY=%s' % (('CLEAR at %s, the next BACK row %.1f s later (the row was visible in between)' % (seq[ci][0], gap)) if gap is not None else ('%d CLEAR / %d BACK rows in the window, no CLEAR followed by a BACK' % (len(clears), len(backs)))))

def cmd_netflags(a):
    # SystemUI logs every change of the NET disable flags of display 0 (disable1): the row is emptied while BACK|HOME|RECENT|SEARCH (0x03600000) are all set
    logf, before, from_ms = a[0], a[1], int(a[2])
    td = int(a[3]) if len(a) > 3 and a[3] not in ('', '-') else None
    bound_ms = int(a[4]) if len(a) > 4 and a[4] not in ('', '-') else None
    ref = td if td is not None else from_ms
    MASK = 0x03600000
    start = None
    try:
        m = re.search(r'displayId=0\s*\n\s*mDisabled1=(0x[0-9a-fA-F]+)', open(before, errors='replace').read())
        if m: start = int(m.group(1), 16)
    except OSError: pass
    ev = []
    for ln in open(logf, errors='replace'):
        m = re.match(r'^\s*(\d{9,10}\.\d+)\s.*disableFlagsInteractor: newValue: DisableFlagsModel\(disable1=(\d+)', ln)
        if m and float(m.group(1)) * 1000 >= from_ms: ev.append((float(m.group(1)) * 1000, int(m.group(2))))
    print('NETFLAGS start disable1=%s (from the statusbar dump before), %d change(s) logged by SystemUI in the window' % ('0x%x' % start if start is not None else 'unreadable', len(ev)))
    if start is None:
        print('RESULT=FAIL'); print('WHY=the start state (displayId=0 mDisabled1) could not be read from the dump before'); return
    held = (start & MASK) == MASK
    if not held:
        print('RESULT=FAIL'); print('WHY=the row was NOT held when the window started (disable1=0x%x)' % start); return
    gaps, gstart = [], None
    for t, d in ev:
        h = (d & MASK) == MASK
        print('  %+7.1f s  disable1=0x%x  %s' % ((t - ref) / 1000.0, d, 'row emptied (held)' if h else 'ROW GIVEN BACK (Android buttons visible)'))
        if held and not h: gstart = t
        if (not held) and h and gstart is not None: gaps.append((gstart, t)); gstart = None
        held = h
    if gstart is not None: gaps.append((gstart, None))
    for g in gaps:
        print('  GAP from %+.1f s to %s (%s)' % ((g[0] - ref) / 1000.0, ('%+.1f s' % ((g[1] - ref) / 1000.0)) if g[1] else 'never within the window', ('%.1f s with the buttons visible' % ((g[1] - g[0]) / 1000.0)) if g[1] else 'still visible'))
    print('NET_GAPS=%d' % len(gaps))
    if gaps and td is not None and bound_ms is not None:
        nb = sum(max(0, min(g[1] if g[1] else bound_ms, bound_ms) - max(g[0], td)) for g in gaps) / 1000.0
        print('ROW_EMPTY_NO_BAR_S=%.1f' % nb)
    if gaps:
        print('NET_GAP_FIRST_S=%.1f' % ((gaps[0][0] - ref) / 1000.0))
        if gaps[0][1]: print('NET_GAP_TOTAL_S=%.1f' % (sum((g[1] - g[0]) / 1000.0 for g in gaps if g[1])))
        if gaps[-1][1]: print('NET_REHELD_S=%.1f' % ((gaps[-1][1] - ref) / 1000.0))
        print('RESULT=FAIL'); print('WHY=Android\'s buttons were visible %d time(s): first at %+.1f s%s (relative to %s)' % (len(gaps), (gaps[0][0] - ref) / 1000.0, (' for %.1f s' % ((gaps[0][1] - gaps[0][0]) / 1000.0)) if gaps[0][1] else ' and never hidden again', 'the old app pid disappearing' if td is not None else 'the window start'))
    else:
        print('RESULT=PASS'); print('WHY=the net disable flags never dropped the row in the window (%d change(s) logged, none un-held)' % len(ev))

def cmd_obs(a):
    f = a[0]
    td = int(a[1]) if len(a) > 1 and a[1] not in ('', '-') else None
    old_app = a[2] if len(a) > 2 else ''
    R = []
    for ln in open(f, errors='replace'):
        m = re.match(r'^ms=(\d{13}) holder=(\S+) app=(\S+) bound=(\d+) svc=(\d+) ovl=(\S*) recs=(\d+)', ln)
        if m: R.append((int(m.group(1)), m.group(2), m.group(3), int(m.group(4)), int(m.group(5)), m.group(6), int(m.group(7))))
    if not R:
        print('OBS_ROWS=0'); return
    ref = td if td is not None else R[0][0]
    last = None
    print('OBSERVATIONS (a line per change; offset from %s):' % ('the old app pid disappearing' if td is not None else 'the first observation'))
    for r in R:
        key = r[1:]
        if key != last:
            print('  %+7.1f s holder=%s app=%s bound=%d setting_has_service=%d overlay=%s records=%d' % ((r[0] - ref) / 1000.0, r[1], r[2], r[3], r[4], r[5], r[6])); last = key
    print('OBS_ROWS=%d' % len(R))
    post = [r for r in R if td is None or r[0] >= td]
    def first(pred, rows=None):
        for r in (post if rows is None else rows):
            if pred(r): return r
        return None
    un = first(lambda r: r[3] == 0)
    if un: print('UNBOUND_S=%.1f' % ((un[0] - ref) / 1000.0))
    ba = first(lambda r: r[3] == 1 and r[2] != '-' and old_app not in r[2].split(','), [r for r in post if (un is None or r[0] >= un[0])])
    if ba:
        print('BOUND_AGAIN_MS=%d' % ba[0]); print('BOUND_AGAIN_S=%.1f' % ((ba[0] - ref) / 1000.0))
    sb = first(lambda r: r[4] == 1, [r for r in post if any(x[4] == 0 for x in post if x[0] <= r[0])])
    if sb: print('SETTING_BACK_S=%.1f' % ((sb[0] - ref) / 1000.0))
    oc = first(lambda r: r[5] != '-' and 'threebutton' not in r[5])
    if oc:
        print('OVERLAY_CHANGED_S=%.1f' % ((oc[0] - ref) / 1000.0)); print('OVERLAY_NOW=%s' % oc[5])
        ob = first(lambda r: 'threebutton' in r[5], [r for r in post if r[0] > oc[0]])
        if ob: print('OVERLAY_BACK_S=%.1f' % ((ob[0] - ref) / 1000.0))
    nh = first(lambda r: r[1] != '-' and r[1] != '')
    hn = first(lambda r: r[1] == '-', [r for r in post if any(x[1] != '-' for x in post if x[0] <= r[0])])
    if hn: print('HOLDER_NONE_S=%.1f' % ((hn[0] - ref) / 1000.0))
    last_r = R[-1]
    print('LAST holder=%s app=%s bound=%d setting_has_service=%d overlay=%s records=%d' % last_r[1:])

PATS = [('KILL', r'Killing \d+:jp\.net\.seventhreeseven\.dreamscape|Force stopping jp\.net\.seventhreeseven\.dreamscape|Process jp\.net\.seventhreeseven\.dreamscape \(pid \d+\) has died'),
        ('START', r'Start proc \d+:jp\.net\.seventhreeseven\.dreamscape'),
        ('LINK', r'holder token linked'), ('DIED', r'holder died after'), ('FALLBACK', r'gesture fallback'),
        ('BINDER', r"Shizuku's binder arrived"), ('INSTALL', r'ApkInstall'),
        ('EARLY', r'early hold at process start'), ('BINDERRCV', r'ShizukuProvider: binder received'), ('BARS', r'MelatonBars:'),
        ('GESTURE', r'gesture (fallback|navigation)'), ('HEAL', r'Bars(Heal|ServiceWatch)|[Ss]ervice dropped'), ('NOTBOUND', r'not bound|unbound|not enabled'),
        ('EXIT', r'melaton_navblank: System\.exit'), ('SHELLPROC', r'Start proc \d+:jp\.net\.seventhreeseven\.dreamscape:shell'), ('SHIZUKU', r'[Ss]hizuku|ShellService')]
def cmd_logs(a):
    path, t0 = a[0], int(a[1])
    first = {}
    for ln in open(path, errors='replace'):
        m = re.match(r'^\s*(\d{9,10}\.\d+)\s', ln)
        if not m: continue
        t = float(m.group(1)) * 1000
        for key, rx in PATS:
            if re.search(rx, ln):
                if key not in first and t >= t0 - 1500: first[key] = t
                print('  LOG %-8s %+7.1f s  %s' % (key, (t - t0) / 1000.0, ln.strip()[:230]))
    for key, _ in PATS:
        if key in first: print('%s_S=%.1f' % (key, (first[key] - t0) / 1000.0))

def cmd_upd(a):
    import json
    try: d = json.load(sys.stdin)
    except Exception: print('installed=? staged=? delivery=? (unreadable)'); return
    pg = d.get('page') or {}; st = pg.get('staged') or {}; sv = d.get('server') or {}; dl = sv.get('delivery') or {}
    print('installed=%s staged=%s waiting=%s installer=%s delivery=%s/%s latest=%s' % (d.get('installedVersionCode'), st.get('versionCode', 'none'),
          'yes' if pg.get('waiting') else 'no', pg.get('installer', '?'), dl.get('versionCode', 'none'), dl.get('state', 'none'), sv.get('latestVersionCode')))

def cmd_json(a):
    import json
    try: d = json.load(sys.stdin)
    except Exception: print('unreadable=1'); return
    for k in a:
        v = d
        for p in k.split('.'):
            v = v.get(p) if isinstance(v, dict) else None
        print('%s=%s' % (k, '' if v is None else (str(v).lower() if isinstance(v, bool) else v)))

if __name__ == '__main__':
    {'sample': cmd_sample, 'hist': cmd_hist, 'netflags': cmd_netflags, 'obs': cmd_obs, 'logs': cmd_logs, 'upd': cmd_upd, 'json': cmd_json}[sys.argv[1]](sys.argv[2:])
PY

# ------------------------------------------------------------------ preflight: the instance must be booted, Fold-shaped, with Shizuku and no audio
declare -A ST
preflight() {
  local out err pf k v
  err=$EV/.status.err
  out=$(timeout 240 "$LANE" --agent "$AGENT" "$ID" status 2>"$err")
  [ -n "$out" ] || refuse "lane.sh $ID status gave no answer ($(head -c 300 "$err")). The caller boots the instance under its lease: lane.sh $ID up"
  pf=$(printf '%s' "$out" | PYAN json running booted shape shizukuRunning shizukuPid noAudio appVersionCode apkVersionCode appPid screen)
  while IFS='=' read -r k v; do [ -n "$k" ] && ST[$k]=$v; done <<<"$pf"
  [ "${ST[unreadable]:-}" = 1 ] && refuse "lane.sh $ID status is not JSON: $(printf '%s' "$out" | head -c 200)"
  [ "${ST[running]:-}" = true ] || refuse "$ID is not running (status: $(printf '%s' "$out" | head -c 200)). The caller boots it: lane.sh $ID up"
  [ "${ST[booted]:-}" = true ] || refuse "$ID is not booted yet: lane.sh $ID wait-boot"
  [ "${ST[shape]:-}" = fold ] || refuse "$ID is not a Fold-shaped instance (shape '${ST[shape]:-?}')"
  [ "${ST[shizukuRunning]:-}" = true ] || refuse "Shizuku is not running on $ID: lane.sh $ID shizuku start (the app needs a process start after it to get Shizuku's binder), or reset the instance to golden"
  [ "${ST[noAudio]:-}" = true ] || refuse "$ID is not running with -no-audio (status noAudio '${ST[noAudio]:-?}'; false also when Ruiko did not answer: run again). Never on an instance that could sound"
  ST[vc]=${ST[appVersionCode]:-${ST[apkVersionCode]:-}}
  { [[ ${ST[vc]:-} =~ $INT_RE ]] && [ "${ST[vc]}" -gt 0 ]; } || refuse "the app is not installed on $ID (appVersionCode '${ST[vc]:-?}')"
  # a leased command: refuses (exit 3) when the lease is not this agent's
  local n; n=$(timeout 60 "$LANE" --agent "$AGENT" "$ID" now 2>&1); local rc=$?
  [ "$rc" = 0 ] || refuse "lane.sh $ID now failed (exit $rc): $(printf '%s' "$n" | head -c 300). Hold the lease first: coord_device_request device=$ID, and pass --agent <the id that holds it>"
  say "status: shape=fold booted=true shizukuRunning=true (pid ${ST[shizukuPid]:-?}) appVersionCode=${ST[vc]} noAudio=true screen=${ST[screen]:-?} appPid=${ST[appPid]:-?}; $(printf '%s' "$n" | PYAN json skewMs | tr '\n' ' ')"
}

# ------------------------------------------------------------------ the row's state
quick() { gh quick | tail -1; }
is_held() { # is_held "<quick line>"
  local h r; h=$(printf '%s' "$1" | field holder); r=$(printf '%s' "$1" | field recs)
  [[ $h =~ ^[0-9] ]] && [[ $r =~ $INT_RE ]] && [ "$r" -ge 1 ]
}
wait_held() { # wait_held <label> <secs> : 0 when held, prints the seconds
  local t0 i q; t0=$(now_ms)
  for ((i = 0; i < $2; i++)); do
    q=$(quick)
    if is_held "$q"; then HELD_S=$(awk -v a="$t0" -v b="$(now_ms)" 'BEGIN{printf "%.1f", (b-a)/1000}'); HELD_Q=$q; return 0; fi
    sleep 1
  done
  HELD_S=$2; HELD_Q=${q:-}; return 1
}
require_held() { # the instance must hold the row before a step that proves something about it
  local q; q=$(quick)
  is_held "$q" || refuse "the row is not held now ($q). Run the baseline step first (it switches the feature on and waits until held)"
  say "before: $q"
}
clock() { # sets CLK_MS (device epoch ms), CLK_S, CLK_LOCAL ('YYYY-MM-DD HH:MM:SS') and MARKER ('MM-DD HH:MM:SS', the history's form)
  local c; c=$(gh clock | tail -1)
  CLK_MS=${c%% *}; c=${c#* }; CLK_S=${c%% *}; CLK_LOCAL=${c#* }
  MARKER=${CLK_LOCAL:5}
  [[ $CLK_MS =~ ^[0-9]{13}$ ]] && [[ $CLK_S =~ ^[0-9]{10}$ ]] || refuse "the guest clock could not be read (got '$c')"
}
dump_statusbar() { G 'dumpsys statusbar' > "$1"; }
pull_logcat() { # pull_logcat <from device ms> <file> : the window's log lines that matter, incl. SystemUI's net disable flags (the row's real state)
  local fs=$(( $1 / 1000 - 3 ))
  G 'logcat -d -v epoch -b main -b system -b crash' | awk -v f="$fs" '{ t=$1+0; if (t >= f) print }' \
    | grep -E 'MelatonBars|ApkInstall|ShellService|[Ss]hizuku|LocalAdb|navblank|AndroidRuntime|FATAL|[Pp]ackage[Ii]nstaller|jp\.net\.seventhreeseven\.dreamscape|disableFlagsInteractor|even\.dreamscape|Choreographer|Slow (dispatch|delivery)|ANR in|am_anr|Davey|Skipped [0-9]+ frames|Bars[A-Z][A-Za-z]+ *:|AccessibilityManagerService.*(Melaton|dreamscape)' | cut -c1-300 > "$2"
  info "logcat of the window: $2 ($(wc -l < "$2") lines kept)"
}

sampler_start() { # sampler_start [keep]
  L sh "sh $GH sampler-stop" >/dev/null 2>&1; sleep 1
  local s try
  for try in "setsid nohup" "nohup"; do
    L sh "$try sh $GH sample $* </dev/null >/dev/null 2>&1 &" >/dev/null 2>&1
    sleep 2
    s=$(gh sampler | tail -1)
    case "$s" in alive*) SAMPLER_ON=1; info "sampler on (guest, 0.2 s loop): $s"; return 0;; esac
  done
  refuse "the guest sampler did not start ($s): nothing was changed"
}
sampler_collect() { # sampler_collect : stop, pull into $P-sample.txt, remove the guest file
  L sh "sh $GH sampler-stop" >/dev/null 2>&1; sleep 1.5
  SAMPLER_ON=0
  L adb pull "$GS" "$P-sample.txt" >/dev/null 2>&1 || { no "the sampler file could not be pulled from the guest"; return 1; }
  L sh "rm -f $GS" >/dev/null 2>&1
  info "sampler file: $P-sample.txt ($(wc -l < "$P-sample.txt") samples)"
}
shot() { L shot "$P-$1.png" >/dev/null 2>&1 && info "screenshot $P-$1.png (display 0; proves nothing about the row, see the disable record)"; }

gvc() { gh vc | tail -1; }
a11y_check() { # MelatonBarService bound and not crashed
  local a b c
  a=$(gh a11y)
  b=$(printf '%s\n' "$a" | grep 'Bound services' | head -1)
  c=$(printf '%s\n' "$a" | grep 'Crashed services' | head -1)
  rawlines a11y "$a"
  if printf '%s' "$b" | grep -qiE 'Melaton|MelatonBarService'; then
    if printf '%s' "$c" | grep -qiE 'Melaton|MelatonBarService'; then no "MelatonBarService is in Crashed services: $c"; else ok "MelatonBarService is bound and not in Crashed services"; fi
  else no "MelatonBarService is not among the Bound services (line: ${b:-none})"; fi
}
ds_install_left() { G 'ls -la /data/local/tmp 2>/dev/null | grep ds-install' | grep -c 'ds-install'; }
apk_files() { GR "find /data/data/$PKG /sdcard/Android/data/$PKG -type f -name '*.apk' -exec ls -l {} \\; 2>/dev/null"; }

# ------------------------------------------------------------------ baseline
step_baseline() {
  preflight; ensure_guest
  local bs q route chain ps1 hpid ppid o rec what1
  bs=$(L eval 'JSON.stringify((function(s){return {cfg:{enabled:s.config.enabled,softkeys:s.config.softkeys,room:s.config.room},service:s.service,running:s.running,navPx:s.navPx}})(JSON.parse(AndroidBars.getState())))' 2>&1 | tail -1)
  info "bars state before: ${bs:-none}"
  o=$(L eval 'AndroidBars.setConfig(JSON.stringify({enabled:true,softkeys:true,room:true})); "set"' 2>&1 | tail -1)
  if printf '%s' "$o" | grep -q '"ok":true\|"value":"set"'; then info "feature switched on through the page: $o"; else no "the page's setter did not answer (is the page up?): $o"; fi
  if wait_held "baseline" 90; then ok "held after ${HELD_S} s: $HELD_Q"; else no "NOT held after ${HELD_S} s: ${HELD_Q:-no answer}"; fi
  q=$(gh state | tail -1); info "state: $q"
  # the holder: exactly one pid and one record
  hpid=$(printf '%s' "$q" | field holder)
  if [[ $hpid =~ ^[0-9]+$ ]]; then ok "one holder pid ($hpid)"; else no "no single holder pid (holder=$hpid)"; fi
  rec=$(G "dumpsys statusbar | grep 'pkg=com.android.shell token'")
  rawlines record "$rec"
  if [ "$(printf '%s\n' "$rec" | grep -c 'pkg=com.android.shell token')" = 1 ]; then ok "one disable record of the shell holder"; else no "the shell disable record count is not 1 ($(printf '%s\n' "$rec" | grep -c 'pkg=com.android.shell token'))"; fi
  what1=$(printf '%s' "$rec" | sed -n 's/.*what1=\(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
  info "record flags what1=${what1:-not in the line} (expected 0x03600000 while held)"
  # .out
  o=$(printf '%s' "$q" | sed -n 's/.*out=\[\(.*\)\] vc=.*/\1/p')
  case "$o" in
    "OK "|OK) ok "melaton_navblank.out is 'OK' (the token was linked)";;
    "OK nolink"*) no "melaton_navblank.out says '$o': the holder started but its token is not linked (no death notice for the app)";;
    ERR*) no "melaton_navblank.out says '$o'";;
    *) info "melaton_navblank.out: '${o}' (not one of OK / OK nolink / ERR: check by hand)";;
  esac
  # the parent chain
  if [[ $hpid =~ ^[0-9]+$ ]]; then
    chain=$(gh chain "$hpid")
    rawlines chain "$chain"
    ppid=$(printf '%s\n' "$chain" | sed -n '1s/^pid=[0-9]* ppid=\([0-9]*\).*/\1/p')
    ps1=$(gh psrows "$hpid" "${ppid:-0}")
    rawlines "ps -A -o PID,PPID,NAME" "$ps1"
    if printf '%s\n' "$chain" | sed 1d | grep -q 'comm=\[adbd\]'; then route=ADBD
    elif printf '%s\n' "$chain" | sed 1d | grep -qE 'comm=\[shizuku_server\]|cmd=\[[^]]*shizuku'; then route=SHIZUKU
    else route=ORPHAN; fi
    case "$route" in
      ADBD) no "the holder is a descendant of adbd (route: adbd, not Shizuku): an adbd restart kills it";;
      SHIZUKU) ok "the holder's parent chain contains Shizuku's server (route: Shizuku; not a child of adbd)";;
      *) ok "the holder is no descendant of adbd (its parent chain ends at pid $ppid: a started-and-detached process; the route is NOT decidable from ancestry alone, the cmd / sid / cgroup above and the adbd step decide)";;
    esac
    info "route by ancestry: $route"
  fi
  info "Shizuku server pid ${ST[shizukuPid]:-?}; guest: $(gh procs | tail -1)"
  a11y_check
  rawlines "app log (180 s)" "$(L logcat 180 2>/dev/null | grep -E "MelatonBars|ShellService|Shizuku|navblank" | cut -c1-230 | tail -14)"
  info "(the lines 'holder token linked (#1331)' / \"Shizuku's binder arrived: holding the row (#1331)\" exist only on a fixed build; absent on an older one)"
  dump_statusbar "$P-statusbar.txt"; info "full statusbar dump: $P-statusbar.txt"
  L other >/dev/null 2>&1; sleep 3; shot settings-in-front; L home >/dev/null 2>&1; sleep 2; shot home
}

# ------------------------------------------------------------------ install
step_install() {
  local b=${ARGS[0]} out inst vcaft vcb pre appb hold0 an
  preflight; ensure_guest; require_held
  pre=$(quick); appb=$(printf '%s' "$pre" | field app); hold0=$(printf '%s' "$pre" | field holder)
  vcb=$(gvc); info "versionCode before: $vcb"
  dump_statusbar "$P-statusbar-before.txt"
  sampler_start
  clock; local T0=$CLK_MS CL_S=$CLK_S CL_L=$CLK_LOCAL MK=$MARKER
  info "lane.sh install-release $b (once, no --force) at device ms $T0"
  out=$(LTO=420 L install-release "$b" 2>&1)
  say "install-release answer: $(printf '%s' "$out" | tail -1 | cut -c1-400)"
  an=$(printf '%s' "$out" | tail -1 | PYAN json installed versionCode versionCodeAfter note)
  inst=$(printf '%s' "$an" | kv installed); vcaft=$(printf '%s' "$an" | kv versionCodeAfter)
  if [ "$inst" != true ]; then
    sampler_collect >/dev/null 2>&1
    if [ -z "$inst" ]; then no "install-release failed: $(printf '%s' "$out" | tail -1 | cut -c1-300)"; else SKIPPED=1; say "SKIP  install: nothing was installed ($(printf '%s' "$an" | kv note)). The lane never installs the same build twice; no gap was measured"; fi
    return
  fi
  if wait_held "install" 120; then
    ok "installed versionCode $vcaft (was $vcb) and held again ${HELD_S} s after install-release returned: $HELD_Q"
  else no "installed versionCode $vcaft but NOT held again after ${HELD_S} s: ${HELD_Q:-no answer}"; fi
  [ "$(gvc)" = "$vcaft" ] || no "the installed versionCode on the guest is $(gvc), not $vcaft"
  sleep 15
  sampler_collect
  dump_statusbar "$P-statusbar-after.txt"
  info "sampler analysis (old app pid $appb, old holder $hold0):"
  PYAN sample "$P-sample.txt" "${appb:--}" "$T0" "${hold0:--}" | tee -a "$LOG" | sed 's/^/      /'
  pull_logcat "$T0" "$P-logcat.txt"
  info "net disable flags of display 0 (SystemUI's log), the gap in the row:"
  PYAN netflags "$P-logcat.txt" "$P-statusbar-before.txt" "$T0" - | tee -a "$LOG" | sed 's/^/      /'
  info "history window (the dump's own history, when this Android build has one):"
  PYAN hist "$P-statusbar-after.txt" "$MK" "$CL_S" "$CL_L" gap "$T0" | tee -a "$LOG" | sed 's/^/      /'
  info "EXPECTED when going from an old build (no grace on the old side) to the first fixed build: a gap. This is the baseline, not a failure of the fix."
  shot after-install
}

# ------------------------------------------------------------------ adbd
step_adbd() {
  local pre hold0 shz0 shz1 h1 q out s
  preflight; ensure_guest; require_held
  pre=$(quick); hold0=$(printf '%s' "$pre" | field holder)
  shz0=$(gh procs | tail -1); info "before: $shz0"
  dump_statusbar "$P-statusbar-before.txt"
  sampler_start
  clock; local T0=$CLK_MS CL_S=$CLK_S CL_L=$CLK_LOCAL MK=$MARKER
  info "lane.sh adbd tcpip 5555 at device ms $T0"
  out=$(LTO=150 L adbd tcpip 5555 2>&1); say "adbd answer: $(printf '%s' "$out" | tail -1 | cut -c1-300)"
  # the guest is reachable again when the helper answers
  for s in $(seq 1 30); do q=$(quick); printf '%s' "$q" | grep -q '^holder=' && break; sleep 2; done
  shz1=$(gh procs | tail -1); info "after: $shz1"
  s=$(gh sampler | tail -1)
  if [ "$s" = dead ]; then info "the guest sampler died with adbd (it is a child of the restarted adbd): restarting it; the window around the restart is NOT sampled, the history decides"; sampler_start keep; else info "the guest sampler survived the adbd restart ($s)"; fi
  if wait_held "adbd" 60; then ok "the row is held ${HELD_S} s after adbd came back: $HELD_Q"; else no "the row is NOT held 60 s after adbd came back: ${HELD_Q:-no answer}"; fi
  sleep 10
  sampler_collect
  dump_statusbar "$P-statusbar-after.txt"
  h1=$(printf '%s' "$HELD_Q" | field holder)
  local sh0 sh1; sh0=$(printf '%s' "$shz0" | field shizuku); sh1=$(printf '%s' "$shz1" | field shizuku)
  PYAN sample "$P-sample.txt" - "$T0" | tee -a "$LOG" | sed 's/^/      /'
  pull_logcat "$T0" "$P-logcat.txt"
  local hr; info "net disable flags of display 0 (SystemUI's log):"
  hr=$(PYAN netflags "$P-logcat.txt" "$P-statusbar-before.txt" "$T0" -); printf '%s\n' "$hr" | tee -a "$LOG" | sed 's/^/      /'
  info "history window (the dump's own history, when this Android build has one):"
  PYAN hist "$P-statusbar-after.txt" "$MK" "$CL_S" "$CL_L" survive "$T0" | tee -a "$LOG" | sed 's/^/      /'
  info "FINDING Shizuku server: before '${sh0:--}', after '${sh1:--}' -> $([ -n "$sh1" ] && [ "$sh0" = "$sh1" ] && echo 'SURVIVED the adbd restart (same pid)' || echo 'did NOT survive as the same process')"
  if [ "$h1" = "$hold0" ] && [ "$(printf '%s' "$hr" | kv RESULT)" = PASS ]; then
    info "FINDING holder: SURVIVED the adbd restart (same pid $hold0, the net disable flags never dropped the row): the Shizuku-route result of a real phone"
  else
    info "FINDING holder: did NOT survive with its token (pid $hold0 -> ${h1:--}); $(printf '%s' "$hr" | kv WHY); the row was held again after ${HELD_S} s of waiting (net-flag gap above)"
    info "the lane docs say an adbd restart (tcpip / usb) kills Shizuku on the lane; if Shizuku is gone now, run lane.sh $ID shizuku start and let the app get a new process before a self-update step, or reset the instance to golden"
  fi
}

# ------------------------------------------------------------------ self-update (screen on / off)
step_selfupdate() { # step_selfupdate <from> <to> <screen off: 0|1>
  local from=$1 to=$2 off=$3 cur q appb holdb u t0 i ustate page_vc
  preflight; ensure_guest
  cur=$(gvc)
  [ "$cur" = "$from" ] || refuse "the instance runs versionCode '$cur', not $from. Install <from> first (the install step, or lane.sh $ID install-release)"
  require_held
  q=$(gh state | tail -1); info "state before: $q"
  appb=$(printf '%s' "$q" | field app); holdb=$(printf '%s' "$q" | field holder)
  { [[ $appb =~ ^[0-9]+$ ]] && [[ $holdb =~ ^[0-9]+$ ]]; } || refuse "no single app pid / holder pid before the update (app=$appb holder=$holdb)"
  if [ "${ST[screen]:-}" != Awake ]; then info "the display was ${ST[screen]:-?}: switching it on for this step"; L screen on >/dev/null 2>&1; sleep 2; fi
  rawlines "the app's route state (LocalAdb pass line, last 15 min)" "$(L logcat 900 2>/dev/null | grep -E 'LocalAdb: pass \(' | tail -1 | cut -c1-260)"
  if [ "$LIGHT" = 1 ]; then sampler_start light; else sampler_start; fi
  # <to> staged by the server (never pushed by hand): wait up to 180 s
  t0=$(date +%s); ustate=''; local started=0
  while :; do
    u=$(timeout 90 "$LANE" --agent "$AGENT" "$ID" update state 2>/dev/null | PYAN upd)
    ustate=$u; page_vc=$(printf '%s' "$u" | field staged)
    # after an update the app comes back for its services only (no activity, so no page and no DevTools): start it in front once, as a person would
    if [ "$(printf '%s' "$u" | field installer)" = '?' ] && [ "$started" = 0 ]; then started=1; info "the app has no page (it restarted for its services only): lane.sh start-app, once"; L start-app >/dev/null 2>&1; sleep 12; continue; fi
    if [ "$(printf '%s' "$u" | field installed)" = "$to" ]; then sampler_collect >/dev/null 2>&1; refuse "the instance already runs $to (installed before Restart Now: the app installed it by itself, so there is nothing left to prove here). State: $u"; fi
    [ "$page_vc" = "$to" ] && break
    [ $(( $(date +%s) - t0 )) -ge 180 ] && { sampler_collect >/dev/null 2>&1; refuse "$to is not staged after 180 s (update state: $u). The server stages the LATEST release on lane devices by itself: <to> must be the latest build; the delivery record of a staged versionCode is not sent twice"; }
    sleep 10
  done
  info "update state: $ustate (waited $(( $(date +%s) - t0 )) s)"
  rawlines "apk files before" "$(apk_files)"
  if [ "$off" = 1 ]; then
    local r; r=$(L screen off 2>&1 | tail -1); info "display off: $r"
    SCREEN_OFF_BY_ME=1
    case "$r" in *Asleep*|*Dozing*) ;; *) refuse "the display is not off after lane.sh screen off ($r)";; esac
    sleep 5
  else shot before; fi
  dump_statusbar "$P-statusbar-before.txt"
  clock; local T0=$CLK_MS CL_S=$CLK_S CL_L=$CLK_LOCAL MK=$MARKER TH; TH=$(date +%s)
  info "lane.sh update restart-now (once) at device ms $T0; old app pid $appb, old holder $holdb"
  local ans ast; ans=$(LTO=90 L update restart-now 2>&1 | tail -1); say "restart-now answer: $(printf '%s' "$ans" | cut -c1-400)"
  ast=$(printf '%s' "$ans" | PYAN json answer.state answer.via | tr '\n' ' ')
  info "answer: $ast"
  if [ "$(printf '%s' "$ans" | PYAN json ok | kv ok)" != true ]; then no "lane.sh update restart-now failed, nothing was sent: $(printf '%s' "$ans" | cut -c1-300)"; sampler_collect >/dev/null 2>&1; return; fi
  case "$ast" in
    *waiting*|*needs_permission*|*nothing_staged*|*already_attempted*|*"no bridge"*) no "restart-now did not start the install ($ast): no silent route was used"; sampler_collect >/dev/null 2>&1; return;;
  esac
  # wait: versionCode <to>, the app back with another pid, a NEW holder pid, held
  local ok2=0 nq nvc napp nh nhnew
  for ((i = 0; i < 60; i++)); do
    sleep 2
    nq=$(gh pids | tail -1); napp=$(printf '%s' "$nq" | field app); nh=$(printf '%s' "$nq" | field holder)
    nhnew=$(printf '%s' "$nh" | tr ',' '\n' | grep -E '^[0-9]+$' | grep -vx "$holdb" | head -1)
    if [[ $napp =~ ^[0-9]+$ ]] && [ "$napp" != "$appb" ] && [ -n "$nhnew" ]; then
      nq=$(quick); nvc=$(gvc)
      if is_held "$nq" && [ "$nvc" = "$to" ]; then ok2=1; break; fi
    fi
  done
  local took=$(( $(date +%s) - TH ))
  if [ "$ok2" = 1 ]; then ok "versionCode $to installed, the app is back (pid $appb -> $napp) and a NEW holder holds (pid $holdb -> $nh) $took s after Restart Now: $nq"
  else no "after 120 s: not (versionCode $to, a new app pid, a new holder pid, held): $(quick) vc=$(gvc)"; fi
  # when the new holder's process started (device clock, /proc/<pid>), for the shell command's begin
  local hst=''; [ -n "${nhnew:-}" ] && hst=$(G "stat -c %y /proc/$nhnew" | tail -1)
  # the old holder is killed after the new one answered OK, or ends with its own grace
  local g0; g0=$(date +%s)
  while [ $(( $(date +%s) - g0 )) -lt 30 ]; do printf ',%s,' "$(gh pids | tail -1 | field holder)" | grep -q ",$holdb," || break; sleep 1; done
  sleep 3
  [ "$off" = 1 ] && { L screen on >/dev/null 2>&1; SCREEN_OFF_BY_ME=0; info "display switched on again"; sleep 2; }
  sampler_collect
  dump_statusbar "$P-statusbar-after.txt"
  # ---- the verdicts
  local an hr lg
  info "sampler analysis:"
  an=$(PYAN sample "$P-sample.txt" "$appb" "$T0" "$holdb"); printf '%s\n' "$an" | tee -a "$LOG" | sed 's/^/      /'
  [ "$(printf '%s' "$an" | kv RESULT)" = PASS ] && ok "sampler: $(printf '%s' "$an" | kv WHY)" || no "sampler: $(printf '%s' "$an" | kv WHY)"
  local mg; mg=$(printf '%s' "$an" | kv MAXGAP_MS)
  [ -n "$mg" ] && [ "$mg" -gt 1500 ] && info "WARN the sampler had a gap of $mg ms: a shorter empty row inside it is seen only in the history below"
  pull_logcat "$T0" "$P-logcat.txt"
  local nf; info "net disable flags of display 0 (SystemUI's log: the row is empty while 0x03600000 is set):"
  nf=$(PYAN netflags "$P-logcat.txt" "$P-statusbar-before.txt" "$T0" "$(printf '%s' "$an" | kv T_DEATH_MS)"); printf '%s\n' "$nf" | tee -a "$LOG" | sed 's/^/      /'
  [ "$(printf '%s' "$nf" | kv RESULT)" = PASS ] && ok "net flags: $(printf '%s' "$nf" | kv WHY)" || no "net flags: $(printf '%s' "$nf" | kv WHY)"
  info "history window (the dump's own disable history, when this Android build has one):"
  hr=$(PYAN hist "$P-statusbar-after.txt" "$MK" "$CL_S" "$CL_L" order "$(printf '%s' "$an" | kv T_DEATH_MS)"); printf '%s\n' "$hr" | tee -a "$LOG" | sed 's/^/      /'
  if [ "$(printf '%s' "$hr" | kv NOROWS)" = 1 ]; then info "this Android build's dumpsys statusbar has NO disable history (only mDisableRecords): the sampler and the net-flag log above decide; the record tokens before / after: $(grep 'pkg=com.android.shell token' "$P-statusbar-before.txt" | sed 's/.*token=//') -> $(grep 'pkg=com.android.shell token' "$P-statusbar-after.txt" | sed 's/.*token=//')"
  elif [ "$(printf '%s' "$hr" | kv RESULT)" = PASS ]; then ok "history: $(printf '%s' "$hr" | kv WHY)"; else no "history: $(printf '%s' "$hr" | kv WHY)"; fi
  info "log events (offset from the old app pid disappearing):"
  lg=$(PYAN logs "$P-logcat.txt" "$(printf '%s' "$an" | kv T_DEATH_MS | grep . || echo 0)"); printf '%s\n' "$lg" | grep -v '_S=' | head -90 | tee -a "$LOG" | sed 's/^/      /'
  local dth; dth=$(printf '%s' "$an" | kv T_DEATH_MS)
  rawlines "main-thread / GC lines of the new app pid ${napp:-?} in the window (Choreographer skipped frames, Slow dispatch / delivery, ANR, GC; offsets from the old app pid disappearing)" "$(awk -v d="${dth:-0}" -v p="${napp:-0}" '$2==p && /Choreographer|Slow (dispatch|delivery)|ANR in|am_anr|Davey|Skipped [0-9]+ frames|GC|concurrent mark/ { $1=sprintf("%+.2f", $1-d/1000); print }' "$P-logcat.txt" | cut -c1-260 | head -30)"
  # silent route + no installer UI + no file left behind
  local pr pn pa route
  pr=$(L update proof $(( $(date +%s) - TH + 90 )) 2>&1); printf '%s\n' "$pr" > "$P-proof.txt"
  pa=$(printf '%s\n' "$pr" | sed -n 's/.*"packageinstallerActivities": *\([0-9]*\).*/\1/p' | head -1)
  pn=$(printf '%s\n' "$pr" | sed -n 's/.*"packageinstallerNotifications": *\([0-9]*\).*/\1/p' | head -1)
  rawlines "ApkInstall" "$(printf '%s\n' "$pr" | grep 'ApkInstall' | cut -c1-260 | tail -8)"
  if printf '%s\n' "$pr" | grep -iE 'ApkInstall' | grep -qiE 'via shizuku'; then route=shizuku
  elif printf '%s\n' "$pr" | grep -iE 'ApkInstall' | grep -qiE 'via local[ -]?adb'; then route='local adb'
  else route=''; fi
  if [ -n "$route" ]; then ok "silent route: the ApkInstall log names 'via $route'"; [ "$route" = shizuku ] || info "NOTE the route was local ADB, not Shizuku: the Shizuku route was NOT the one proven here"
  else no "no ApkInstall line names 'via shizuku' or 'via local adb' (raw lines above; the match is on those two fragments)"; fi
  if [ "${pa:-x}" = 0 ] && [ "${pn:-x}" = 0 ]; then ok "no installer window or notification now: packageinstaller activities $pa, notifications $pn"
  else no "packageinstaller activities '${pa:-?}' / notifications '${pn:-?}' (both must be 0)"; fi
  local ui; ui=$(grep -iE 'START u0 .*packageinstaller|Displayed [^ ]*packageinstaller' "$P-logcat.txt" | head -5)
  if [ -z "$ui" ]; then ok "no packageinstaller activity was started during the window (logcat)"; else no "a packageinstaller activity was started during the window"; rawlines installer-ui "$ui"; fi
  local dsn; dsn=$(ds_install_left)
  [ "$dsn" = 0 ] && ok "no /data/local/tmp/ds-install-* file is left" || no "$dsn ds-install file(s) left in /data/local/tmp: $(G 'ls -la /data/local/tmp | grep ds-install' | head -3 | tr '\n' ' ')"
  rawlines "apk files after" "$(apk_files)"
  a11y_check
  info "melaton_navblank.out now: $(gh state | tail -1 | sed -n 's/.*out=\[\(.*\)\] vc=.*/\1/p')"
  # ---- the numbers
  local death newrow oldgone applink grace
  death=$(printf '%s' "$an" | kv T_DEATH_MS)
  newrow=$(printf '%s' "$hr" | kv BACK_FIRST_MS); oldgone=$(printf '%s' "$an" | kv OLD_GONE_S)
  applink=$(printf '%s' "$lg" | kv LINK_S)
  info "NUMBERS (relative to the old app pid $appb disappearing at device ms ${death:-?}; sampler period ~$(printf '%s' "$an" | kv PERIOD_MEDIAN_MS) ms):"
  info "  new app process visible in the samples: $(sgn "$(printf '%s' "$an" | kv APP_BACK_S)"); log 'Start proc': $(sgn "$(printf '%s' "$lg" | kv START_S)"); log 'Killing / Force stopping': $(sgn "$(printf '%s' "$lg" | kv KILL_S)") (negative = before the sampler saw the pid go)"
  local rowsrc='history row' rowms=$newrow
  if [ -z "$rowms" ] && [ -n "$applink" ] && [ -n "$death" ]; then rowms=$(awk -v a="$death" -v l="$applink" 'BEGIN{printf "%d", a + l*1000}'); rowsrc="app log 'holder token linked' (the row is set a few ms before it; this Android build has no disable history)"; fi
  if [ -n "$death" ] && [ -n "$rowms" ]; then
    grace=$(awk -v a="$death" -v b="$rowms" 'BEGIN{printf "%.1f", (b-a)/1000}')
    info "  new holder's token / row ($rowsrc): +$grace s -> $(awk -v g="$grace" -v m="$GRACE_S" 'BEGIN{printf "%.0f", 100*g/m}') % of the ${GRACE_S} s grace used"
    info "  the new holder's OK came $(awk -v g="$grace" -v m="$GRACE_S" 'BEGIN{printf "%.1f", m-g}') s before the old holder's grace would have ended (old app pid gone + ${GRACE_S} s); negative = after"
    awk -v g="$grace" -v m="$GRACE_S" 'BEGIN{exit !(g>m)}' && info "  FINDING the new holder's row came AFTER the old holder's ${GRACE_S} s grace: a CLEAR at about +${GRACE_S} s is expected before it (the history verdict above)"
  else info "  new holder's row time: not available (no history row and no 'holder token linked' line)"; fi
  if [ -n "${hst:-}" ] && [ -n "$death" ]; then info "  new holder's process started (/proc/$nhnew, device clock '$hst'): $(awk -v e="$(date -d "$hst" +%s.%N 2>/dev/null)" -v d="$death" 'BEGIN{ if (e=="") printf "n/a"; else printf "%+.1f s", e*1000/1000 - d/1000 }') after the old app pid disappeared (its shell command began about then; the answer 'holder token linked' came at $(sgn "$applink"))"; fi
  info "  shell command / Shizuku route log lines of the window (begin / connect / answer, as logged): $P-logcat.txt (the SHIZUKU / SHELLPROC / EXIT / LINK events are printed above)"
  info "  new holder's token linked (app log): $(sgn "$applink"); new holder pid in the samples: $(sgn "$(printf '%s' "$an" | kv NEW_PID_S)"); old holder gone from the samples: $(sgn "$oldgone") (killed by the new holder after its OK, or by its own grace at +${GRACE_S} s)"
  info "  overlap (two holder pids alive): $(na "$(printf '%s' "$an" | kv OVERLAP_SAMPLES)") samples, $(na "$(printf '%s' "$an" | kv OVERLAP_SPAN_S)") s; net flags: $(printf '%s' "$nf" | kv WHY)"
  if [ "$off" = 1 ]; then
    info "SCREEN-OFF extras: the new process started $(sgn "$(printf '%s' "$lg" | kv START_S)") (log) / $(sgn "$(printf '%s' "$an" | kv APP_BACK_S)") (samples) after the old one died; the old holder's grace $(awk -v g="${grace:-0}" -v m="$GRACE_S" 'BEGIN{print (g>m)?"RAN OUT before the new holder held (finding)":"did not run out"}')"
  else shot after; fi
}

# ------------------------------------------------------------------ crash / unbound-start (display on, release 36 or later)
obs_loop() { # obs_loop <secs> <file> : one guest observation about every second
  local end=$(( SECONDS + $1 )); : > "$2"
  while [ "$SECONDS" -lt "$end" ]; do gh obs | tail -1 >> "$2"; sleep 0.3; done
}
baseline_now() { # prints "mode=.. overlay=.. holder=.. recs=.. bound=.." and returns 0 when it equals the baseline (mode 0, three-button overlay, held, bound)
  local o m ov
  o=$(gh obs | tail -1); m=$(G 'settings get secure navigation_mode' | tail -1)
  ov=$(printf '%s' "$o" | field ovl)
  echo "mode=$m overlay=$ov $(printf '%s' "$o" | sed 's/^ms=[0-9]* //')"
  [ "$m" = 0 ] && [ "$ov" = 'threebutton,' ] && is_held "$(printf '%s' "$o" | sed 's/^ms=[0-9]* //')" && [ "$(printf '%s' "$o" | field bound)" = 1 ]
}
crash_pre() { # common preconditions; sets BASE_Q, APPB, HOLDB
  preflight; ensure_guest; require_held
  [ "${ST[screen]:-}" = Awake ] || { info "the display was ${ST[screen]:-?}: switching it on"; L screen on >/dev/null 2>&1; sleep 2; }
  BASE_Q=$(gh state | tail -1); APPB=$(printf '%s' "$BASE_Q" | field app); HOLDB=$(printf '%s' "$BASE_Q" | field holder)
  { [[ $APPB =~ ^[0-9]+$ ]] && [[ $HOLDB =~ ^[0-9]+$ ]]; } || refuse "no single app pid / holder pid before the test (app=$APPB holder=$HOLDB)"
  gh a11y | grep 'Bound services' | grep -qiE 'Melaton' || refuse "the Bars service is not bound before the test: nothing to compare with"
  info "baseline before: $BASE_Q"
}
step_crash() {
  crash_pre
  local o an nf lg T0 TH kout kp tb
  dump_statusbar "$P-statusbar-before.txt"
  sampler_start light
  clock; T0=$CLK_MS; TH=$(date +%s)
  kout=$(LTO=60 L kill-app 2>&1 | tail -1); say "kill-app: $kout"
  kp=$(printf '%s' "$kout" | PYAN json killedPid | kv killedPid)
  [ "$kp" = "$APPB" ] && ok "kill -9 hit the app's MAIN pid $APPB (the pid the lane found with pidof)" || no "kill-app killed pid '${kp:-?}', not the main pid $APPB: $kout"
  obs_loop 150 "$P-obs.txt"
  sampler_collect; dump_statusbar "$P-statusbar-after.txt"
  an=$(PYAN sample "$P-sample.txt" "$APPB" "$T0" "$HOLDB"); printf '%s\n' "$an" | tee -a "$LOG" | sed 's/^/      /'
  local td; td=$(printf '%s' "$an" | kv T_DEATH_MS)
  [ -n "$td" ] || { no "the old app pid never disappeared in the samples"; return; }
  [ "$(printf '%s' "$an" | kv APP_BACK_S)" ] && ok "the system restarted the app $(sgn "$(printf '%s' "$an" | kv APP_BACK_S)") after the kill (new pid in the samples)" || no "the app was not restarted by the system within the window"
  info "observations (guest, about 1 s):"
  o=$(PYAN obs "$P-obs.txt" "$td" "$APPB"); printf '%s\n' "$o" | tee -a "$LOG" | sed 's/^/      /'
  tb=$(printf '%s' "$o" | kv BOUND_AGAIN_MS)
  pull_logcat "$T0" "$P-logcat.txt"
  info "net disable flags of display 0 (SystemUI's log), the judge:"
  nf=$(PYAN netflags "$P-logcat.txt" "$P-statusbar-before.txt" "$T0" "$td" "${tb:--}"); printf '%s\n' "$nf" | tee -a "$LOG" | sed 's/^/      /'
  if [ "$(printf '%s' "$nf" | kv RESULT)" = PASS ]; then ok "net flags: $(printf '%s' "$nf" | kv WHY)"
  else no "net flags: $(printf '%s' "$nf" | kv WHY); with NO Melaton bar drawn (old process gone until the Bars service is bound again): $(na "$(printf '%s' "$nf" | kv ROW_EMPTY_NO_BAR_S)") s"; fi
  lg=$(PYAN logs "$P-logcat.txt" "$td"); printf '%s\n' "$lg" | grep -v '_S=' | grep -vE 'LOG (SHIZUKU|INSTALL)' | head -70 | tee -a "$LOG" | sed 's/^/      /'
  rawlines "BarsHeal / BarsServiceWatch / service lines" "$(grep -E 'Bars(Heal|ServiceWatch)|Bars[A-Z][A-Za-z]+ *:|[Ss]ervice dropped|AccessibilityManagerService' "$P-logcat.txt" | cut -c1-260 | head -30)"
  info "TIMES (relative to the old app pid disappearing at device ms $td): system restarted the process: $(sgn "$(printf '%s' "$lg" | kv START_S)") (log), early hold: $(sgn "$(printf '%s' "$lg" | kv EARLY_S)"), Shizuku binder: $(sgn "$(printf '%s' "$lg" | kv BINDER_S)"), holder token linked: $(sgn "$(printf '%s' "$lg" | kv LINK_S)"), old holder gone: $(sgn "$(printf '%s' "$an" | kv OLD_GONE_S)"), its own grace exit line: $(sgn "$(printf '%s' "$lg" | kv EXIT_S)")"
  info "old holder: $(awk -v g="$(printf '%s' "$an" | kv OLD_GONE_S)" -v l="$(printf '%s' "$lg" | kv LINK_S)" -v m="$GRACE_S" 'BEGIN{ if (g=="") print "still alive"; else if (l!="" && g-l<3 && g>=l) print "replaced: gone " g-l " s after the new holder linked (before its " m " s grace)"; else print "left at +" g " s (its grace is " m " s)" }')"
  info "Bars service: unbound $(sgn "$(printf '%s' "$o" | kv UNBOUND_S)"), bound again $(sgn "$(printf '%s' "$o" | kv BOUND_AGAIN_S)") (observation resolution about 1-2 s)"
  # fallback only if the service did not come back within 30 s
  local ba; ba=$(printf '%s' "$o" | kv BOUND_AGAIN_S)
  if grep -q 'gesture fallback on' "$P-logcat.txt"; then
    if [ -n "$ba" ] && awk -v b="$ba" 'BEGIN{exit !(b<=30)}'; then no "'gesture fallback on' appeared although the service was bound again at +$ba s (<= 30 s)"; else info "'gesture fallback on' appeared and the service came back after 30 s (or never): expected"; fi
  else ok "no 'gesture fallback on' line in the window"; fi
  # the end state
  local fin; fin=$(baseline_now) && ok "end state equals the baseline: $fin" || no "end state differs from the baseline (mode 0, threebutton, held, bound): $fin"
}
step_unbound() {
  crash_pre
  local saved en newv pkgsvc o an nf lg td T0 TH kout i
  pkgsvc="$PKG/$PKG.MelatonBarService"
  saved=$(G 'settings get secure enabled_accessibility_services' | tail -1); en=$(G 'settings get secure accessibility_enabled' | tail -1)
  [[ $saved =~ ^[A-Za-z0-9_./:\$-]+$ ]] || refuse "enabled_accessibility_services has a value I will not rewrite blindly: '$saved'"
  case ":$saved:" in *":$pkgsvc:"*) ;; *) refuse "the Bars service ($pkgsvc) is not in enabled_accessibility_services ('$saved'): nothing to take out";; esac
  printf 'enabled_accessibility_services=%s\naccessibility_enabled=%s\n' "$saved" "$en" > "$P-saved-settings.txt"
  info "saved EXACTLY: enabled_accessibility_services='$saved' accessibility_enabled='$en' (file $P-saved-settings.txt)"
  A11Y_SAVED=$saved; A11Y_EN_SAVED=$en
  newv=$(printf '%s' "$saved" | tr ':' '\n' | grep -vxF "$pkgsvc" | paste -sd: -)
  dump_statusbar "$P-statusbar-before.txt"
  sampler_start light
  clock; T0=$CLK_MS; TH=$(date +%s)
  A11Y_MODIFIED=1
  # one root call: the setting without the service, then the main pid killed (the old process cannot heal in between)
  kout=$(GR "settings put secure enabled_accessibility_services '$newv'; kill -9 $APPB; echo done" | tail -1); say "setting without the service + kill -9 $APPB: $kout (new value '${newv:-<empty>}')"
  [ "$kout" = "done" ] || no "the root call did not answer done: $kout"
  obs_loop 80 "$P-obs.txt"
  sampler_collect; dump_statusbar "$P-statusbar-after.txt"
  an=$(PYAN sample "$P-sample.txt" "$APPB" "$T0" "$HOLDB"); printf '%s\n' "$an" | tee -a "$LOG" | sed 's/^/      /'
  td=$(printf '%s' "$an" | kv T_DEATH_MS)
  if [ -z "$td" ]; then no "the old app pid never disappeared in the samples"; restore_a11y; return; fi
  o=$(PYAN obs "$P-obs.txt" "$td" "$APPB"); printf '%s\n' "$o" | tee -a "$LOG" | sed 's/^/      /'
  pull_logcat "$T0" "$P-logcat.txt"
  nf=$(PYAN netflags "$P-logcat.txt" "$P-statusbar-before.txt" "$T0" "$td"); info "net disable flags of display 0 (SystemUI's log):"; printf '%s\n' "$nf" | tee -a "$LOG" | sed 's/^/      /'
  lg=$(PYAN logs "$P-logcat.txt" "$td"); printf '%s\n' "$lg" | grep -v '_S=' | grep -vE 'LOG (SHIZUKU|INSTALL)' | head -70 | tee -a "$LOG" | sed 's/^/      /'
  rawlines "service / fallback lines" "$(grep -E 'gesture|[Ss]ervice dropped|not bound|unbound|not enabled|Bars(Heal|ServiceWatch)|Bars[A-Z][A-Za-z]+ *:|early hold|AccessibilityManagerService' "$P-logcat.txt" | cut -c1-280 | head -30)"
  local es el sb oc hn ba
  es=$(printf '%s' "$lg" | kv EARLY_S); el=$(printf '%s' "$lg" | kv GESTURE_S); sb=$(printf '%s' "$o" | kv SETTING_BACK_S); oc=$(printf '%s' "$o" | kv OVERLAY_CHANGED_S); hn=$(printf '%s' "$o" | kv HOLDER_NONE_S); ba=$(printf '%s' "$o" | kv BOUND_AGAIN_S)
  info "TIMES (relative to the old app pid disappearing): process start $(sgn "$(printf '%s' "$lg" | kv START_S)"), early hold $(sgn "$es"), gesture fallback line $(sgn "$el"), setting put back by the app $(sgn "$sb"), service bound again $(sgn "$ba"), overlay changed $(sgn "$oc") to '$(printf '%s' "$o" | kv OVERLAY_NOW)', holder gone $(sgn "$hn")"
  [ -n "$es" ] && ok "early hold at process start was reached at $(sgn "$es")" || no "no 'early hold at process start' line in the window"
  if grep -q 'gesture fallback on' "$P-logcat.txt"; then
    ok "OUTCOME A (the fallback): 'gesture fallback on' at $(sgn "$el") after the old pid died"
    [ -n "$oc" ] && ok "the navbar overlay became '$(printf '%s' "$o" | kv OVERLAY_NOW)' at $(sgn "$oc")" || no "the navbar overlay never changed in the observations"
    local lastobs; lastobs=$(printf '%s' "$o" | sed -n 's/^LAST //p')
    if [ "$(printf '%s' "$lastobs" | field holder)" = - ] && [ "$(printf '%s' "$lastobs" | field records)" = 0 ]; then ok "no holder process and no shell disable record remain: $lastobs"; else no "a holder or a record remains after the fallback: $lastobs"; fi
    # the row may be given back only AFTER the gestures were switched on
    local fd; fd=$(printf '%s' "$nf" | kv NET_GAP_FIRST_S)
    if [ -z "$fd" ]; then info "the net flags never dropped the row (the holder and its flags stayed?)"; elif awk -v f="$fd" -v g="${el:-9999}" 'BEGIN{exit !(f >= g - 2)}'; then ok "the row was given back at $(sgn "$fd"), not before the fallback line ($(sgn "$el")): the early hold kept it until then"; else no "the row was given back at $(sgn "$fd"), BEFORE the fallback line ($(sgn "$el"))"; fi
  elif [ -n "$sb" ]; then
    ok "OUTCOME B (the heal): the app put the service back into enabled_accessibility_services at $(sgn "$sb"); bound again $(sgn "$ba"); no 'gesture fallback on' line"
    [ "$(printf '%s' "$nf" | kv RESULT)" = PASS ] && ok "net flags: $(printf '%s' "$nf" | kv WHY)" || info "net flags: $(printf '%s' "$nf" | kv WHY)"
  else
    no "neither the fallback nor the heal happened within 80 s of the kill (see the observations and log lines above)"
  fi
  # ---- RESTORE
  info "RESTORE: putting the saved enabled_accessibility_services back exactly"
  restore_a11y
  local now; now=$(G 'settings get secure enabled_accessibility_services' | tail -1)
  [ "$now" = "$saved" ] && ok "enabled_accessibility_services is back to exactly '$saved'" || no "enabled_accessibility_services is '$now', saved was '$saved'"
  local waitb=0
  for i in $(seq 1 30); do gh a11y | grep 'Bound services' | grep -qiE 'Melaton' && { waitb=1; break; }; sleep 2; done
  [ "$waitb" = 1 ] && ok "the Bars service is bound again (within $(( i * 2 )) s of the restore)" || no "the Bars service did not bind again within 60 s of the restore"
  # the app's own way back runs on an event 60 s or more after the switch: wait, then screen off / on (the lane's own way on an emulator)
  local sw fin
  fin=$(baseline_now) && ok "FINAL state equals the baseline already after the restore: $fin" || {
    sw=$(grep 'gesture fallback on' "$P-logcat.txt" | head -1 | awk '{printf "%d", $1*1000}')
    if [ -n "$sw" ]; then info "waiting until 65 s after the fallback switch before the screen event"; while [ "$(gh clock | tail -1 | cut -d' ' -f1)" -lt $(( sw + 65000 )) ]; do sleep 2; done; fi
    info "screen off / on via the lane (the event for the app's way back)"
    L screen off >/dev/null 2>&1; sleep 3; L screen on >/dev/null 2>&1; sleep 2
    for i in $(seq 1 45); do fin=$(baseline_now) && break; sleep 2; done
    if fin=$(baseline_now); then ok "FINAL state equals the baseline after the screen off / on: $fin"; else
      info "the room did not come back after the screen off / on ($fin): one app restart (lane.sh kill-app) so the new process starts with the service enabled"
      L kill-app >/dev/null 2>&1
      for i in $(seq 1 60); do fin=$(baseline_now) && break; sleep 2; done
      if fin=$(baseline_now); then ok "FINAL state equals the baseline after one app restart: $fin"; else no "FINAL state differs from the baseline: $fin (baseline: mode 0, overlay threebutton, held, bound)"; fi
    fi
  }
}

# ------------------------------------------------------------------ idle (D14)
step_idle() {
  local pre hold0 mark_s mark_ms out0 mt0 sn0 sn1 end i n wl_samples=0 lines hl
  preflight; ensure_guest; require_held
  pre=$(quick); hold0=$(printf '%s' "$pre" | field holder)
  sn0=$(gh snap full); rawlines snap-start "$sn0"
  mt0=$(printf '%s' "$sn0" | sed -n 's/.*outmt=\([0-9]*\).*/\1/p' | head -1)
  if [ "$IDLE_OFF" = 1 ]; then L screen off >/dev/null 2>&1; SCREEN_OFF_BY_ME=1; info "display off"; fi
  clock; mark_ms=$CLK_MS; mark_s=$(( CLK_MS / 1000 ))
  info "idle for $IDLE_SECS s from device ms $mark_ms: reads only, every 15 s"
  end=$(( SECONDS + IDLE_SECS )); n=0
  while [ "$SECONDS" -lt "$end" ]; do
    sleep $(( end - SECONDS < 15 ? end - SECONDS : 15 ))
    out0=$(gh snap); n=$((n + 1))
    printf '%s\n' "$out0" >> "$P-snaps.txt"
    if printf '%s' "$out0" | grep -q '^WL:'; then wl_samples=$((wl_samples + 1)); rawlines wake-lock "$(printf '%s\n' "$out0" | grep '^WL:')"; fi
  done
  sn1=$(gh snap full); rawlines snap-end "$sn1"
  [ "$IDLE_OFF" = 1 ] && { L screen on >/dev/null 2>&1; SCREEN_OFF_BY_ME=0; info "display on again"; }
  lines=$(G 'logcat -d -v epoch -b main -b system -b crash' | awk -v f="$mark_s" '{ t=$1+0; if (t >= f) print }' | grep -E 'MelatonBars' | cut -c1-260)
  printf '%s\n' "$lines" > "$P-melatonbars.txt"
  rawlines "MelatonBars" "$lines"
  hl=$(printf '%s\n' "$lines" | grep -ciE 'holder|hold |holding|retry|shell|route|fallback|nolink|died|navblank|binder')
  [ "$hl" = 0 ] && ok "no holder-related MelatonBars log line in $IDLE_SECS s (all MelatonBars lines are printed above)" || no "$hl holder-related MelatonBars log line(s) in $IDLE_SECS s (shell holder start / retry / fallback / death): see above"
  local h1; h1=$(quick | field holder)
  [ "$h1" = "$hold0" ] && ok "the holder pid is unchanged ($hold0): no new shell holder start" || no "the holder pid changed ($hold0 -> ${h1:--})"
  local mt1; mt1=$(printf '%s' "$sn1" | sed -n 's/.*outmt=\([0-9]*\).*/\1/p' | head -1)
  [ "$mt0" = "$mt1" ] && ok "melaton_navblank.out untouched (mtime $mt0)" || no "melaton_navblank.out was rewritten (mtime $mt0 -> $mt1): a holder start happened"
  [ "$wl_samples" = 0 ] && ok "no wake lock naming the app (uid / package) in $n samples of dumpsys power" || no "a wake lock of the app showed in $wl_samples of $n samples (lines above)"
  info "alarms naming the package (dumpsys alarm): $(printf '%s' "$sn0" | sed -n 's/^alarms=//p') -> $(printf '%s' "$sn1" | sed -n 's/^alarms=//p') (D14 wants no new alarm; informational here)"
  info "holder voluntary_ctxt_switches: $(printf '%s' "$sn0" | sed -n 's/.* vcs=\([0-9]*\).*/\1/p' | head -1) -> $(printf '%s' "$sn1" | sed -n 's/.* vcs=\([0-9]*\).*/\1/p' | head -1) (informational)"
}

# ------------------------------------------------------------------ end
step_end() {
  local out
  out=$(timeout 240 "$LANE" --agent "$AGENT" "$ID" status 2>/dev/null)
  if [ "$(printf '%s' "$out" | PYAN json running | kv running)" != true ]; then say "$ID is not running: nothing on the guest to remove"; return; fi
  ensure_guest
  L sh "sh $GH sampler-stop" >/dev/null 2>&1; sleep 1
  local fin; fin=$(gh state | tail -1)
  L sh "rm -f $GS /data/local/tmp/bars1371-sampler.pid $GH" >/dev/null 2>&1
  say "removed from the guest: the sampler file, its pid file and the guest helper"
  say "final: $fin"
  say "the instance $ID keeps running for its lease holder (release it with coord_device_release)"
}

# ------------------------------------------------------------------ run
say "=== $STEP ${ARGS[*]:-} on $ID (agent ${AGENT:-?}) evidence $EV ==="
case "$STEP" in
  baseline) step_baseline;;
  install) step_install;;
  adbd) step_adbd;;
  self-update) step_selfupdate "${ARGS[0]}" "${ARGS[1]}" 0;;
  self-update-screen-off) step_selfupdate "${ARGS[0]}" "${ARGS[1]}" 1;;
  idle) step_idle;;
  crash) step_crash;;
  unbound-start) step_unbound;;
  end) step_end;;
esac
if [ "$FAILS" = 0 ]; then [ "$SKIPPED" = 1 ] && say "RESULT $STEP: SKIPPED (nothing was run, see above)" || say "RESULT $STEP: PASS (no failed check)"; exit 0; fi
say "RESULT $STEP: FAIL ($FAILS failed check(s))"
exit 1
