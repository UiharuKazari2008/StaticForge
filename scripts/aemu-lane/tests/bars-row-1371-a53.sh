#!/bin/bash
# bars-row-1371-a53.sh - device proof on the A53 for StaticForge #1371 / #1331 (DSApp branch tmp/1331-bars-heal-3).
#
# What is proven: Melaton Bars keeps Android's Back/Home/Recents row empty under its own soft key bar with a shell
# holder process (melaton_navblank) that holds a status bar disable token. The fix changes three things:
#   1. an app update over a running fixed build shows NO Android buttons (the new process starts a new holder first,
#      kills the old one only after the new one answered OK; the old holder lives GRACE_MS after its app died)
#   2. the re-hold after the holder dies still works (adbd restart, holder killed)
#   3. failure paths: 3 failed holder starts -> no-hint gesture navigation (never visible buttons), no flip back within
#      the next 60 s, the way back on an event 60 s or more later with the hold taken BEFORE the overlay switches;
#      5 quick holder deaths in a row give up the holds and fall back
#
# The truth of "are Android's buttons hidden" is `dumpsys statusbar`: a record `pkg=com.android.shell token` (what1
# 0x03600000) while held. A screenshot cannot prove it (the app's own bar covers the row); screenshots are illustrations.
#
# usage: A53_AGENT=<agent that HOLDS the a53 lease> bars-row-1371-a53.sh [--only P0,S1,..] [--dry-run] \
#            <release.apk> <its versionCode> [outdir]
#   outdir defaults to docs/testing/evidence/1371/a53 of this checkout. A53_DEV (default 192.168.100.236:5555) is the
#   phone's adb address; the script REFUSES to run unless getprop ro.product.model starts with SM-A53 and never
#   addresses any other serial (the Fold, SM-F966U, 192.168.100.225, is refused by name too).
#
# Steps (each logs PASS / FAIL / INCONCLUSIVE / SKIP with the measured numbers to <outdir>/log.txt):
#   P0  preconditions (always runs): model, awake + unlocked, navigation_mode 0 + 3-button overlay, row held, baseline
#   S1  first install (old build -> fixed build; a gap is EXPECTED, baseline). PASS: versionCode == arg, held within 60 s,
#       the answer file is exactly OK (not "OK nolink"), `holder token linked` seen. Skipped when the phone already runs it.
#   S2  update over the fixed build (adb install -r of the same apk; D4). PASS only if: the sampler never shows recs=0, a
#       new holder/token appears (two holders alive at some sample, or a handover with recs never 0), the history has no
#       CLEAR followed by a BACK row (and the new BACK is before the old CLEAR, when CLEAR rows exist), the app is back,
#       MelatonBarService bound, not in `Crashed services`, old holder gone within 30 s. Reports the old-app-gone ->
#       new-row time against GRACE_S and whether Samsung keeps one record per token.
#   S3  adbd restart (adb tcpip 5555). PASS: held again by a new holder within 10 s (phone clock).
#   S4  holder killed once. PASS: held again by a new holder within 20 s (the gap is reported).
#   S5  am crash <the app's main pid> once (D6; `am crash <pkg>` can hit a WebView sandbox process instead), sampler on. PASS: app back, service bound, not crashed, row held again, the old holder
#       gone no later than GRACE_S + 3 s after the app pid disappeared. recs=0 time is reported (not a failure by itself).
#   S6  failed starts -> fallback (D8): the answer file made a directory, holder killed. PASS: `#3 in a row` and
#       `gesture fallback on` within 90 s, no-hint gesture overlay enabled, navigation_mode 2 or 3 (3 on the A53), no shell record and no
#       holder, and NO flip back (log line, overlay, mode) during the next 55 s (review fix S2).
#   S7  the way back (D9): an event 65 s or more after the fallback began. PASS: `gesture fallback off`, 3-button overlay
#       enabled, navigation_mode 0, row held, and the hold was taken before the overlay change (the `holder token
#       linked` line and the history BACK row are not later than the `gesture fallback off` line).
#   S8  death loop (D11): holder killed 5 times, each as soon as a new one holds. PASS: `#5 in a row` + `giving up the
#       holds` + `gesture fallback on`, gestures on with no hold; then restored as in S7 and the room is back.
#   END always (also after FAIL / interruption / STOP): removes the answer-file directory and the sampler file, restores
#       the room when a step left the fallback on, prints the final state and the differences from the baseline.
#
# --only S1,S2   run only these steps (P0 and END always run); S7 needs a fallback to be on (after S6/S8 in the same run)
# --dry-run      print the plan; run only the model check and `st` (read-only getprop / dumpsys), change nothing
#
# Never: KEYCODE_SLEEP / KEYCODE_POWER, pm clear, uninstall, am force-stop of the app (it disables its accessibility
# service), more than the two installs S1 and S2 name (marker files in the outdir stop a repeat; delete one by hand to
# allow another), any sound or notice, any tap on the soft key bar, any other serial.
#
# Tunables (env): A53_DEV, A53_ADB, A53_SH, GRACE_S (10), BACK_GAP_S (65), CRASH_COOLDOWN_S (150), HOLDER_AGE_S (65),
#   A53_S7_UIMODE (default 1; 0 = off): the second way-back trigger when the display cannot be turned off without SLEEP/POWER:
#   night mode toggled and restored (a configuration change); the third is the notification shade expanded and collapsed
set -u

SELF=$(readlink -f "${BASH_SOURCE[0]}")
REPO=$(cd "$(dirname "$SELF")/../../.." && pwd)
PKG=jp.net.seventhreeseven.dreamscape
HOLDER=melaton_navblank
OUTFILE=/data/local/tmp/melaton_navblank.out
SF=/data/local/tmp/bars1371-sample.txt
SSTOP=/data/local/tmp/bars1371-sample.stop
GRACE_S=${GRACE_S:-10}
BACK_GAP_S=${BACK_GAP_S:-65}
COOLDOWN_S=${CRASH_COOLDOWN_S:-150}
AGE_S=${HOLDER_AGE_S:-65}
NOFLIP_S=$((BACK_GAP_S - 10))
ADB=${A53_ADB:-$HOME/.local/bin/adb}
DEV=${A53_DEV:-192.168.100.236:5555}
A53SH=${A53_SH:-$REPO/scripts/aemu-lane/a53/a53.sh}
SCRIPTNAME=$(basename "$SELF")

usage() { sed -n '2,/^set -u/p' "$SELF" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ------------------------------------------------------------------------------------------------ arguments
ONLY=""; DRY=0; POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --only) [ $# -ge 2 ] || { echo "--only needs a step list" >&2; exit 2; }; ONLY=$2; shift 2 ;;
    --only=*) ONLY=${1#--only=}; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; while [ $# -gt 0 ]; do POS+=("$1"); shift; done ;;
    -*) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done
APK=${POS[0]:-}; VC=${POS[1]:-}; OUT=${POS[2]:-$REPO/docs/testing/evidence/1371/a53}
ONLY=$(printf '%s' "$ONLY" | tr 'a-z' 'A-Z' | tr -d ' ')
if [ -n "$ONLY" ]; then
  _ifs=$IFS; IFS=,
  for _s in $ONLY; do
    case "$_s" in P0|S1|S2|S3|S4|S5|S6|S7|S8|END) ;; *) echo "unknown step '$_s' in --only (P0 S1..S8 END)" >&2; exit 2 ;; esac
  done
  IFS=$_ifs
fi
want() { # want <step>
  case "$1" in P0|END) return 0 ;; esac
  [ -z "$ONLY" ] && return 0
  case ",$ONLY," in *",$1,"*) return 0 ;; esac
  return 1
}

# the Fold is the owner's phone: refused by name, whatever the env says
case "${DEV%%:*}" in 192.168.100.225) echo "REFUSED: $DEV is the Fold (the owner's phone), never addressed" >&2; exit 2 ;; esac
[ -x "$ADB" ] || { echo "no adb at $ADB" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is needed on the host (history / sampler analysis)" >&2; exit 2; }
if [ "$DRY" = 0 ]; then
  if want S1 || want S2; then
    [ -n "$APK" ] && [ -n "$VC" ] || { echo "usage: A53_AGENT=<agent> $SCRIPTNAME [--only ..] [--dry-run] <release.apk> <versionCode> [outdir]" >&2; exit 2; }
    [ -f "$APK" ] || { echo "no apk $APK" >&2; exit 2; }
    case "$VC" in ''|*[!0-9]*) echo "versionCode must be a number, got '$VC'" >&2; exit 2 ;; esac
  fi
  [ -n "${A53_AGENT:-}${COORD_AGENT_ID:-}" ] || [ "${A53_NO_LEASE:-}" = 1 ] || { echo "set A53_AGENT to the agent that holds the a53 lease (coord_device_request a53 first)" >&2; exit 2; }
fi

# ------------------------------------------------------------------------------------------------ phone access
# every adb call names the A53 by serial; there is no other way to reach a device in this script
A() { timeout "${ADB_T:-60}" "$ADB" -s "$DEV" "$@" </dev/null; }
S() { A shell "$@" 2>/dev/null | tr -d '\r'; }
tpl() { local s=$1; s=${s//@PKG@/$PKG}; s=${s//@HOLDER@/$HOLDER}; s=${s//@OUT@/$OUTFILE}; s=${s//@SF@/$SF}; s=${s//@STOP@/$SSTOP}; printf '%s' "$s"; }

# the model check comes before anything that changes anything, and before a log file exists
MODEL=$(timeout 25 "$ADB" -s "$DEV" shell getprop ro.product.model </dev/null 2>/dev/null | tr -d '\r')
case "$MODEL" in SM-A53*) ;; *) echo "REFUSED: $DEV answers model '${MODEL:-nothing}', not an SM-A53 (the A53 test phone). Nothing was touched." >&2; exit 2 ;; esac
MODEL_OK=1

# ------------------------------------------------------------------------------------------------ logging
if [ "$DRY" = 1 ]; then LOG=/dev/null; else mkdir -p "$OUT" || { echo "cannot create $OUT" >&2; exit 2; }; LOG=$OUT/log.txt; fi
say() { printf '[%s] %s\n' "$(date +%H:%M:%S.%3N)" "$*" | tee -a "$LOG"; }
block() { sed 's/^/        /' | cut -c1-260 | tee -a "$LOG"; }
stop() { say "STOP: $*"; exit 3; }
declare -A RES=() RESMSG=()
ORDER=()
verdict() { # verdict <step> PASS|FAIL|INCONCLUSIVE|SKIP|INFO <text>
  RES[$1]=$2; RESMSG[$1]=$3; ORDER+=("$1")
  say "$1 $2: $3"
}

# ------------------------------------------------------------------------------------------------ phone-side snippets
ST_TPL='a=$(dumpsys accessibility); echo "vc=$(dumpsys package @PKG@ | grep -m1 -o "versionCode=[0-9]*" | cut -d= -f2) mode=$(settings get secure navigation_mode) overlay=$(cmd overlay list | grep -E "\[x\].*navbar" | sed "s/.*navbar\.//" | tr "\n" ,) holder=$(pidof @HOLDER@ | tr " " ,) out=[$(cat @OUT@ 2>/dev/null | tr "\n" " ")] shellrec=$(dumpsys statusbar | grep -c "pkg=com.android.shell token") barsBound=$(echo "$a" | grep -c "id=@PKG@/.MelatonBarService") crashed=$(echo "$a" | grep "Crashed services" | grep -c MelatonBarService) app=$(pidof @PKG@ | tr " " ,)"'
PROBE_TPL='p=$(pidof @HOLDER@ | tr " " ,); t=$(dumpsys statusbar | grep "pkg=com.android.shell token" | sed "s/.*@//" | tr "\n" ,); a=$(pidof @PKG@ | tr " " ,); echo "${p:--}|${t:--}|${a:--}"'
A11Y_TPL='a=$(dumpsys accessibility); echo "bound=$(echo "$a" | grep -c "id=@PKG@/.MelatonBarService") crashed=$(echo "$a" | grep "Crashed services" | grep -c MelatonBarService)"'
SAMP_TPL='i=0; while [ ! -e @STOP@ ] && [ $i -lt 2400 ]; do i=$((i+1)); t=$(date +%s%3N); l=$(dumpsys statusbar | grep "pkg=com.android.shell token"); if [ -n "$l" ]; then r=$(echo "$l" | grep -c .); k=$(echo "$l" | sed "s/.*@//" | tr "\n" ,); else r=0; k=-; fi; p=$(pidof @HOLDER@ | tr " " ,); a=$(pidof @PKG@ | tr " " ,); echo "$t recs=$r pids=${p:--} app=${a:--} toks=$k" >> @SF@; sleep 0.2; done'
AGE_TPL='p=$(pidof @HOLDER@ | cut -d" " -f1); [ -n "$p" ] && ps -p $p -o ETIME='

st() { S "$(tpl "$ST_TPL")"; }
ST=""
stf() { # stf <field>: a field of $ST
  case "$1" in
    out) printf '%s\n' "$ST" | sed -n 's/.* out=\[\(.*\)\] shellrec=.*/\1/p' | sed 's/ *$//' ;;
    overlay) printf ' %s\n' "$ST" | sed -n "s/.* overlay=\([^ ]*\).*/\1/p" | head -1 | sed 's/,$//' ;;
    *) printf ' %s\n' "$ST" | sed -n "s/.* $1=\([^ ]*\).*/\1/p" | head -1 ;;
  esac
}
is_held() { local r; r=$(stf shellrec); [ -n "$(stf holder)" ] && [ "${r:-0}" -ge 1 ] 2>/dev/null; }
is_room() { [ "$(stf mode)" = 0 ] && case "$(stf overlay)" in *threebutton*) true ;; *) false ;; esac; }
# Samsung's no-hint gesture overlay (sec_gestural_no_hint) reports navigation_mode 3 on the A53; plain gestures are 2
is_gestures() { case "$(stf overlay)" in *gestural_no_hint*) case "$(stf mode)" in 2|3) true ;; *) false ;; esac ;; *) false ;; esac; }
fallback_active() { [ "$(stf mode)" != 0 ] || case "$(stf overlay)" in *gestural*) true ;; *) false ;; esac; }

pnow() { local i v; for i in 1 2 3; do v=$(S 'date +%s%3N'); case "$v" in ''|*[!0-9]*) sleep 0.5 ;; *) printf '%s' "$v"; return 0 ;; esac; done; printf '0'; }
jn() { local o="" x; for x in "$@"; do o="$o${o:+; }$x"; done; printf '%s' "$o"; }
relsec() { awk -v a="${1:-0}" -v b="${2:-0}" 'BEGIN { printf "%.2f", (a - b) / 1000 }'; }
fnum() { case "${1:-}" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# comma lists of pids / tokens
cminus() { local x r=""; local IFS=,; for x in $1; do case ",$2," in *",$x,"*) ;; *) [ -n "$x" ] && r="$r${r:+,}$x" ;; esac; done; printf '%s' "$r"; }
cinter() { cminus "$1" "$(cminus "$1" "$2")"; }
PP=""; PT=""; PA=""
probe() { # sets PP (holder pids) PT (record tokens) PA (app pids); returns 1 when the phone did not answer
  local o; PP=""; PT=""; PA=""
  o=$(S "$(tpl "$PROBE_TPL")"); [ -n "$o" ] || return 1
  IFS='|' read -r PP PT PA <<<"$o"
  [ "$PP" = - ] && PP=""; [ "$PT" = - ] && PT=""; [ "$PA" = - ] && PA=""
  return 0
}
a11y() { S "$(tpl "$A11Y_TPL")"; }

# log lines of the app (and, with tags, of the system) since a phone time; the phone's own logcat buffer, so an adbd restart loses nothing
LOGTAGS="MelatonBars:V NavBlankProvider:V"
logms() { # logms <since_ms> <ere without backslashes> [first|last]: phone epoch ms of the first / last matching line
  S "logcat -d -v time,epoch -s ${4:-$LOGTAGS}" | awk -v t="${1:-0}" -v pat="$2" -v w="${3:-first}" '
    $1 + 0 > 1000000000 && $1 * 1000 >= t && $0 ~ pat { v = int($1 * 1000 + 0.5); if (w == "first") { print v; exit } else last = v }
    END { if (w != "first" && last != "") print last }'
}
logq() { # logq <since_ms> <ere> [tags]: the matching lines, time relative to <since_ms>
  S "logcat -d -v time,epoch -s ${3:-$LOGTAGS}" | awk -v t="${1:-0}" -v pat="${2:-.}" '
    $1 + 0 > 1000000000 && $1 * 1000 >= t && $0 ~ pat { r = $1 - t / 1000; $1 = ""; printf "  %+.2fs%s\n", r, $0 }'
}
applog() { # applog <since_ms> [max lines]
  say "  app log since the step began (matching holder / fallback / row / giving up / not wanted lines):"
  logq "$1" 'holder|fallback|row could not|nolink|giving up|not wanted|in a row|not bound|turning it|gesture' | tail -n "${2:-30}" | block
}

# ------------------------------------------------------------------------------------------------ analysis (python3, host side)
read -r -d '' PYLIB <<'PY' || true
import sys, re, datetime

def split(v):
    return [x for x in (v or '').split(',') if x and x != '-']

def P(k, v):
    print('@%s=%s' % (k, v))

SAMP = re.compile(r'^(\d{12,14})\s+recs=(\d+)\s+pids=(\S*)\s+app=(\S*)(?:\s+toks=(\S*))?\s*$')

def load_samples(path):
    out = []
    try:
        with open(path, errors='replace') as f:
            for line in f:
                m = SAMP.match(line.strip())
                if m:
                    out.append((int(m.group(1)), int(m.group(2)), set(split(m.group(3))), set(split(m.group(4))),
                                set(t.split('@')[-1] for t in split(m.group(5)))))
    except OSError:
        pass
    return out

def cmd_samples(path, t0, oldapp, oldpids):
    t0 = int(t0 or 0)
    S = load_samples(path)
    P('n', len(S))
    if len(S) < 2:
        print('  sampler: %d usable samples (the sampler did not run)' % len(S))
        return
    rel = lambda ms: '%+.2f s' % ((ms - t0) / 1000.0)
    ts = [s[0] for s in S]
    gaps = [b - a for a, b in zip(ts, ts[1:])]
    med = sorted(gaps)[len(gaps) // 2]
    print('  sampler: %d samples, %s .. %s, one every %d ms (median), longest pause %d ms' % (len(S), rel(ts[0]), rel(ts[-1]), med, max(gaps)))
    P('median_ms', med); P('max_pause_ms', max(gaps))
    oldp = set(split(oldpids))
    base_toks = S[0][4]
    P('base_toks', ','.join(sorted(base_toks)) or '-')
    # recs=0 runs: how long Android's row was without any hold
    runs = []
    i = 0
    while i < len(S):
        if S[i][1] == 0:
            j = i
            while j + 1 < len(S) and S[j + 1][1] == 0:
                j += 1
            prev_t = S[i - 1][0] if i > 0 else S[i][0]
            next_t = S[j + 1][0] if j + 1 < len(S) else S[j][0]
            runs.append((S[i][0], S[j][0], prev_t, next_t, j + 1 >= len(S)))
            i = j + 1
        else:
            i += 1
    zero_total = sum(1 for s in S if s[1] == 0)
    P('zero_total', zero_total)
    zr = []
    for a, b, p, n, open_end in runs:
        txt = 'recs=0 from %s to %s: row without a hold for at least %.2f s, at most %.2f s%s' % (rel(a), rel(b), (b - a) / 1000.0, (n - p) / 1000.0, ' (still empty at the last sample)' if open_end else '')
        print('  ' + txt)
        zr.append('%.2f-%.2f' % ((b - a) / 1000.0, (n - p) / 1000.0))
    P('zero_runs', ';'.join(zr) if zr else '-')
    if not runs:
        print('  recs never 0 in %d samples: the row was never without a hold' % len(S))
    # app pid
    app_gone = None
    if oldapp:
        for s in S:
            if oldapp not in s[3]:
                app_gone = s[0]
                break
    app_new = None
    for s in S:
        if s[3] and oldapp not in s[3]:
            app_new = s[0]
            break
    zero_after_gone = sum(1 for s in S if s[1] == 0 and app_gone is not None and s[0] >= app_gone)
    P('app_gone_ms', app_gone if app_gone else ''); P('app_new_ms', app_new if app_new else ''); P('zero_after_gone', zero_after_gone)
    print('  old app pid %s: gone at %s; a new app pid seen at %s' % (oldapp or '-', rel(app_gone) if app_gone else 'never', rel(app_new) if app_new else 'never'))
    # holders
    new_holder = next((s[0] for s in S if (s[2] - oldp)), None)
    old_gone = next((s[0] for s in S if oldp and not (s[2] & oldp)), None)
    P('new_holder_ms', new_holder if new_holder else ''); P('old_holder_gone_ms', old_gone if old_gone else '')
    print('  old holder pid(s) %s: gone at %s; a new holder pid first seen at %s' % (','.join(sorted(oldp)) or '-', rel(old_gone) if old_gone else 'never', rel(new_holder) if new_holder else 'never'))
    over = [s for s in S if len(s[2]) >= 2]
    P('overlap_n', len(over))
    if over:
        d = {}
        for s in over:
            d[s[1]] = d.get(s[1], 0) + 1
        print('  two or more holder pids alive in %d samples (%s .. %s); records seen in those samples: %s' % (len(over), rel(over[0][0]), rel(over[-1][0]), ', '.join('%d record(s) x%d' % (k, d[k]) for k in sorted(d))))
        P('overlap_recs', ','.join(str(k) for k in sorted(d)))
        P('overlap_maxrecs', max(d))
    else:
        print('  no sample caught two holder pids at once')
        P('overlap_recs', ''); P('overlap_maxrecs', 0)
    # token rows
    new_row = next((s[0] for s in S if (s[4] - base_toks)), None)
    old_row_gone = next((s[0] for s in S if base_toks and not (s[4] & base_toks)), None)
    P('new_row_ms', new_row if new_row else ''); P('old_row_gone_ms', old_row_gone if old_row_gone else '')
    print('  record tokens: first %s; a new token first seen at %s; the old token\'s record gone at %s' % (','.join(sorted(base_toks)) or '-', rel(new_row) if new_row else 'never', rel(old_row_gone) if old_row_gone else 'never'))
    if app_gone and new_row:
        P('gone_to_newrow_s', '%.2f' % ((new_row - app_gone) / 1000.0))
        print('  old app pid gone -> new holder\'s record: %.2f s (sampler resolution about %d ms)' % ((new_row - app_gone) / 1000.0, med))
    else:
        P('gone_to_newrow_s', '')
    if app_gone and old_gone:
        P('gone_to_oldholder_s', '%.2f' % ((old_gone - app_gone) / 1000.0))
        print('  old app pid gone -> old holder exited: %.2f s' % ((old_gone - app_gone) / 1000.0))
    else:
        P('gone_to_oldholder_s', '')
    P('last_ms', ts[-1])

HRX = re.compile(r'\[(\d+)\]\s+(\d\d)-(\d\d)\s+(\d\d):(\d\d):(\d\d)\.(\d+)\s+barType=\d+\s+displayId=\d+\s+pkg=(\S+)\s+tag=(\S*)\s+userId=\d+\s+what=(.*?)\s+token=(\S+)')

def cmd_hist(path, t0, tz, year, now_ms, init_toks):
    t0 = int(t0 or 0); now_ms = int(now_ms or 0); year = int(year)
    sign = -1 if tz.startswith('-') else 1
    tzi = datetime.timezone(sign * datetime.timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5])))
    rows = []
    try:
        f = open(path, errors='replace')
    except OSError:
        f = []
    for line in f:
        m = HRX.search(line)
        if not m:
            continue
        idx, mo, d, H, Mi, Sx, fr, pkg, tag, what, tok = m.groups()
        if pkg != 'com.android.shell':
            continue
        msv = int(fr.ljust(3, '0')[:3])
        def conv(y):
            return int(datetime.datetime(y, int(mo), int(d), int(H), int(Mi), int(Sx), msv * 1000, tzinfo=tzi).timestamp() * 1000)
        e = conv(year)
        if now_ms and e > now_ms + 2 * 86400 * 1000:
            e = conv(year - 1)
        w = what.strip()
        kind = 'CLEAR' if w.upper().startswith('CLEAR') else ('BACK' if 'BACK' in w else 'OTHER')
        rows.append(dict(idx=int(idx), ms=e, tag=tag, what=w, kind=kind, tok=tok.split('@')[-1]))
    win = [r for r in rows if r['ms'] >= t0 - 1500]
    for r in win:
        print('    [%d] %+.3f s  %-5s tag=%s what=%s token=%s' % (r['idx'], (r['ms'] - t0) / 1000.0, r['kind'], r['tag'], r['what'], r['tok']))
    backs = [r for r in win if r['kind'] == 'BACK']
    clears = [r for r in win if r['kind'] == 'CLEAR']
    init = set(split(init_toks))
    active = set(init)
    gaps = []
    gap_start = None
    first_clear = None
    clear_init = None
    new_back = None
    for r in win:
        if r['kind'] == 'BACK':
            if gap_start is not None and not active:
                gaps.append((gap_start, r['ms']))
                gap_start = None
            active.add(r['tok'])
            if r['tok'] not in init and new_back is None:
                new_back = r
        elif r['kind'] == 'CLEAR':
            was = r['tok'] in active
            active.discard(r['tok'])
            if first_clear is None:
                first_clear = r
            if r['tok'] in init and clear_init is None:
                clear_init = r
            if was and not active:
                gap_start = r['ms']
    if clear_init is None:
        order = 'na'
    elif new_back is not None and new_back['ms'] <= clear_init['ms']:
        order = 'ok'
    else:
        order = 'bad'
    P('back_rows', len(backs)); P('clear_rows', len(clears))
    P('first_back_ms', new_back['ms'] if new_back else '')
    P('last_back_ms', backs[-1]['ms'] if backs else '')
    P('first_clear_ms', first_clear['ms'] if first_clear else '')
    P('order', order)
    P('gaps', ';'.join('%.3f' % ((b - a) / 1000.0) for a, b in gaps) if gaps else '-')
    P('ngaps', len(gaps))
    if not clears:
        print('    (no CLEAR row for a shell token in this window: this phone\'s history does not log a holder\'s death, only the BACK rows of new holds; the gap itself is visible only in the sampler)')
    for a, b in gaps:
        print('    CLEAR -> next BACK: the row was visible for %.3f s' % ((b - a) / 1000.0))

if __name__ == '__main__':
    c = sys.argv[1]
    if c == 'samples':
        cmd_samples(*sys.argv[2:6])
    elif c == 'hist':
        cmd_hist(*sys.argv[2:8])
PY
PYOUT=""
py() { PYOUT=$(python3 -I -c "$PYLIB" "$@" 2>&1); }
pyv() { printf '%s\n' "$PYOUT" | sed -n "s/^@$1=//p" | head -1; }
pyh() { printf '%s\n' "$PYOUT" | grep -v '^@' | block; }
PH_TZ="+0000"; PH_YEAR=$(date +%Y)

analyze_samples() { # analyze_samples <name> <t0_ms> <old app pid> <old holder pids>
  py samples "$OUT/sampler-$1.txt" "$2" "$3" "$4"
  say "  sampler analysis ($OUT/sampler-$1.txt):"; pyh
}
analyze_hist() { # analyze_hist <name> <t0_ms> <tokens that were held before>
  local f=$OUT/$1-history-shell.txt
  S 'dumpsys statusbar | grep "displayId=0 pkg=com.android.shell tag"' > "$f"
  S 'dumpsys statusbar' > "$OUT/$1-statusbar-full.txt"
  py hist "$f" "$2" "$PH_TZ" "$PH_YEAR" "$(pnow)" "${3:-}"
  say "  statusbar history rows of the shell holder since the step began (phone clock, relative to the step start):"; pyh
}

# ------------------------------------------------------------------------------------------------ sampler (phone side loop)
SAMP_PID=""
sampler_start() { # sampler_start <name>
  S "rm -f $SF $SSTOP" >/dev/null
  ( exec timeout 900 "$ADB" -s "$DEV" shell "$(tpl "$SAMP_TPL")" </dev/null >/dev/null 2>&1 ) &
  SAMP_PID=$!
  local i n=0
  for i in $(seq 1 25); do
    n=$(S "wc -l < $SF 2>/dev/null" | tr -d ' \r\n')
    [ "${n:-0}" -ge 3 ] 2>/dev/null && break
    sleep 0.4
  done
  if [ "${n:-0}" -ge 3 ] 2>/dev/null; then say "  sampler $1 on (every 0.2 s on the phone: <epoch ms> recs= pids= app= toks=)"; else say "  WARNING: the sampler did not start (lines: ${n:-none}); the sampler checks will be INCONCLUSIVE"; fi
}
sampler_stop() { # sampler_stop <name>: stop, pull to the outdir, remove from the phone
  local i
  S "touch $SSTOP" >/dev/null
  if [ -n "$SAMP_PID" ]; then
    for i in $(seq 1 40); do kill -0 "$SAMP_PID" 2>/dev/null || break; sleep 0.25; done
    kill "$SAMP_PID" 2>/dev/null; wait "$SAMP_PID" 2>/dev/null
  fi
  SAMP_PID=""
  A pull "$SF" "$OUT/sampler-$1.txt" >/dev/null 2>&1
  S "rm -f $SF $SSTOP" >/dev/null
  say "  sampler $1 off: $(wc -l < "$OUT/sampler-$1.txt" 2>/dev/null || echo 0) lines pulled to $OUT/sampler-$1.txt and removed from the phone"
}

# ------------------------------------------------------------------------------------------------ waits and actions
OLDP=""; OLDT=""; OLDA=""; T0=0
DIRTY=0          # 1 once a step has changed the phone (END restores only then)
LASTKILL=0       # host epoch of the last app-killing step (installs, am crash)
P0_OK=0
FB_START_MS=0

prep_old() { # remember what is held right now
  probe; OLDP=$PP; OLDT=$PT; OLDA=$PA; T0=$(pnow)
  say "  before: holder pid(s) [${OLDP:--}]  record token(s) [${OLDT:--}]  app pid [${OLDA:--}]  phone clock $T0 ms"
}
HELD_AT_S=""
wait_new_hold() { # wait_new_hold <limit s>: a holder pid AND a record token that were not in OLDP / OLDT
  local t0 el
  t0=$(date +%s.%N); HELD_AT_S=""
  while :; do
    el=$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1f", b - a }')
    if probe && [ -n "$(cminus "$PP" "$OLDP")" ] && [ -n "$(cminus "$PT" "$OLDT")" ]; then HELD_AT_S=$el; say "  new holder [$PP] with record token [$PT] after $el s (host clock, adb polls about every 0.5 s)"; return 0; fi
    if [ -n "${WNH_PAT:-}" ] && [ -n "$(logms "${WNH_SINCE:-0}" "$WNH_PAT" first)" ]; then say "  stopped waiting after $el s: the app log shows '$WNH_PAT'"; return 2; fi
    [ "$(awk -v e="$el" -v l="$1" 'BEGIN { print (e >= l) }')" = 1 ] && break
    sleep 0.3
  done
  say "  NOT held by a new holder after $1 s: holder [${PP:--}] tokens [${PT:--}] app [${PA:--}]"
  return 1
}
wait_old_gone() { # wait_old_gone <limit s>: none of OLDP alive any more
  local t0 el
  t0=$(date +%s.%N)
  while :; do
    el=$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1f", b - a }')
    if probe && [ -z "$(cinter "$OLDP" "$PP")" ]; then say "  old holder [$OLDP] gone after $el s; alive now [${PP:--}]"; return 0; fi
    [ "$(awk -v e="$el" -v l="$1" 'BEGIN { print (e >= l) }')" = 1 ] && break
    sleep 0.4
  done
  say "  old holder [$OLDP] STILL ALIVE after $1 s (holders now [${PP:--}])"
  return 1
}
require_ready() { # require_ready <step>: row held, room mode, no leftover answer-file directory
  local i
  for i in $(seq 1 40); do
    ST=$(st)
    if is_held && is_room && [ -z "$(S "[ -d $OUTFILE ] && echo d")" ]; then return 0; fi
    sleep 1.5
  done
  verdict "$1" SKIP "precondition: the row is not held in the 3-button room (or the answer file is a directory) after 60 s :: $ST"
  return 1
}
cooldown() { # crash-like steps (installs, am crash) at least COOLDOWN_S apart (the heal has a cooldown)
  local w
  [ "$LASTKILL" -gt 0 ] || return 0
  w=$(( LASTKILL + COOLDOWN_S - $(date +%s) ))
  if [ "$w" -gt 0 ]; then say "$1: waiting $w s (the heal's cooldown: $COOLDOWN_S s since the last step that killed the app)"; sleep "$w"; fi
  return 0
}
holder_age_s() { S "$(tpl "$AGE_TPL")" | awk 'NF { t = $1; d = 0; if (index(t, "-")) { split(t, x, "-"); d = x[1]; t = x[2] } n = split(t, a, ":"); s = 0; for (i = 1; i <= n; i++) s = s * 60 + a[i]; v = d * 86400 + s } END { print v + 0 }'; }
wait_holder_age() { # a holder younger than AGE_S dying would count as a young death in a row
  local age w
  age=$(holder_age_s)
  if [ "${age:-0}" -lt "$AGE_S" ]; then w=$(( AGE_S - age + 2 )); say "$1: the holder is ${age:-0} s old; waiting $w s so its death is not counted as a young one in a row"; sleep "$w"; fi
}
settle_single() { # a short wait for one holder only (an update leaves two for a moment)
  local i
  for i in $(seq 1 25); do probe && [ -n "$PP" ] && [ "$(echo "$PP" | tr ',' '\n' | grep -c .)" = 1 ] && return 0; sleep 1; done
  return 1
}

do_install() { # do_install <marker> <label>: 0 installed, 1 failed, 9 marker present (a second install is never made)
  [ "$P0_OK" = 1 ] || { say "$2: refused: P0 has not passed"; return 1; }
  if [ -e "$OUT/$1" ]; then say "$2: install NOT repeated: marker $OUT/$1 exists (this script installed already; delete the marker by hand to allow one more)"; return 9; fi
  : > "$OUT/$1"
  local o
  o=$(timeout 300 "$ADB" -s "$DEV" install -r "$APK" </dev/null 2>&1 | tr -d '\r' | tail -2 | tr '\n' ' ')
  say "$2: adb install -r $(basename "$APK") -> $o"
  case "$o" in *Success*) return 0 ;; *) return 1 ;; esac
}

unlock() { # the A53 helper wakes and unlocks with the PIN (lease checked there); never prints the PIN
  local o rc
  o=$(A53_ENV=/dev/null A53_IP="${DEV%%:*}" A53_AGENT="${A53_AGENT:-}" bash "$A53SH" unlock 2>&1); rc=$?
  printf '%s\n' "$o" | tail -3 | sed 's/^/  /' | tee -a "$LOG"
  return $rc
}
shot() { # shot <name> home|settings: a screenshot with Dreamscape's home or Android Settings in front (an illustration only)
  S input keyevent KEYCODE_WAKEUP >/dev/null
  if [ "$2" = settings ]; then S am start -a android.settings.SETTINGS >/dev/null; else S input keyevent KEYCODE_HOME >/dev/null; fi
  sleep 3
  A exec-out screencap -p > "$OUT/$1.png" 2>/dev/null
  say "  screenshot $OUT/$1.png ($2 in front; focus: $(S 'dumpsys window | grep mCurrentFocus | tail -1' | sed 's/.*mCurrentFocus=//'); $(stat -c %s "$OUT/$1.png" 2>/dev/null || echo 0) bytes) - an illustration only, never proof"
}
shot_pair() { shot "$1-settings" settings; shot "$1-home" home; }

# the new app process after an update / crash: early hold, link, ADB lines, and the 36 s check (the service-not-bound fallback arms at 30 s)
C35_FB=""; C35_NB=""; C35_BOUND=""; EARLY_NOTE=""; EARLY_FAIL=""
check35() { # check35 <new app pid> <t0 ms>: waits until 36 s after that process started, then looks for a fallback / not-bound line
  local st0 now rem
  st0=$(logms "$2" "Start proc $1:$PKG" first "ActivityManager:I")
  if [ -z "$st0" ]; then say "  36 s check: no 'Start proc $1' line found; counting from now"; st0=$(pnow); fi
  now=$(pnow); rem=$(( (st0 + 36000 - now) / 1000 + 1 ))
  if [ "$rem" -gt 0 ]; then say "  waiting $rem s for 36 s after the new process ($1) started"; sleep "$rem"; fi
  C35_FB=$(logq "$st0" 'gesture fallback on' | head -3 | tr '\n' ' ')
  C35_NB=$(logq "$st0" 'not bound|unbound|service not|no longer bound' | head -3 | tr '\n' ' ')
  C35_BOUND=$(a11y)
  say "  36 s after the process start (Start proc at phone clock $st0): accessibility [$C35_BOUND]; 'gesture fallback on' lines: ${C35_FB:-none}; 'not bound' lines: ${C35_NB:-none}"
}
procevidence() { # procevidence <name> <pid> <since_ms>: the new process's own log, filtered to early hold / link / ADB / Bars service / heal / fallback lines
  local f=$OUT/$1-newproc-logcat.txt
  S "logcat -d -v time,epoch --pid=$2" > "$f"
  say "  new process $2: full log in $f ($(wc -l < "$f") lines); lines about early hold, link, ADB, the Bars service, heal, fallback (time relative to the step start):"
  awk -v t="$3" '$1 + 0 > 1000000000 && $1 * 1000 >= t { r = $1 - t / 1000; $1 = ""; printf "  %+.2fs%s\n", r, $0 }' "$f" | grep -i -E 'early hold|holder|LocalAdb|AdbWifi|adb|unauthor|not bound|unbound|heal|fallback|MelatonBarService|accessibility|1340|1371|1331' | cut -c1-250 | head -70 | block
}
early_report() { # early_report <name> <t0 ms>: sets EARLY_NOTE / EARLY_FAIL
  local newapp eh link kill nu
  EARLY_NOTE=""; EARLY_FAIL=""
  ST=$(st); newapp=$(stf app); newapp=${newapp%%,*}
  if [ -z "$newapp" ]; then EARLY_NOTE="no new app pid to look at"; return; fi
  check35 "$newapp" "$2"
  procevidence "$1" "$newapp" "$2"
  kill=$(logms "$2" "Killing [0-9]+:$PKG|Force stopping $PKG" first "ActivityManager:I")
  eh=$(logms "$2" 'early hold at process start' first)
  link=$(logms "$2" 'holder token linked' first)
  nu=$(grep -ci 'unauthor' "$OUT/$1-newproc-logcat.txt" 2>/dev/null)
  EARLY_NOTE="old process killed at +$(relsec "${kill:-0}" "$2") s; 'early hold at process start' $([ -n "$eh" ] && echo "at +$(relsec "$eh" "$2") s ($(relsec "$eh" "${kill:-0}") s after the kill)" || echo 'NOT seen'); 'holder token linked' $([ -n "$link" ] && echo "at +$(relsec "$link" "$2") s ($(relsec "$link" "${kill:-0}") s after the kill)" || echo 'NOT seen'); lines mentioning 'unauthorized' in the new process: ${nu:-0}; 36 s check: accessibility [$C35_BOUND], fallback lines: ${C35_FB:-none}, not-bound lines: ${C35_NB:-none}"
  case "$C35_BOUND" in *bound=1*) [ -z "$C35_FB" ] || EARLY_FAIL="'gesture fallback on' within 36 s of the new process although the service is bound: $C35_FB" ;; esac
}

# ------------------------------------------------------------------------------------------------ the way back (S7, S8, END)
WB_T0=0; WB_OFF_MS=""; WB_TRIGGERS=""; NIGHT_ORIG=""; NIGHT_CHANGED=0
do_trigger() { # do_trigger <name>: one screen event that does not lock the phone
  case "$1" in
    T1) say "  trigger T1: KEYCODE_WAKEUP, Settings in front, then KEYCODE_HOME (the app's home)"
        S input keyevent KEYCODE_WAKEUP >/dev/null; sleep 1; S am start -a android.settings.SETTINGS >/dev/null; sleep 2; S input keyevent KEYCODE_HOME >/dev/null ;;
    T2) local to w i
        to=$(S 'settings get system screen_off_timeout')
        say "  trigger T2: let the display time out by itself (screen_off_timeout $to ms), then KEYCODE_WAKEUP"
        w=$(( to / 1000 + 12 ))
        for i in $(seq 1 "$w"); do
          case "$(S 'dumpsys power | grep -o "mWakefulness=[A-Za-z]*" | head -1')" in *Awake*) sleep 1 ;; *) break ;; esac
        done
        S input keyevent KEYCODE_WAKEUP >/dev/null; sleep 1
        if [ "$(S 'dumpsys window | grep -o "isKeyguardShowing=[a-z]*" | head -1')" != "isKeyguardShowing=false" ]; then say "  the keyguard came on: unlocking again"; unlock >/dev/null; fi
        S input keyevent KEYCODE_HOME >/dev/null ;;
    T5) local pid i foc
        pid=$(S "pidof $PKG" | awk '{ print $1 }')
        [ -n "$pid" ] || { say "  trigger T5 skipped: the app has no process"; return 1; }
        say "  trigger T5: am crash $pid (the app's main process dies and starts again: the service connects again, an event)"
        LASTKILL=$(date +%s)
        S "am crash $pid" >/dev/null
        for i in $(seq 1 25); do
          sleep 1
          foc=$(S 'dumpsys window | grep mCurrentFocus | tail -1')
          case "$foc" in *"Application Error"*|*AppErrorDialog*) S input keyevent KEYCODE_BACK >/dev/null ;; esac
          case "$foc" in *"$PKG"*) [ "$i" -gt 3 ] && break ;; esac
        done ;;
    T4) say "  trigger T4: the notification shade expanded and collapsed (cmd statusbar)"
        S 'cmd statusbar expand-notifications' >/dev/null; sleep 2; S 'cmd statusbar collapse' >/dev/null; sleep 1; S input keyevent KEYCODE_HOME >/dev/null ;;
    T3) local o
        o=$(S 'cmd uimode night' | sed 's/.*: *//')
        case "$o" in
          yes) NIGHT_ORIG=yes; NIGHT_CHANGED=1; S 'cmd uimode night no' >/dev/null ;;
          no|auto) NIGHT_ORIG=$o; NIGHT_CHANGED=1; S 'cmd uimode night yes' >/dev/null ;;
          *) say "  trigger T3 skipped: night mode is '$o'"; return 1 ;;
        esac
        say "  trigger T3: night mode toggled from '$o' (a configuration change), restored right after"
        sleep 3; S "cmd uimode night $NIGHT_ORIG" >/dev/null; NIGHT_CHANGED=0; sleep 2 ;;
  esac
  return 0
}
second_trigger() { # the display-off event only when the phone's own timeout allows it without locking; else the opt-in uimode event; else T1 again
  local to lk
  to=$(S 'settings get system screen_off_timeout'); lk=$(S 'settings get secure lock_screen_lock_after_timeout')
  if fnum "$to" && [ "$to" -le 180000 ] && fnum "$lk" && [ "$lk" -ge 3000 ]; then echo T2; return; fi
  say "  display off/on not possible without locking or sending SLEEP/POWER (screen_off_timeout=${to:-?} ms, lock after ${lk:-?} ms): not tried"
  if [ "${A53_S7_UIMODE:-1}" = 1 ]; then echo T3; else echo T4; fi
}
WB_WINNER=""
way_back() { # way_back <label>: 0 the room is back and held, 1 'fallback off' seen but the state is wrong, 2 no trigger worked
  local label=$1 attempt=0 trig target now rem prevhost=0 found tried=0 second list x watch until i
  local order=()
  WB_T0=0; WB_OFF_MS=""; WB_TRIGGERS=""
  DIRTY=1
  if [ -n "$(S "[ -d $OUTFILE ] && echo d")" ]; then S "rmdir $OUTFILE" >/dev/null; say "$label: removed the $OUTFILE directory first"; fi
  # the trigger that worked before goes first, then the briefed ones (T1 wake + home, a second event, T5 the app's own restart)
  second=$(second_trigger | tail -1)
  list="${WB_WINNER:+$WB_WINNER }T1 $second T5"
  for x in $list; do case " ${order[*]:-} " in *" $x "*) ;; *) order+=("$x") ;; esac; done
  for trig in "${order[@]}"; do
    attempt=$((attempt + 1))
    if [ "$prevhost" -eq 0 ]; then
      if [ "${FB_START_MS:-0}" -gt 0 ]; then
        target=$(( FB_START_MS + BACK_GAP_S * 1000 + 1500 )); now=$(pnow)
        rem=$(( (target - now) / 1000 + 1 ))
      else rem=$(( BACK_GAP_S + 2 )); fi
    elif [ "$tried" = 1 ]; then rem=$(( prevhost + BACK_GAP_S + 2 - $(date +%s) ))   # the last event started a try: the app waits BACK_GAP_S after it
    else rem=2; fi
    if [ "$rem" -gt 0 ]; then say "$label: attempt $attempt ($trig): waiting $rem s so that the event is at least ${BACK_GAP_S} s after the fallback began / the last try"; sleep "$rem"; fi
    WB_T0=$(pnow); prevhost=$(date +%s)
    WB_TRIGGERS="$WB_TRIGGERS ${trig}@+$(relsec "$WB_T0" "${FB_START_MS:-0}")s"
    do_trigger "$trig" || { tried=0; continue; }
    watch=20; [ "$trig" = T5 ] && watch=50
    until=$(( SECONDS + watch )); found=""
    while :; do
      found=$(logms "$WB_T0" 'gesture fallback off' first)
      [ -n "$found" ] && break
      [ "$SECONDS" -ge "$until" ] && break
      sleep 1
    done
    if [ -z "$found" ]; then
      tried=0; [ -n "$(logms "$WB_T0" 'holder token|row could not|holder died|fallback' first)" ] && tried=1
      say "$label: attempt $attempt ($trig): no 'gesture fallback off' line within $watch s (the event $([ $tried = 1 ] && echo 'started a try of some kind' || echo 'left no hold-related log line'))"
      continue
    fi
    WB_OFF_MS=$found; WB_WINNER=$trig
    say "$label: attempt $attempt ($trig): 'gesture fallback off' seen at +$(relsec "$found" "$WB_T0") s after the event"
    until=$(( SECONDS + 30 ))
    while :; do
      ST=$(st)
      if is_room && is_held; then return 0; fi
      [ "$SECONDS" -ge "$until" ] && break
      sleep 1.5
    done
    say "$label: after 'fallback off' the state is wrong: $ST"
    return 1
  done
  return 2
}

# ------------------------------------------------------------------------------------------------ the steps
VC0=""; BASE_ST=""; BASE_VOL=""; BASE_FOCUS=""

vols() { S 'for s in music ring notification alarm system; do printf "%s=%s " $s "$(settings get system volume_$s)"; done'; }

step_P0() {
  say "==== P0 preconditions"
  say "phone: $MODEL, Android $(S getprop ro.build.version.release) (sdk $(S getprop ro.build.version.sdk)), $DEV; agent ${A53_AGENT:-${COORD_AGENT_ID:-?}}; host $(hostname)"
  PH_TZ=$(S 'date +%z'); PH_YEAR=$(S 'date +%Y')
  case "$PH_TZ" in [+-][0-9][0-9][0-9][0-9]) ;; *) PH_TZ="+0000"; say "WARNING: the phone's time zone was not readable; history times are taken as UTC" ;; esac
  say "clocks: phone $(S 'date "+%F %T %z"'), host $(date '+%F %T %z')"
  say "awake + unlocked first (so a screen-on re-check cannot fall inside a step):"
  unlock || stop "the phone could not be unlocked (see above; the a53 lease must be held by ${A53_AGENT:-the agent})"
  [ "$(S 'dumpsys window | grep -o "isKeyguardShowing=[a-z]*" | head -1')" = "isKeyguardShowing=false" ] || stop "the keyguard is still showing"
  case "$(S 'dumpsys power | grep -o "mWakefulness=[A-Za-z]*" | head -1')" in *Awake*) ;; *) S input keyevent KEYCODE_WAKEUP >/dev/null; sleep 2 ;; esac
  case "$(S 'dumpsys power | grep -o "mWakefulness=[A-Za-z]*" | head -1')" in *Awake*) ;; *) stop "the phone is not awake" ;; esac
  ST=$(st); BASE_ST=$ST
  say "baseline :: $ST"
  [ -n "$ST" ] || stop "st returned nothing (adb or dumpsys not answering)"
  [ "$(stf mode)" = 0 ] || stop "navigation_mode is '$(stf mode)', not 0: the 3-button room is not on (Melaton Bars' soft keys / room are off on this phone, or a fallback is active). Nothing was changed."
  case "$(stf overlay)" in *threebutton*) ;; *) stop "the enabled navbar overlay is '$(stf overlay)', not the 3-button one. Nothing was changed." ;; esac
  is_held || stop "the row is not held at the start (holder [$(stf holder)], shell disable records [$(stf shellrec)]). Nothing was changed."
  [ -z "$(S "[ -d $OUTFILE ] && echo d")" ] || stop "$OUTFILE is a directory (left by an earlier run): remove it with  adb -s $DEV shell rmdir $OUTFILE  and run again"
  [ "$(stf barsBound)" = 1 ] || say "WARNING: MelatonBarService is not listed as bound at the start (barsBound=$(stf barsBound))"
  VC0=$(stf vc); BASE_VOL=$(vols); BASE_FOCUS=$(S 'dumpsys window | grep mCurrentFocus | tail -1' | sed 's/.*mCurrentFocus=//')
  say "installed versionCode $VC0; volumes (never changed by this script: no sound, no notice) $BASE_VOL; focus $BASE_FOCUS"
  say "answer file now: [$(stf out)]; installer activity lines $(S 'dumpsys activity activities | grep -ci packageinstaller'); ds-install files $(S 'ls /data/local/tmp/ds-install-* 2>/dev/null | wc -l')"
  if want S1 || want S2; then
    say "apk $APK ($(stat -c %s "$APK") bytes) expected versionCode $VC; phone runs $VC0"
    if command -v unzip >/dev/null 2>&1; then unzip -l "$APK" 2>/dev/null | grep -q AndroidManifest.xml || stop "$APK is not an apk (no AndroidManifest.xml)"; fi
  fi
  P0_OK=1
  verdict P0 PASS "model $MODEL, unlocked + awake, navigation_mode 0, 3-button overlay, row held (holder [$(stf holder)], $(stf shellrec) shell record), app pid [$(stf app)], versionCode $VC0"
}

step_S1() {
  say "==== S1 first install: old build -> the fixed build $VC (the old side has no grace: a gap is EXPECTED, it is the baseline)"
  if [ "$VC0" = "$VC" ]; then verdict S1 SKIP "the phone already runs versionCode $VC at the start (S1 is the old -> fixed step)"; return; fi
  require_ready S1 || return
  cooldown S1
  prep_old
  [ -n "$OLDP" ] && [ -n "$OLDT" ] || { verdict S1 SKIP "no holder / record to start from"; return; }
  DIRTY=1; LASTKILL=$(date +%s)
  sampler_start S1
  do_install "installed-1-$VC" S1; local irc=$?
  if [ $irc -ne 0 ]; then
    sampler_stop S1
    if [ $irc = 9 ]; then verdict S1 SKIP "the marker says this script already installed once"; else verdict S1 FAIL "adb install failed (see above)"; fi
    return
  fi
  local hrc
  wait_new_hold 60; hrc=$?
  sleep 6
  sampler_stop S1
  ST=$(st)
  local nvc out linked fails=() notes=()
  nvc=$(stf vc); out=$(stf out)
  say "  after: $ST"
  analyze_samples S1 "$T0" "$OLDA" "$OLDP"
  local zr=$(pyv zero_runs) zt=$(pyv zero_total) nt=$(pyv new_row_ms)
  analyze_hist S1 "$T0" "$OLDT"
  local hgaps=$(pyv gaps) hc=$(pyv clear_rows)
  applog "$T0" 24
  linked=$(logms "$T0" 'holder token linked' first)
  early_report S1 "$T0"
  [ "$nvc" = "$VC" ] || fails+=("versionCode on the phone is $nvc, expected $VC")
  [ $hrc = 0 ] || fails+=("not held by a new holder within 60 s")
  [ "$out" = OK ] || fails+=("answer file is [$out], expected exactly OK (OK nolink means the death link failed)")
  [ -n "$linked" ] || fails+=("no 'holder token linked' log line since the install")
  notes+=("$EARLY_NOTE"); [ -z "$EARLY_FAIL" ] || fails+=("$EARLY_FAIL")
  notes+=("expected gap on the old side: sampler recs=0 runs [${zr:--}] s (min-max), history CLEAR rows $hc gaps [${hgaps:--}] s")
  if [ ${#fails[@]} -eq 0 ]; then verdict S1 PASS "vc $nvc, held by a new holder after ${HELD_AT_S:-?} s, answer file OK, token linked at +$(relsec "$linked" "$T0") s; $(jn "${notes[@]}")"
  else verdict S1 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
}

step_S2() {
  say "==== S2 update over the running fixed build: adb install -r of the same apk (D4, the proof)"
  require_ready S2 || return
  local nowvc; nowvc=$(stf vc)
  if [ "$nowvc" != "$VC" ]; then verdict S2 SKIP "the phone runs $nowvc, not the fixed build $VC (S1 first, or install it by hand)"; return; fi
  if [ -e "$OUT/installed-2-$VC" ]; then verdict S2 SKIP "marker $OUT/installed-2-$VC exists: this script already did the S2 install (delete it by hand to allow one more)"; return; fi
  cooldown S2
  settle_single || say "  note: more than one holder alive before the install (holders [$PP])"
  prep_old
  [ -n "$OLDP" ] && [ -n "$OLDT" ] && [ -n "$OLDA" ] || { verdict S2 SKIP "no holder / record / app pid to start from"; return; }
  DIRTY=1; LASTKILL=$(date +%s)
  sampler_start S2
  do_install "installed-2-$VC" S2; local irc=$?
  if [ $irc -ne 0 ]; then sampler_stop S2; verdict S2 FAIL "adb install failed (see above)"; return; fi
  local hrc grc
  wait_new_hold 60; hrc=$?
  wait_old_gone 30; grc=$?
  sleep 3
  sampler_stop S2
  ST=$(st); local ab; ab=$(a11y)
  say "  after: $ST"; say "  accessibility: $ab"
  analyze_samples S2 "$T0" "$OLDA" "$OLDP"
  local zt=$(pyv zero_total) zg=$(pyv zero_after_gone) zr=$(pyv zero_runs) ov=$(pyv overlap_n) ovr=$(pyv overlap_recs) ovm=$(pyv overlap_maxrecs)
  local nh=$(pyv new_holder_ms) nr=$(pyv new_row_ms) g2n=$(pyv gone_to_newrow_s) g2o=$(pyv gone_to_oldholder_s) ns=$(pyv n) ag=$(pyv app_gone_ms) pause=$(pyv max_pause_ms)
  analyze_hist S2 "$T0" "$OLDT"
  local hcl=$(pyv clear_rows) hord=$(pyv order) hng=$(pyv ngaps) hgp=$(pyv gaps)
  applog "$T0" 30
  say "  ActivityManager lines about the app process (raw):"
  logq "$T0" "Killing [0-9]+:$PKG|Force stopping $PKG|Start proc [0-9]+:$PKG|Process $PKG" "ActivityManager:I" | head -12 | block
  early_report S2 "$T0"
  local fails=() notes=() napp nbound ncr
  notes+=("$EARLY_NOTE"); [ -z "$EARLY_FAIL" ] || fails+=("$EARLY_FAIL")
  napp=$(stf app); nbound=$(printf '%s' "$ab" | sed -n 's/.*bound=\([0-9]*\).*/\1/p'); ncr=$(printf '%s' "$ab" | sed -n 's/.*crashed=\([0-9]*\).*/\1/p')
  # (a) the row never empty
  if ! fnum "$ns" || [ "$ns" -lt 10 ]; then fails+=("the sampler gave only ${ns:-0} lines: cannot prove 'recs never 0'")
  elif [ "$zt" -gt 0 ]; then fails+=("the sampler saw recs=0 in $zt samples ($zg of them after the old app pid disappeared; runs [${zr}] s min-max): Android's row was without a hold")
  else notes+=("sampler: recs never 0 in $ns samples (longest pause $pause ms)"); fi
  # (b) a new holder / token, two alive or a gapless handover
  if [ "$hrc" != 0 ] || [ -z "$nh" ]; then fails+=("no new holder pid was seen")
  elif [ "${ov:-0}" -gt 0 ]; then notes+=("two holders alive in $ov samples (the new one started first)")
  elif [ "$zt" = 0 ]; then notes+=("no sample caught two holders; the pid changed with recs never 0 (handover faster than the ${pause:-?} ms sampler pause)")
  else fails+=("no overlap of the two holders and a gap: no proof the new holder started first"); fi
  # (c) history
  if [ "${hcl:-0}" -gt 0 ]; then
    [ "${hng:-0}" = 0 ] || fails+=("history: a CLEAR was followed later by a BACK row (gaps [$hgp] s)")
    [ "$hord" != bad ] || fails+=("history: the new token's BACK row is NOT before the old token's CLEAR row")
    notes+=("history: $hcl CLEAR row(s), order $hord, gaps [$hgp]")
  else notes+=("history: no CLEAR rows on this phone (a holder's death is not logged there), so the BACK-before-CLEAR order is shown by the sampler only"); fi
  # (d) app and service back
  { [ -n "$napp" ] && [ "$napp" != "$OLDA" ]; } || fails+=("the app process is not back (app [$napp], was [$OLDA])")
  [ "${nbound:-0}" = 1 ] || fails+=("MelatonBarService is not bound (bound=${nbound:-?})")
  [ "${ncr:-0}" = 0 ] || fails+=("MelatonBarService is in 'Crashed services'")
  [ "$grc" = 0 ] || fails+=("the old holder was still alive 30 s after the new one held")
  # numbers asked for
  if [ -n "$g2n" ]; then notes+=("old app pid gone -> new holder's record: $g2n s; GRACE_S=$GRACE_S s: margin $(awk -v g="$GRACE_S" -v x="$g2n" 'BEGIN { printf "%.2f", g - x }') s (+- sampler pause)"); else notes+=("old app pid gone -> new row: not measured (no sample without the old app pid)"); fi
  [ -n "$g2o" ] && notes+=("old holder exited $g2o s after the old app pid disappeared")
  if [ "${ov:-0}" -gt 0 ]; then
    if [ "${ovm:-0}" -ge 2 ]; then notes+=("Samsung keeps one record PER TOKEN (2 records while both holders lived)"); else notes+=("Samsung showed ONE record while two holders lived (per package? the second token's record replaced / merged)"); fi
  else notes+=("one-record-per-token vs per-package: not observed (no overlap sample)"); fi
  if [ ${#fails[@]} -eq 0 ]; then verdict S2 PASS "$(jn "${notes[@]}")"; else verdict S2 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
  shot_pair S2
}

step_S3() {
  say "==== S3 adbd restart (adb tcpip 5555): the holder dies with adbd, the app holds again"
  [ "${DEV##*:}" = 5555 ] || { verdict S3 SKIP "A53_DEV $DEV is not on port 5555"; return; }
  require_ready S3 || return
  prep_old
  [ -n "$OLDP" ] && [ -n "$OLDT" ] || { verdict S3 SKIP "no holder / record to start from"; return; }
  DIRTY=1
  local hs; hs=$(date +%s.%N)
  say "  adb tcpip 5555: $(A tcpip 5555 2>&1 | tr -d '\r' | tail -1)"
  sleep 3
  local i
  for i in $(seq 1 15); do
    "$ADB" connect "$DEV" >/dev/null 2>&1 </dev/null
    [ "$(A get-state 2>/dev/null | tr -d '\r')" = device ] && break
    sleep 2
  done
  say "  adb is back: $(A get-state 2>&1 | tr -d '\r') ; adbd $(S 'ps -A -o PID,ETIME,ARGS | grep "adbd " | grep -v grep | head -1')"
  local hrc; wait_new_hold 60; hrc=$?
  local total; total=$(awk -v a="$hs" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1f", b - a }')
  sleep 2
  ST=$(st); say "  after: $ST"
  analyze_hist S3 "$T0" "$OLDT"
  local lb=$(pyv last_back_ms) fb=$(pyv first_back_ms) hcl=$(pyv clear_rows) hgp=$(pyv gaps)
  applog "$T0" 12
  local died; died=$(logms "$T0" 'holder died' first)
  if [ "$hrc" != 0 ]; then
    if [ -n "$PP" ] && [ "$PP" = "$OLDP" ]; then verdict S3 INCONCLUSIVE "the holder [$OLDP] survived the adbd restart (not an adbd child on this phone?)"; else verdict S3 FAIL "not held again by a new holder within 60 s (holders [${PP:--}], tokens [${PT:--}])"; fi
    return
  fi
  local gap_t0="" gap_died=""
  [ -n "$fb" ] && gap_t0=$(relsec "$fb" "$T0")
  [ -n "$fb" ] && [ -n "$died" ] && gap_died=$(relsec "$fb" "$died")
  local msg="new BACK row at +${gap_t0:-?} s after the command ($(echo "${gap_died:+row visible about $gap_died s after the 'holder died' line}")); host clock from the command to held: $total s (includes the adb reconnect); history CLEAR rows ${hcl:-0} gaps [${hgp:--}]"
  if [ -n "$gap_t0" ]; then
    if [ "$(awk -v g="$gap_t0" 'BEGIN { print (g <= 10) }')" = 1 ]; then verdict S3 PASS "held again within 10 s: $msg"; else verdict S3 FAIL "held again only after $gap_t0 s (limit 10 s): $msg"; fi
  else
    if [ "$(awk -v g="$total" 'BEGIN { print (g <= 10) }')" = 1 ]; then verdict S3 PASS "held again within 10 s (host clock; no history BACK row to time it): $msg"; else verdict S3 INCONCLUSIVE "no history BACK row, and the host clock says $total s including the reconnect: $msg"; fi
  fi
}

step_S4() {
  say "==== S4 holder killed once: the app holds again"
  require_ready S4 || return
  prep_old
  [ -n "$OLDP" ] && [ -n "$OLDT" ] || { verdict S4 SKIP "no holder / record to start from"; return; }
  DIRTY=1
  say "  kill $OLDP: $(S 'kill $(pidof '"$HOLDER"') 2>&1; echo killed')"
  local hrc; wait_new_hold 60; hrc=$?
  sleep 2
  ST=$(st); say "  after: $ST"
  analyze_hist S4 "$T0" "$OLDT"
  local fb=$(pyv first_back_ms)
  applog "$T0" 12
  local died; died=$(logms "$T0" 'holder died' first)
  if [ "$hrc" != 0 ]; then verdict S4 FAIL "not held again by a new holder within 60 s"; return; fi
  local g=""; [ -n "$fb" ] && g=$(relsec "$fb" "$T0")
  local msg="new BACK row at +${g:-?} s after the kill; host clock until held ${HELD_AT_S:-?} s; 'holder died' line at +$([ -n "$died" ] && relsec "$died" "$T0" || echo '?') s"
  if [ -n "$g" ] && [ "$(awk -v g="$g" 'BEGIN { print (g <= 20) }')" = 1 ]; then verdict S4 PASS "held again by a new holder: $msg"
  elif [ -z "$g" ]; then verdict S4 PASS "held again by a new holder after ${HELD_AT_S:-?} s (host clock; no history row to time it): $msg"
  else verdict S4 FAIL "held again only after $g s (limit 20 s): $msg"; fi
}

step_S5() {
  say "==== S5 am crash <main pid of $PKG> once (D6): does the row stay empty until the new process holds"
  require_ready S5 || return
  cooldown S5
  prep_old
  [ -n "$OLDP" ] && [ -n "$OLDT" ] && [ -n "$OLDA" ] || { verdict S5 SKIP "no holder / record / app pid to start from"; return; }
  DIRTY=1; LASTKILL=$(date +%s)
  sampler_start S5
  # am crash <package> hits whichever process of the package it finds first (on the A53 it once hit the WebView js sandbox
  # process of the app's uid and left the main process alone): the main process is crashed by its pid
  local mainpid=${OLDA%%,*}
  say "  am crash $mainpid (the main process of $PKG): $(S "am crash $mainpid 2>&1 | head -2" | tr '\n' ' ')"
  local i back="" bound=0 held=0 pressed=0 focus
  local t0=$(date +%s)
  for i in $(seq 1 75); do
    sleep 1
    if [ $i = 4 ] || [ $i = 10 ]; then
      focus=$(S 'dumpsys window | grep mCurrentFocus | tail -1')
      case "$focus" in *"Application Error"*|*AppErrorDialog*|*"keeps stopping"*) say "  a crash dialog is in front ($focus): one BACK key to close it"; S input keyevent KEYCODE_BACK >/dev/null ;; esac
    fi
    probe || continue
    if [ $i -ge 15 ] && [ "$PA" = "$OLDA" ]; then say "  the app's main process (pid $OLDA) is still alive 15 s after the crash command: it survived"; break; fi
    if [ -z "$back" ] && [ -n "$PA" ] && [ "$PA" != "$OLDA" ]; then back=$(( $(date +%s) - t0 )); say "  the app process is back after about $back s (pid [$PA])"; fi
    if [ -z "$back" ] && [ $i -ge 20 ] && [ $pressed = 0 ]; then pressed=1; say "  the app did not come back by itself in 20 s: KEYCODE_HOME (the app is the home app), as a user would"; S input keyevent KEYCODE_HOME >/dev/null; fi
    [ -n "$back" ] && [ "$bound" = 0 ] && case "$(a11y)" in *bound=1*) bound=$(( $(date +%s) - t0 )); say "  MelatonBarService bound again after about $bound s" ;; esac
    if [ -n "$(cminus "$PT" "$OLDT")" ] && [ -n "$(cminus "$PP" "$OLDP")" ]; then held=$(( $(date +%s) - t0 )); say "  new holder [$PP] with record token [$PT] after about $held s"; fi
    [ -n "$back" ] && [ "$bound" != 0 ] && [ "$held" != 0 ] && break
  done
  wait_old_gone 30 >/dev/null
  sleep 3
  sampler_stop S5
  S input keyevent KEYCODE_HOME >/dev/null
  ST=$(st); local ab; ab=$(a11y)
  say "  after: $ST"; say "  accessibility: $ab"
  analyze_samples S5 "$T0" "$OLDA" "$OLDP"
  local zt=$(pyv zero_total) zr=$(pyv zero_runs) g2o=$(pyv gone_to_oldholder_s) g2n=$(pyv gone_to_newrow_s) ns=$(pyv n)
  applog "$T0" 24
  say "  ActivityManager lines about the app process (raw):"
  logq "$T0" "Killing [0-9]+:$PKG|Force stopping $PKG|crash|Start proc [0-9]+:$PKG" "ActivityManager:I" | head -12 | block
  early_report S5 "$T0"
  local fails=() notes=() napp nbound ncr
  notes+=("$EARLY_NOTE"); [ -n "$EARLY_FAIL" ] && notes+=("NOTE: $EARLY_FAIL")
  napp=$(stf app); nbound=$(printf '%s' "$ab" | sed -n 's/.*bound=\([0-9]*\).*/\1/p'); ncr=$(printf '%s' "$ab" | sed -n 's/.*crashed=\([0-9]*\).*/\1/p')
  if [ -n "$napp" ] && [ "$napp" = "$OLDA" ]; then
    verdict S5 INCONCLUSIVE "the app's main process (pid $OLDA) survived 'am crash $mainpid': nothing was tested (sampler: app pid never changed; the crash hit [$(logq "$T0" 'Showing crash dialog|FATAL|Killing' 'ActivityManager:I' | head -3 | tr '\n' ' ')])"
    return
  fi
  { [ -n "$napp" ] && [ "$napp" != "$OLDA" ]; } || fails+=("the app process did not come back (app [$napp], was [$OLDA])")
  [ "${nbound:-0}" = 1 ] || fails+=("MelatonBarService is not bound again (bound=${nbound:-?}) after 75 s")
  [ "${ncr:-0}" = 0 ] || fails+=("MelatonBarService is in 'Crashed services'")
  is_held || fails+=("the row is not held again (holder [$(stf holder)], records $(stf shellrec))")
  if [ -n "$g2o" ]; then
    notes+=("old holder exited $g2o s after the app pid disappeared (expected no later than $GRACE_S s + 3 s)")
    [ "$(awk -v g="$g2o" -v m="$GRACE_S" 'BEGIN { print (g <= m + 3) }')" = 1 ] || fails+=("the old holder lived $g2o s after the app died, more than GRACE_S $GRACE_S s + 3 s")
  else notes+=("old holder exit not observed against the app pid (no sample with the old app pid gone, or the holder survived): see the sampler analysis"); fi
  if fnum "$ns" && [ "$ns" -ge 10 ]; then
    if [ "$zt" = 0 ]; then notes+=("the row stayed empty of Android's buttons the whole time (recs never 0)"); else notes+=("recs=0 runs [${zr}] s (min-max): Android's row was visible for that long, expected only when the new process needed longer than the grace"); fi
  else notes+=("sampler gave too few lines: recs=0 time not measured"); fi
  [ -n "$g2n" ] && notes+=("app gone -> new holder's record $g2n s")
  notes+=("process back after ${back:-never} s, service bound after ${bound} s, new holder after ${held} s (host clock, from the crash command)")
  if [ ${#fails[@]} -eq 0 ]; then verdict S5 PASS "$(jn "${notes[@]}")"; else verdict S5 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
}

step_S6() {
  say "==== S6 failed holder starts -> gesture fallback (D8): $OUTFILE made a directory, holder killed"
  require_ready S6 || return
  wait_holder_age S6
  DIRTY=1
  S "rm -f $OUTFILE; mkdir $OUTFILE" >/dev/null
  [ -n "$(S "[ -d $OUTFILE ] && echo d")" ] || { verdict S6 FAIL "could not make $OUTFILE a directory"; return; }
  prep_old
  say "  kill the holder: $(S 'kill $(pidof '"$HOLDER"') 2>&1; echo killed')"
  local i on="" n3="" fails=() notes=()
  for i in $(seq 1 45); do
    sleep 2
    [ -n "$n3" ] || n3=$(logms "$T0" '#3 in a row' first)
    on=$(logms "$T0" 'gesture fallback on' first)
    [ -n "$on" ] && break
  done
  applog "$T0" 30
  if [ -z "$on" ]; then
    ST=$(st); say "  no 'gesture fallback on' within 90 s :: $ST"
    verdict S6 FAIL "no 'gesture fallback on' line within 90 s of the kill (#3 line: ${n3:+seen at +$(relsec "$n3" "$T0") s}${n3:-not seen}); the answer-file directory is removed again by END"
    return
  fi
  FB_START_MS=$on
  notes+=("'#3 in a row' $([ -n "$n3" ] && echo "at +$(relsec "$n3" "$T0") s" || echo 'NOT seen'); 'gesture fallback on' at +$(relsec "$on" "$T0") s after the kill")
  [ -n "$n3" ] || fails+=("no '#3 in a row' line before the fallback")
  # the state: gestures on, the hold given up (the holder is killed after the overlay switch: allow 10 s)
  local ok=0 t=0
  for i in $(seq 1 10); do
    ST=$(st)
    if is_gestures && [ -z "$(stf holder)" ] && [ "$(stf shellrec)" = 0 ]; then ok=1; break; fi
    sleep 1
  done
  say "  state after the switch: $ST"
  if [ $ok = 1 ]; then notes+=("gestures on: overlay $(stf overlay) mode $(stf mode), no holder, no shell record (checked $(relsec "$(pnow)" "$on") s after the switch)")
  else
    is_gestures || fails+=("the no-hint gesture overlay is not the enabled navbar overlay with navigation_mode 2 or 3 (overlay [$(stf overlay)], mode [$(stf mode)])")
    [ -z "$(stf holder)" ] && [ "$(stf shellrec)" = 0 ] || fails+=("the hold was not given up: holder [$(stf holder)], shell records $(stf shellrec) 10 s after the switch")
  fi
  # screenshots inside the window (events of 60 s or less are not way-back events)
  shot_pair S6-gestures
  # no flip back for NOFLIP_S s after the fallback began (review fix S2)
  local end=$(( on + NOFLIP_S * 1000 )) flip="" now
  say "  watching until +$NOFLIP_S s after the fallback began for any flip back (log line, overlay, navigation_mode)"
  while :; do
    now=$(pnow)
    ST=$(st)
    if [ "$(stf mode)" = 0 ] || case "$(stf overlay)" in *threebutton*) true ;; *) false ;; esac; then flip="mode [$(stf mode)] overlay [$(stf overlay)] at +$(relsec "$now" "$on") s"; break; fi
    if [ -n "$(logms "$on" 'gesture fallback off' first)" ]; then flip="a 'gesture fallback off' line at +$(relsec "$(logms "$on" 'gesture fallback off' first)" "$on") s"; break; fi
    [ "$now" -ge "$end" ] && break
    sleep 3
  done
  ST=$(st)
  say "  app log lines after the switch (all MelatonBars lines, raw):"
  logq "$((on + 1))" '.' | tail -n 25 | block
  if [ -n "$flip" ]; then fails+=("it flipped back within $NOFLIP_S s: $flip (review fix S2 not working)")
  else notes+=("no flip back in the next $NOFLIP_S s: mode $(stf mode), overlay $(stf overlay)"); fi
  local late; late=$(logq "$((on + 1500))" 'could not be emptied|holds in a row|holder token linked|nolink' | wc -l)
  [ "${late:-0}" -gt 0 ] && notes+=("WARNING: $late hold-related log line(s) after the switch (a start was tried?): see the raw lines above")
  S "rmdir $OUTFILE" >/dev/null
  [ -z "$(S "[ -d $OUTFILE ] && echo d")" ] && notes+=("$OUTFILE directory removed again") || fails+=("could not remove the $OUTFILE directory")
  if [ ${#fails[@]} -eq 0 ]; then verdict S6 PASS "$(jn "${notes[@]}")"; else verdict S6 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
}

step_S7() {
  say "==== S7 the way back (D9): an event at least ${BACK_GAP_S} s after the fallback began"
  ST=$(st)
  if ! fallback_active; then verdict S7 SKIP "no fallback is active (navigation_mode $(stf mode), overlay $(stf overlay)); run S6 or S8 before it in the same run"; return; fi
  DIRTY=1
  if [ "${FB_START_MS:-0}" -le 0 ]; then FB_START_MS=$(logms 0 'gesture fallback on' last); FB_START_MS=${FB_START_MS:-0}; fi
  say "  fallback began at phone clock ${FB_START_MS} ms (0 = unknown, then a full ${BACK_GAP_S} s is waited)"
  way_back S7; local rc=$?
  say "  triggers tried:$WB_TRIGGERS"
  applog "${WB_T0:-0}" 30
  ST=$(st); say "  after: $ST"
  if [ $rc = 2 ]; then
    verdict S7 INCONCLUSIVE "no 'gesture fallback off' after the events tried ($WB_TRIGGERS): the event did not trigger the way back. Not tried: display off/on (the phone's screen_off_timeout is $(S 'settings get system screen_off_timeout') ms; KEYCODE_SLEEP / POWER are forbidden). Also tried: night-mode toggle (configuration change) and the notification shade, unless A53_S7_UIMODE=0. The END step restores the room the same way."
    return
  fi
  local fails=() notes=() linked back
  analyze_hist S7 "$WB_T0" ""
  back=$(pyv first_back_ms)
  linked=$(logms "$WB_T0" 'holder token linked' first)
  local offline; offline=$(logq "$WB_T0" 'gesture fallback off' | head -1)
  notes+=("'gesture fallback off' at +$(relsec "$WB_OFF_MS" "$WB_T0") s after the event ($WB_TRIGGERS); raw: ${offline:-?}")
  [ $rc = 0 ] || fails+=("after 'gesture fallback off' the state is wrong: $ST")
  case "$(stf overlay)" in *threebutton*) ;; *) fails+=("3-button overlay not enabled again (overlay [$(stf overlay)])") ;; esac
  [ "$(stf mode)" = 0 ] || fails+=("navigation_mode is $(stf mode), expected 0")
  is_held || fails+=("the row is not held (holder [$(stf holder)], records $(stf shellrec))")
  local known=0
  if [ -n "$linked" ]; then known=1; if [ "$linked" -le "$WB_OFF_MS" ]; then notes+=("'holder token linked' at +$(relsec "$linked" "$WB_T0") s, before 'fallback off' (+$(relsec "$WB_OFF_MS" "$WB_T0") s)"); else fails+=("the 'holder token linked' line (+$(relsec "$linked" "$WB_T0") s) is AFTER 'gesture fallback off' (+$(relsec "$WB_OFF_MS" "$WB_T0") s): the overlay was switched before the hold was taken"); fi; fi
  if [ -n "$back" ]; then known=1; if [ "$back" -le "$WB_OFF_MS" ]; then notes+=("history BACK row at +$(relsec "$back" "$WB_T0") s, not later than the 'fallback off' line"); else fails+=("the history BACK row (+$(relsec "$back" "$WB_T0") s) is later than the 'gesture fallback off' line (+$(relsec "$WB_OFF_MS" "$WB_T0") s)"); fi; fi
  [ $known = 1 ] || fails+=("neither a 'holder token linked' line nor a history BACK row was found to show the order")
  if [ ${#fails[@]} -eq 0 ]; then verdict S7 PASS "$(jn "${notes[@]}")"
  elif [ $known = 0 ] && [ ${#fails[@]} -eq 1 ]; then verdict S7 INCONCLUSIVE "$(jn "${fails[@]}"); $(jn "${notes[@]}")"
  else verdict S7 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
}

step_S8() {
  say "==== S8 death loop (D11): the holder killed 5 times, each as soon as a new one holds"
  require_ready S8 || return
  wait_holder_age S8
  DIRTY=1
  local T8; T8=$(pnow)
  local k killed=0 giving="" on="" fails=() notes=() prevp
  for k in 1 2 3 4 5; do
    prep_old
    [ -n "$OLDP" ] || { say "  no holder alive before kill $k"; break; }
    prevp=$OLDP
    say "  kill $k: $(S 'kill $(pidof '"$HOLDER"') 2>&1; echo killed') (holder [$prevp])"
    killed=$k
    [ $k -lt 5 ] || break
    WNH_PAT='giving up the holds'; WNH_SINCE=$T8
    wait_new_hold 45 || { WNH_PAT=""; say "  no new holder after kill $k"; break; }
    WNH_PAT=""
  done
  local i n5=""
  for i in $(seq 1 20); do
    n5=$(logms "$T8" '#5 in a row' first); giving=$(logms "$T8" 'giving up the holds' first); on=$(logms "$T8" 'gesture fallback on' first)
    [ -n "$on" ] && break
    sleep 2
  done
  say "  deaths in the app log:"; logq "$T8" 'holder died' | block
  applog "$T8" 30
  notes+=("$killed kill(s) in $(relsec "$(pnow)" "$T8") s")
  [ $killed -eq 5 ] || fails+=("only $killed kill(s) could be made (the holds were given up early or no new holder came)")
  [ -n "$n5" ] && notes+=("'#5 in a row' seen") || fails+=("no '#5 in a row' line")
  [ -n "$giving" ] && notes+=("'giving up the holds' at +$(relsec "$giving" "$T8") s") || fails+=("no 'giving up the holds' line")
  if [ -n "$on" ]; then FB_START_MS=$on; notes+=("'gesture fallback on' at +$(relsec "$on" "$T8") s"); else fails+=("no 'gesture fallback on' line within 40 s of the 5th kill"); fi
  local ok=0
  for i in $(seq 1 10); do ST=$(st); if is_gestures && [ -z "$(stf holder)" ] && [ "$(stf shellrec)" = 0 ]; then ok=1; break; fi; sleep 1; done
  say "  state: $ST"
  [ $ok = 1 ] && notes+=("gestures on, no hold") || fails+=("gestures not on / hold not given up: overlay [$(stf overlay)], mode [$(stf mode)], holder [$(stf holder)], records $(stf shellrec)")
  if [ -z "$on" ] && ! fallback_active; then
    if [ ${#fails[@]} -eq 0 ]; then verdict S8 PASS "$(jn "${notes[@]}")"; else verdict S8 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
    return
  fi
  # the way back, as in S7
  way_back S8; local rc=$?
  say "  triggers tried:$WB_TRIGGERS"
  ST=$(st); say "  after the way back: $ST"
  if [ $rc = 0 ]; then notes+=("way back at +$(relsec "$WB_OFF_MS" "$WB_T0") s after the event ($WB_TRIGGERS): room back and held")
  elif [ $rc = 2 ]; then verdict S8 INCONCLUSIVE "$(jn "${fails[@]}" "${notes[@]}"); the way back was not triggered by the events tried ($WB_TRIGGERS)"; return
  else fails+=("after the way back the state is wrong: $ST"); fi
  if [ ${#fails[@]} -eq 0 ]; then verdict S8 PASS "$(jn "${notes[@]}")"; else verdict S8 FAIL "$(jn "${fails[@]}"); $(jn "${notes[@]}")"; fi
}

# ------------------------------------------------------------------------------------------------ END
END_DONE=0
end_restore() {
  local rc=$?
  trap - EXIT INT TERM
  [ "$END_DONE" = 1 ] && exit "$rc"
  END_DONE=1
  [ "${MODEL_OK:-0}" = 1 ] || exit "$rc"
  [ "$DRY" = 1 ] && exit "$rc"
  say "==== END restore and verify (exit status so far $rc)"
  # the sampler and its files are ours: always removed
  if [ -n "$SAMP_PID" ]; then S "touch $SSTOP" >/dev/null; sleep 1; kill "$SAMP_PID" 2>/dev/null; wait "$SAMP_PID" 2>/dev/null; SAMP_PID=""; fi
  # the link may be down after an interrupted adbd restart
  local i
  for i in 1 2 3 4 5; do
    [ "$(A get-state 2>/dev/null | tr -d '\r')" = device ] && break
    "$ADB" connect "$DEV" >/dev/null 2>&1 </dev/null; sleep 2
  done
  S "rm -f $SF $SSTOP" >/dev/null
  say "  sampler file removed from the phone: $(S "ls $SF 2>/dev/null | wc -l") left"
  if [ "$NIGHT_CHANGED" = 1 ] && [ -n "$NIGHT_ORIG" ]; then S "cmd uimode night $NIGHT_ORIG" >/dev/null; say "  night mode restored to '$NIGHT_ORIG'"; fi
  local restored_dir=0
  if [ -n "$(S "[ -d $OUTFILE ] && echo d")" ] && [ "$DIRTY" = 1 ]; then S "rmdir $OUTFILE" >/dev/null; restored_dir=1; say "  removed the $OUTFILE directory"; fi
  ST=$(st)
  say "  state now: $ST"
  # the room back when a step left a fallback on (the app's own way: an event 60 s or more after the fallback began)
  if [ "$DIRTY" = 1 ] && [ "$P0_OK" = 1 ] && fallback_active; then
    say "  a fallback is still on: asking the app for its own way back"
    if [ "${FB_START_MS:-0}" -le 0 ]; then FB_START_MS=$(logms 0 'gesture fallback on' last); FB_START_MS=${FB_START_MS:-0}; fi
    way_back END; say "  way back result $? (0 = room back), triggers tried:$WB_TRIGGERS"
  fi
  if [ "$DIRTY" = 1 ] && [ "$P0_OK" = 1 ]; then
    # the row may need a moment after the last step
    for i in $(seq 1 20); do ST=$(st); is_held && is_room && break; sleep 1.5; done
    shot_pair END
  fi
  [ "$P0_OK" = 1 ] && [ "$DIRTY" = 1 ] && S input keyevent KEYCODE_HOME >/dev/null
  sleep 2
  ST=$(st)
  say "final :: $ST"
  say "baseline :: $BASE_ST"
  local diffs=() ab focus inst dsi vnow
  focus=$(S 'dumpsys window | grep mCurrentFocus | tail -1' | sed 's/.*mCurrentFocus=//')
  inst=$(S 'dumpsys activity activities | grep -ci packageinstaller'); dsi=$(S 'ls /data/local/tmp/ds-install-* 2>/dev/null | wc -l'); vnow=$(vols)
  say "  focus: $focus; installer activity lines: $inst; ds-install files: $dsi; volumes: $vnow"
  if [ "$P0_OK" = 1 ]; then
    [ "$(stf mode)" = 0 ] || diffs+=("navigation_mode is $(stf mode) (baseline 0)")
    case "$(stf overlay)" in *threebutton*) ;; *) diffs+=("enabled navbar overlay is [$(stf overlay)] (baseline: threebutton)") ;; esac
    is_held || diffs+=("the row is not held (holder [$(stf holder)], shell records $(stf shellrec))")
    [ "$(stf barsBound)" = 1 ] || diffs+=("MelatonBarService is not bound (barsBound=$(stf barsBound))")
    [ "$(stf crashed)" = 0 ] || diffs+=("MelatonBarService is in 'Crashed services'")
    case "$focus" in *"$PKG"*) ;; *) diffs+=("the app's home is not in front (focus: $focus)") ;; esac
    [ "${inst:-0}" = 0 ] || diffs+=("installer activity lines: $inst (baseline 0)")
    [ "${dsi:-0}" = 0 ] || diffs+=("$dsi /data/local/tmp/ds-install-* file(s) left")
    [ "$vnow" = "$BASE_VOL" ] || diffs+=("volumes changed: [$BASE_VOL] -> [$vnow]")
    [ -z "$(S "[ -d $OUTFILE ] && echo d")" ] || diffs+=("$OUTFILE is still a directory")
    say "  versionCode: baseline $VC0 -> now $(stf vc) (changed on purpose by S1 when it ran); answer file [$(stf out)]; holders [$(stf holder)]"
  fi
  local final=$rc
  if [ ${#diffs[@]} -gt 0 ]; then
    say "FINAL STATE DIFFERS FROM THE BASELINE:"
    printf '%s\n' "${diffs[@]}" | sed 's/^/    - /' | tee -a "$LOG"
    say "HOW TO RESTORE: first  adb -s $DEV shell rmdir $OUTFILE  if it is a directory; then ask the app for its own way back: an event (KEYCODE_WAKEUP + KEYCODE_HOME, or a screen on) at least ${BACK_GAP_S} s after the fallback began; open the app's home (KEYCODE_HOME). Only when the app cannot recover (no 'gesture fallback off' after three events 65 s apart) restore by hand: settings put secure navigation_mode 0 and cmd overlay enable --user 0 com.android.internal.systemui.navbar.threebutton (and say so in the report)."
    [ "$final" = 0 ] && final=5
  elif [ "$P0_OK" = 1 ]; then say "FINAL STATE == BASELINE (navigation_mode 0, 3-button overlay, row held, Bars service bound, the app's home in front, no installer activity, no ds-install file, volumes unchanged)"; fi
  # the summary
  say "==== summary"
  local s anyfail=0 anyinc=0
  for s in "${ORDER[@]}"; do
    say "  $s: ${RES[$s]}"
    [ "${RES[$s]}" = FAIL ] && anyfail=1
    [ "${RES[$s]}" = INCONCLUSIVE ] && anyinc=1
  done
  say "evidence in $OUT (log.txt, sampler-*.txt, *-history-shell.txt, *-statusbar-full.txt, screenshots = illustrations only)"
  [ "$final" = 0 ] && [ $anyfail = 1 ] && final=1
  [ "$final" = 0 ] && [ $anyinc = 1 ] && final=4
  exit "$final"
}

# ------------------------------------------------------------------------------------------------ main
plan() {
  say "plan (--only '${ONLY:-all}'), phone $MODEL at $DEV, outdir $OUT:"
  say "  P0  model check, awake + unlocked (a53.sh unlock), navigation_mode 0 + 3-button overlay, row held, baseline"
  want S1 && say "  S1  install -r ${APK:-<apk>} (${VC:-<versionCode>}) once; sampler on; wait held (60 s); skipped when the phone already runs it"
  want S2 && say "  S2  install -r the same apk once more; sampler on; no recs=0; new holder first; history; app + service back; GRACE_S=$GRACE_S margin (waits ${COOLDOWN_S} s after any earlier app-killing step)"
  want S3 && say "  S3  adb tcpip 5555 + reconnect; held again within 10 s"
  want S4 && say "  S4  kill the holder once; held again; gap reported"
  want S5 && say "  S5  am crash <the main pid of $PKG> once; sampler on; recs=0 time; old holder exit vs GRACE_S; service bound again (waits ${COOLDOWN_S} s after an app-killing step)"
  want S6 && say "  S6  $OUTFILE as a directory + holder killed; #3 in a row, gesture fallback on; no flip back for ${NOFLIP_S} s; rmdir"
  want S7 && say "  S7  an event >= ${BACK_GAP_S} s after the fallback began; gesture fallback off, room back, hold before the overlay switch"
  want S8 && say "  S8  holder killed 5 times in a row; giving up the holds + gesture fallback on; then the way back as S7"
  say "  END remove the answer-file directory and the sampler file, restore the room, final state vs baseline"
}

trap 'say "interrupted"; exit 130' INT TERM
say "== #1371 proof ($SCRIPTNAME) on $MODEL ($DEV), $(date '+%F')${ONLY:+, only $ONLY}$([ "$DRY" = 1 ] && echo ', DRY RUN')"
if [ "$DRY" = 1 ]; then
  plan
  say "DRY RUN: the model check passed ($MODEL); the rest is read-only (getprop, dumpsys, settings get, cmd overlay list):"
  ST=$(st)
  say "st :: $ST"
  say "no unlock, no key, no install, no file written on the phone or in the repo; nothing changed."
  exit 0
fi
trap end_restore EXIT
plan
step_P0
want S1 && step_S1
want S2 && step_S2
want S3 && step_S3
want S4 && step_S4
want S5 && step_S5
want S6 && step_S6
want S7 && step_S7
want S8 && step_S8
exit 0
