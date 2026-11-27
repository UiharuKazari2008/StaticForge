#!/bin/bash
# accept-1272.sh <lane-id> [--out DIR]
#
# The example phone acceptance on the lane (StaticForge #1309 / #1312, the acceptance of #1272: "a text notice sounds with the
# event's sound while the page is killed"). Later items copy this script and change step 3 (the notice) and the asserts.
#
#   1  page killed       the app process is killed (root kill -9, as the low-memory killer does); Android restarts the app for its
#                        services only: a process, no WebView renderer, no activity in front; the server sees the device online as a
#                        service with the page not in front. The script waits for exactly that.
#   2  mark              NOW on the server's clock (the sound check reads logs since then)
#   3  one text notice   the real shape of a text (cls sms, app messaging, data.kind sms + accountId + chatGuid, id sms:<account>:<chat>),
#                        for THIS device only (POST /api/test-devices/<id>/notice -> that device's catch-up)
#   4  shade             the notification shade is opened and captured; notifs lists the app's posted notification
#   5  sound             `sound --since NOW`: exactly one decision, naming the sms event's sound (never an Alarm-family file),
#                        nothing alarm-like started. The lane runs -no-audio with the ringer silent, so the app logs what it WOULD
#                        play ("ringer 0, sound online.mp3") and plays nothing: the decision is the proof
#   6  server clear      POST /api/test-devices/notice/<id>/clear: the app's Android notification goes (notifs empty, shade shot)
# Prints PASS / FAIL per check; exit 0 only when all passed. Needs the lease of <lane-id> (coord_device_request) held by $COORD_AGENT_ID.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LANE=$HERE/../lane.sh
ID=${1:?usage: accept-1272.sh <lane-id> [--out DIR]}; shift
OUT=${TMPDIR:-/tmp}/accept-1272-$ID-$(date +%Y%m%d-%H%M%S)
while [ $# -gt 0 ]; do case "$1" in --out) OUT=${2:?--out DIR}; shift 2;; *) echo "unknown argument: $1" >&2; exit 2;; esac; done
mkdir -p "$OUT"
AGENT=${COORD_AGENT_ID:-${AGENT_COORD_ID:-claude-${CLAUDE_CODE_SESSION_ID:0:8}}}
L() { "$LANE" --agent "$AGENT" "$ID" "$@"; }
FAIL=0
say() { echo "[accept-1272 $ID] $*"; }
ok() { echo "PASS  $*"; }
no() { echo "FAIL  $*"; FAIL=1; }
jq_() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

ACCOUNT=lane-acct; CHAT=lane-chat-1272; NID="sms:$ACCOUNT:$CHAT"

# ---- 1 page killed
say "1. page killed (the app process is killed; the app comes back for its services only)"
L status > "$OUT/status-before.json" || { no "status"; exit 1; }
L kill-app > "$OUT/kill-app.json"
L kill-page >/dev/null
up=0
for i in $(seq 1 24); do   # up to 2 minutes
  sleep 5
  pid=$(L sh 'pidof jp.net.seventhreeseven.dreamscape' 2>/dev/null | tr -d '\r' | awk '{print $1}')
  [ -n "$pid" ] || continue
  rend=$(L sh "ps -A -o NAME | grep -c -E 'sandboxed_process|webview_service'" | tr -d '\r')
  top=$(L sh "dumpsys activity activities | grep -m1 topResumedActivity" | tr -d '\r')
  case "$top" in *dreamscape*) continue;; esac
  [ "${rend:-0}" = 0 ] && { up=$pid; break; }
done
if [ "$up" != 0 ]; then ok "page killed: the app runs (pid $up) with no WebView renderer and no activity of its own in front"; else no "the app did not come back for its services only within 2 minutes (pid '${pid:-}', renderers ${rend:-?}, top '${top:-}')"; fi
# the server's view of the device (online as a service, the page not in front)
DEV=$(L status | jq_ "d['deviceId']")
key=$(tr -d '[:space:]' < ~/.secrets/dreamscape-claude.key)
view() { curl -sS -m 20 -H "Authorization: Bearer $key" -H "X-StaticForge-App-Key: $key" -H 'User-Agent: claude-code' http://127.0.0.1:9220/api/test-devices | python3 -c "
import json,sys
d=json.load(sys.stdin)
for x in d.get('devices',[]):
    if x['id']==sys.argv[1]: print(json.dumps({k:x.get(k) for k in ('online','partner','service','pageInFront')}))" "$DEV"; }
for i in $(seq 1 12); do v=$(view); echo "$v" | grep -q '"service": true\|"service":true' && break; sleep 5; done
echo "$v" > "$OUT/server-view.json"
echo "$v" | grep -q '"pageInFront": false\|"pageInFront":false' && echo "$v" | grep -q '"service": true\|"service":true' && ok "server: $v" || no "server view: ${v:-none}"
L cdp >/dev/null 2>&1 && no "a WebView page is still reachable over DevTools" || ok "no WebView page (DevTools has none)"

# ---- 2 mark, 3 the notice
NOW=$(L now | jq_ "d['localMs']")
say "2. mark: NOW=$NOW (server clock, ms)"
body=$(python3 - "$NID" "$ACCOUNT" "$CHAT" <<'PY'
import json,sys
nid,acct,chat=sys.argv[1:4]
print(json.dumps({"id":nid,"cls":"sms","app":"messaging","alert":True,"title":"New Text Message","text":"From: Lane acceptance\nA text with the page killed (#1272)","actions":["reply"],
  "data":{"app":"messaging","kind":"sms","accountId":acct,"chatGuid":chat,"from":"Lane acceptance","text":"A text with the page killed (#1272)"}}))
PY
)
say "3. one text notice for this device only"
L notice push "$body" > "$OUT/notice.json"; cat "$OUT/notice.json" | cut -c1-300
sleep 10
# ---- 4 shade, notifs
say "4. shade and the app's posted notifications"
L notifs > "$OUT/notifs-after.json"
L shade "$OUT/shade-with-notice.png" > "$OUT/shade.json"
python3 - "$OUT/notifs-after.json" <<'PY' && ok "notifs: the sms notice is posted ($(python3 -c "import json,sys; print([ (n.get('title'),n.get('channel')) for n in json.load(open(sys.argv[1]))][:3])" "$OUT/notifs-after.json"))" || no "notifs: no posted notification with the text (see $OUT/notifs-after.json)"
import json,sys
n=json.load(open(sys.argv[1]))
sys.exit(0 if any('Text' in (x.get('title') or '') or 'acceptance' in (x.get('text') or '') for x in n) else 1)
PY
say "shade shot: $OUT/shade-with-notice.png"

# ---- 5 sound
say "5. sound since NOW"
L sound --since "$NOW" > "$OUT/sound.json"
python3 - "$OUT/sound.json" <<'PY'
import json,sys,re
d=json.load(open(sys.argv[1]))
dec=d['sounds']; bad=[]
if d['count']!=1: bad.append('decisions=%d (want exactly 1)'%d['count'])
for s in dec:
    f=(s.get('file') or '')
    if re.match(r'(?i)alarm-?\d',f): bad.append('Alarm-family file '+f)
if d['alarmLikeStarted']!=0: bad.append('alarmLikeStarted=%d'%d['alarmLikeStarted'])
print(('FAIL  sound: ' if bad else 'PASS  sound: ')+(('; '.join(bad)) if bad else 'one decision %s'%json.dumps([{k:s.get(k) for k in ('file','sha256Prefix','ringer','silentByRinger')} for s in dec])))
sys.exit(1 if bad else 0)
PY
[ $? = 0 ] || FAIL=1

# ---- 6 server clear
say "6. server clear"
L notice clear "$NID" > "$OUT/clear.json"; cat "$OUT/clear.json"; echo
sleep 6
L notifs > "$OUT/notifs-cleared.json"
L shade "$OUT/shade-cleared.png" >/dev/null
python3 - "$OUT/notifs-cleared.json" <<'PY' && ok "after the clear the sms notification is gone" || no "the sms notification is still posted after the server clear"
import json,sys
n=json.load(open(sys.argv[1]))
sys.exit(1 if any('Text' in (x.get('title') or '') or 'acceptance' in (x.get('text') or '') for x in n) else 0)
PY
say "shade shot after the clear: $OUT/shade-cleared.png"
say "evidence in $OUT"
exit $FAIL
