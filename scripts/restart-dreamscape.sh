#!/usr/bin/env bash
# Restart the Dreamscape server only when the restart gate approves (#1154, Yukimi Nov 24 2026).
#
#   bash scripts/restart-dreamscape.sh --why "<what the restart is for>" [--notify]
#
# 1. node scripts/restart-gate.js (prints the verdict and its reasons):
#      approved          -> restart
#      ask <agent>       -> stop (exit 10); with --notify the agents were asked in their agent-coord inbox
#      wait for <...>    -> stop (exit 20); run this again when that is over
#      denied for <...>  -> stop (exit 30); fix the reason first
# 2. pm2 restart Dreamscape exactly as director-idle-before-restart.mdc says (its own PM2 guard ran in the gate)
# 3. waits for http://127.0.0.1:9220/ to answer 200 (3 min at most), then prints the PM2 error log lines
#    of the first 60 seconds that look like errors.
set -u
cd "$(dirname "$0")/.." || exit 1

why=""
notify=""
while [ $# -gt 0 ]; do
    case "$1" in
        --why) why="${2:-}"; shift 2 ;;
        --notify) notify="--notify"; shift ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
[ -n "$why" ] || { echo 'say what the restart is for: --why "<reason>"' >&2; exit 2; }

node scripts/restart-gate.js --why "$why" $notify
code=$?
if [ "$code" -ne 0 ]; then
    echo "restart not done (gate exit $code)"
    exit "$code"
fi

echo "restarting Dreamscape: $why"
env -i HOME="$HOME" USER="$USER" PATH=/usr/local/bin:/usr/bin:/bin PM2_HOME="$HOME/.pm2" pm2 restart Dreamscape >/dev/null || { echo "pm2 restart failed"; exit 40; }
started=$(date +%s)

up=""
for _ in $(seq 1 90); do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:9220/ || true)
    if [ "$c" = "200" ]; then up=1; break; fi
    sleep 2
done
[ -n "$up" ] || { echo "Dreamscape did not answer 200 within 3 minutes: look at pm2 logs Dreamscape --nostream"; exit 41; }
echo "Dreamscape answers 200 ($(( $(date +%s) - started )) s after the restart)"

sleep 60
log=$(ls -t "$HOME"/.pm2/logs/Dreamscape-error*.log 2>/dev/null | head -1)
if [ -n "$log" ]; then
    since=$(date -d "@$started" '+%Y-%m-%dT%H:%M:%S')
    errs=$(awk -v s="$since" 'substr($0,1,19) >= s' "$log" | grep -E 'Error|TypeError|ReferenceError|Unhandled|FATAL' | grep -v 'Balance check error' | head -15)
    if [ -n "$errs" ]; then echo "errors in the first minute:"; echo "$errs"; else echo "no errors in the first minute"; fi
fi
exit 0
