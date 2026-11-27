#!/usr/bin/env bash
# Own headless Chromium for the #1408 repro (never the shared :9333, Ruiko's Chrome or a phone).
# The profile is kept off /tmp (a small tmpfs); it holds a signed-in session, so delete it when done.
#   browser.sh start|stop
#   PROFILE=name CDP_PORT=n    a second profile on its own port (old and new code side by side)
#   CPUSET=0 browser.sh start   pins the whole browser (renderer, service worker, storage) to those cores
set -euo pipefail
BASE="$HOME/.cache/claude-run/1408"
PORT="${CDP_PORT:-9361}"
UA='Mozilla/5.0 (Linux; Android 14; SM-A536E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.0.0 Mobile Safari/537.36'
PROF="${PROFILE:-prof}"
mkdir -p "$BASE/$PROF" "$BASE/tmp"
case "${1:-}" in
start)
    if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then echo "already up on :$PORT"; exit 0; fi
    PRE=()
    if [ -n "${CPUSET:-}" ]; then PRE=(taskset -c "$CPUSET"); fi
    TMPDIR="$BASE/tmp" setsid "${PRE[@]}" chromium --headless=new --remote-debugging-port="$PORT" \
        --remote-debugging-address=127.0.0.1 --user-data-dir="$BASE/$PROF" --user-agent="$UA" \
        --no-first-run --no-default-browser-check --mute-audio --window-size=412,915 \
        --disable-background-timer-throttling --disable-renderer-backgrounding \
        about:blank >"$BASE/chromium-$PROF.log" 2>&1 &
    echo $! >"$BASE/chromium-$PROF.pid"
    for _ in $(seq 1 60); do
        curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && { echo "up on :$PORT"; exit 0; }
        read -r -t 0.5 <> <(:) || true
    done
    echo "browser did not come up" >&2; exit 1 ;;
stop)
    if [ -f "$BASE/chromium-$PROF.pid" ]; then
        PGID="$(cat "$BASE/chromium-$PROF.pid")"
        kill -TERM -- "-$PGID" 2>/dev/null || true
        for _ in $(seq 1 40); do
            curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || break
            read -r -t 0.25 <> <(:) || true
        done
        rm -f "$BASE/chromium-$PROF.pid"
    fi
    echo stopped ;;
*) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
