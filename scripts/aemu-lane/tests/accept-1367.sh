#!/usr/bin/env bash
# StaticForge #1367 acceptance on one lane emulator (the caller holds its coord lease): a Dreamscape notice on the phone
# sounds exactly once. Test-lane notices to THIS device only; soft classes (sms, reminder); the emulator runs -no-audio
# (checked first), so nothing reaches a speaker. The ringer is set NORMAL (notification stream 2 of 7) for the run, so
# the app really starts its player, and is put back to silent at the end.
#
#   COORD_AGENT_ID=<id> scripts/aemu-lane/tests/accept-1367.sh <aemu-id> [--out DIR]
#
# Proof per scenario: the app's NoteAlerts lines (lane.sh sound --since: `playing <file>` = the app played it), the
# page's own sound log (wmShell.sounds.log: what the page played), and Android's player records for the app.
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
L=$HERE/lane.sh
ID=${1:?lane instance id}
shift
OUT=docs/testing/evidence/1367/device
[ "${1:-}" = --out ] && OUT=$2
mkdir -p "$OUT"
PKG=jp.net.seventhreeseven.dreamscape
LOG=$OUT/accept-1367.txt
: > "$LOG"
PASS=0
FAIL=0
RUN=$(date +%H%M%S)

say() { echo "$*" | tee -a "$LOG"; }
verdict() { if [ "$1" = 0 ]; then PASS=$((PASS + 1)); say "PASS  $2"; else FAIL=$((FAIL + 1)); say "FAIL  $2"; fi; }
now() { "$L" "$ID" now | python3 -c 'import json,sys; print(json.load(sys.stdin)["localMs"])'; }
ev() { "$L" "$ID" eval "$1" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("value",""))'; }
page_wait() { local i; for i in $(seq 1 45); do [ "$(ev 'String(!!(window.wmShell&&window.wmShell.sounds&&(document.documentElement.dataset.wmBoot||"done")==="done"&&window.wsClient&&window.wsClient.isConnected()))')" = true ] && return 0; sleep 2; done; return 1; }
page_log_len() { ev 'String(window.wmShell.sounds.log.length)'; }
page_log_since() { ev "JSON.stringify(window.wmShell.sounds.log.slice($1).map(x=>x.name+' '+x.file))"; }
# records every call the page makes on the app's bridge (shown / takeSound with the app's answer / hush); lost with the page
WRAP='(()=>{if(window.__takes)return "kept";const real=window.AndroidInbox;window.__takes=[];window.AndroidInbox={shown:(id)=>{window.__takes.push(["shown",id]);return real.shown(id)},takeSound:(a,b,c,d)=>{const r=real.takeSound(a,b,c,d);window.__takes.push(["takeSound",a,b,c,"awake="+d,"-> "+r]);return r},hush:(i)=>{window.__takes.push(["hush",i]);return real.hush(i)}};return "wrapped"})()'
calls_reset() { ev "$WRAP" >/dev/null; ev 'window.__takes.length=0; ""' >/dev/null; }
calls() { ev 'JSON.stringify(window.__takes||[])'; }
# the app's answer to the page's takeSound for this notice: "page", "app" or "" (never asked)
answer() { python3 -c 'import json,sys; a=[c[-1][3:] for c in json.loads(sys.argv[1] or "[]") if c[0]=="takeSound" and c[1]==sys.argv[2]]; print(a[0] if a else "")' "$1" "$2"; }
page_sounds() { python3 -c 'import json,sys; print(len([x for x in json.loads(sys.argv[1]) if not x.endswith("android/chosen")]))' "$1"; }
notice() { # notice <id> <cls> <title>
    "$L" "$ID" notice push "{\"id\":\"$1\",\"cls\":\"$2\",\"app\":\"messaging\",\"alert\":true,\"title\":\"$3\",\"text\":\"#1367 lane check\",\"actions\":[\"view\"],\"data\":{\"app\":\"messaging\",\"kind\":\"test\"}}" > "$OUT/.push.json" 2>&1
    say "  pushed $1 ($2): $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("sent", d.get("sent"), "route", d.get("route","one-device"))' "$OUT/.push.json" 2>/dev/null || head -c 160 "$OUT/.push.json")"
}
clear_notice() { "$L" "$ID" notice clear "$1" >/dev/null 2>&1; }
collect() { # collect <since> <label> -> writes <label>.json, prints the app's lines, sets APP_PLAYS
    "$L" "$ID" sound --since "$1" > "$OUT/$2.json"
    python3 - "$OUT/$2.json" <<'EOF' | tee -a "$LOG"
import json, sys
d = json.load(open(sys.argv[1]))
for n in d["sources"]["noteAlerts"]:
    print("    NoteAlerts +%5.1fs  %s" % ((n["atMs"] - d["sinceMs"]) / 1000.0, n["line"][:200]))
print("    app plays (NoteAlerts 'playing'): %d; sound decisions: %d; alarm-like players: %d" % (d["playedCount"], d["count"], d["alarmLikeStarted"]))
EOF
    APP_PLAYS=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["playedCount"])' "$OUT/$2.json")
    ALARMS=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["alarmLikeStarted"])' "$OUT/$2.json")
    [ "$ALARMS" = 0 ] || verdict 1 "$2: an alarm-like player started"
}
kill_page() {
    "$L" "$ID" other >/dev/null
    sleep 2
    "$L" "$ID" kill-app >/dev/null
    local i
    for i in $(seq 1 40); do [ -n "$("$L" "$ID" sh "pidof $PKG" 2>/dev/null | tr -d '\r')" ] && break; sleep 2; done
    sleep 20 # the process is back for its services; its link says hello and catches up
    local r
    r=$("$L" "$ID" sh 'ps -A -o NAME | grep -c "sandboxed_process.*dreamscape\|webview.*sandboxed" ' 2>/dev/null | tr -d '\r')
    say "  app killed; back for its services as pid $("$L" "$ID" sh "pidof $PKG" | tr -d '\r'); top activity: $("$L" "$ID" sh 'dumpsys activity activities | grep -m1 topResumedActivity' | tr -d '\r' | sed 's/.* u0 //; s/ .*//')"
}

"$L" "$ID" status > "$OUT/.status.json"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["noAudio"] is True, "the emulator has audio: stop"; print("  %s: noAudio %s, app versionCode %s" % (d["id"], d["noAudio"], d["appVersionCode"]))' "$OUT/.status.json" | tee -a "$LOG" || exit 1
say "StaticForge #1367 device acceptance, $(date '+%F %T %Z')"
# the ringer first, then a fresh page: the page caches Android's levels for up to 30 s, and a change made from a shell
# sends it no event (a page started under the lane's silent ringer stays silent and proves nothing)
"$L" "$ID" sh 'cmd audio set-ringer-mode NORMAL; cmd audio set-volume 5 2' >/dev/null 2>&1
trap '"$L" "$ID" sh "cmd audio set-ringer-mode SILENT" >/dev/null 2>&1' EXIT
"$L" "$ID" stop-app >/dev/null; sleep 2; "$L" "$ID" start-app >/dev/null; sleep 3
page_wait || { say "the page did not come up"; exit 1; }
[ "$(ev 'String(window.wmShell.sounds.silent())')" = false ] || { say "the page is silent: this run would prove nothing"; exit 1; }
say "  sound picks on the phone: $(ev 'JSON.stringify((JSON.parse(localStorage.getItem("wmSounds")||"{}").ev)||{})'); reminder $(ev 'JSON.stringify(window.wmShell.sounds.eventPrefs("reminder"))'); sms $(ev 'JSON.stringify(window.wmShell.sounds.eventPrefs("sms"))')"
sleep 8

say ""; say "1. A notice with the page in front: one sound"
sleep 6; calls_reset; n0=$(page_log_len); t=$(now); id=test:1367:front:$RUN
notice "$id" sms "Lane 1367 front"; sleep 14
collect "$t" 1-front
p=$(page_log_since "$n0"); c=$(calls); say "    page calls: $c"; say "    page sounds: $p"
total=$((APP_PLAYS + $(page_sounds "$p")))
[ "$total" = 1 ] && [ "$(answer "$c" "$id")" = page ]; verdict $? "front: $total sound(s) in all (app $APP_PLAYS, page $(page_sounds "$p")); the app answered the page '$(answer "$c" "$id")'"
clear_notice "$id"; sleep 4

say ""; say "2. The same with the page asleep (another program in front), then resumed: still one sound"
# The test lane is ONE queue for every lane emulator: another instance's page on screen marks a test notice seen at
# once, and an ordinary notice is then rightly not drawn again here. A reminder is drawn again on resume whatever its
# state until it is dismissed, so it always takes the page's resume path. Its Repeat is off on this phone for this step
# (one sound expected), and the phone's own sound options are put back after.
"$L" "$ID" start-app >/dev/null 2>&1; page_wait; sleep 4
had=$(ev 'localStorage.getItem("wmSounds")||""')
ev '(()=>{const s=window.wmShell.sounds;const p=s.prefs();p.ev.reminder=Object.assign({},p.ev.reminder,{repeat:false});s.setPrefs(p);return "repeat off"})()' >/dev/null; sleep 4
say "  reminder here: $(ev 'JSON.stringify(window.wmShell.sounds.eventPrefs("reminder"))')"
calls_reset; n0=$(page_log_len); "$L" "$ID" other >/dev/null; sleep 5; t=$(now); id=rem:test:1367:asleep:$RUN
notice "$id" reminder "Lane 1367 asleep reminder"; sleep 14
say "  before resume:"; collect "$t" 2a-asleep
before=$APP_PLAYS
"$L" "$ID" start-app >/dev/null 2>&1; sleep 20
say "  after resume:"; collect "$t" 2b-resumed
boxes=$(ev 'String(window.wmNotificationInbox.shown().filter(i=>i.startsWith("rem:test:1367:asleep")).length)')
p=$(page_log_since "$n0"); c=$(calls); say "    page calls: $c"; say "    page sounds: $p; the page's box for it after resume: $boxes"
total=$((APP_PLAYS + $(page_sounds "$p")))
[ "$before" = 1 ] && [ "$total" = 1 ] && [ "$boxes" = 1 ] && [ "$(answer "$c" "$id")" = app ]; verdict $? "asleep then resumed: $total sound(s) in all (app $APP_PLAYS, $before of them before the resume, page $(page_sounds "$p")); the page drew its box on resume and the app answered '$(answer "$c" "$id")'"
clear_notice "$id"; sleep 3
ev "(()=>{const had=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$had");if(had)localStorage.setItem('wmSounds',had);else localStorage.removeItem('wmSounds');window.wmShell.sounds.setPrefs(window.wmShell.sounds.prefs());return 'restored'})()" >/dev/null; sleep 4
say "  sound options put back: reminder $(ev 'JSON.stringify(window.wmShell.sounds.eventPrefs("reminder"))')"

say ""; say "3. The same with the screen off, then on"
calls_reset; n0=$(page_log_len); "$L" "$ID" screen off >/dev/null; sleep 6; t=$(now); id=test:1367:screenoff:$RUN
notice "$id" sms "Lane 1367 screen off"; sleep 14
"$L" "$ID" screen on >/dev/null; "$L" "$ID" sh 'wm dismiss-keyguard' >/dev/null 2>&1; sleep 3; "$L" "$ID" start-app >/dev/null; sleep 20
collect "$t" 3-screen-off
p=$(page_log_since "$n0"); c=$(calls); say "    page calls: $c"; say "    page sounds: $p"
total=$((APP_PLAYS + $(page_sounds "$p")))
[ "$total" = 1 ]; verdict $? "screen off then on: $total sound(s) in all (app $APP_PLAYS, page $(page_sounds "$p"))"
clear_notice "$id"; sleep 4

say ""; say "4. A late claim: the page in front but stalled 9 s (longer than the app's 4 s wait): one sound"
page_wait; calls_reset; n0=$(page_log_len); t=$(now); id=test:1367:late:$RUN
ev 'setTimeout(()=>{const e=Date.now()+9000;while(Date.now()<e){}},300); "stalling"' >/dev/null
sleep 1; notice "$id" sms "Lane 1367 late claim"; sleep 22
collect "$t" 4-late-claim
p=$(page_log_since "$n0"); c=$(calls); say "    page calls: $c"; say "    page sounds: $p"
total=$((APP_PLAYS + $(page_sounds "$p")))
[ "$total" = 1 ] && [ "$(answer "$c" "$id")" = app ]; verdict $? "late claim: $total sound(s) in all (app $APP_PLAYS, page $(page_sounds "$p")); the late page was answered '$(answer "$c" "$id")'"
clear_notice "$id"; sleep 4

say ""; say "5. A repeating class (Reminders) with the page killed: 1 + 4 repeats, 4 s apart"
kill_page; t=$(now); id=test:1367:repeat:$RUN
notice "$id" reminder "Lane 1367 repeat"; sleep 30
collect "$t" 5-repeat-killed
[ "$APP_PLAYS" = 5 ]; verdict $? "repeat with the page killed: $APP_PLAYS plays (expected 5)"
clear_notice "$id"; sleep 4

say ""; say "6. The same, dismissed (a clear) while it repeats: it stops"
t=$(now); id=test:1367:repeatstop:$RUN
notice "$id" reminder "Lane 1367 repeat stop"; sleep 6
clear_notice "$id"; say "  cleared about 6 s after the push"; sleep 20
collect "$t" 6-repeat-cleared
[ "$APP_PLAYS" -ge 1 ] && [ "$APP_PLAYS" -le 3 ] && grep -q 'repeat stopped' "$OUT/6-repeat-cleared.json"; verdict $? "repeat stops at the dismissal: $APP_PLAYS plays"

say ""; say "7. The workspace's scheme \"No Sounds\", then the page killed: none"
"$L" "$ID" start-app >/dev/null; sleep 3; page_wait || say "  the page did not come up"
sleep 6
# in this page only (save:false): the workspace's stored scheme, which the desktop shares, is not touched
ev 'window.desktopPersonalization.update({soundScheme:"none"},{save:false}); "No Sounds"' >/dev/null; sleep 5
say "  scheme in the page: $(ev 'window.desktopPersonalization.get().soundScheme')"
"$L" "$ID" su "cat /data/data/$PKG/shared_prefs/note_sounds.xml" 2>/dev/null | python3 -c '
import sys,re,html,json
o=json.loads(html.unescape(re.search(r"<string name=\"table\">(.*?)</string>",sys.stdin.read(),re.S).group(1)))
loud=[k for k,v in o.items() if v.get("sound")]
print("  the app\x27s stored table: %d entries, with a sound: %d %s" % (len(o),len(loud),loud))' | tee -a "$LOG"
kill_page; t=$(now); id=test:1367:nosounds:$RUN
notice "$id" reminder "Lane 1367 no sounds"; sleep 14
notice "$id-b" sms "Lane 1367 no sounds text"; sleep 14
collect "$t" 7-no-sounds-killed
[ "$APP_PLAYS" = 0 ]; verdict $? "No Sounds with the page killed: $APP_PLAYS plays (expected 0)"
clear_notice "$id"; clear_notice "$id-b"
"$L" "$ID" start-app >/dev/null; sleep 3; page_wait; sleep 8
say "  the page again (stored scheme: $(ev 'window.desktopPersonalization.get().soundScheme')): the table is sent anew"

rm -f "$OUT/.push.json" "$OUT/.status.json"
say ""; say "accept-1367: $PASS PASS, $FAIL FAIL"
[ "$FAIL" = 0 ]
