#!/usr/bin/env bash
# Clean-install CI test: run scripts/install-linux.sh on a fresh machine/container, boot
# web_server.js, smoke-check HTTP, then re-run the installer to prove it is idempotent.
# Never run this on the production host. No secrets are needed or used.
#
# Usage: bash scripts/ci/clean-install-test.sh     (as root in ubuntu:24.04, or with sudo -n)
# Env:   BOOT_TIMEOUT (default 600s), PORT (default 9220), SKIP_REINSTALL=1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-600}"; PORT="${PORT:-9220}"
LOG="${RUNNER_TEMP:-/tmp}/dreamscape-boot.log"
fail=0; ok(){ echo "PASS $*"; }; bad(){ echo "FAIL $*"; fail=1; }

if [[ -f config.json && ! -f .clean-install-ci ]] && [[ "$(hostname)" == dreamscape ]]; then
  echo "refusing to run on the production host"; exit 2
fi
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl ca-certificates; }

echo "== install (1st run)"; t0=$(date +%s)
bash scripts/install-linux.sh --port "$PORT"; echo "install took $(( $(date +%s)-t0 ))s"
touch .clean-install-ci

echo "== boot"
node web_server.js >"$LOG" 2>&1 & PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
code=000; t0=$(date +%s)
while (( $(date +%s)-t0 < BOOT_TIMEOUT )); do
  kill -0 $PID 2>/dev/null || { bad "server exited during boot"; tail -40 "$LOG"; exit 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
  [[ "$code" != 000 ]] && break; sleep 2
done
[[ "$code" != 000 ]] && ok "listening after $(( $(date +%s)-t0 ))s" || { bad "no HTTP after ${BOOT_TIMEOUT}s"; tail -40 "$LOG"; exit 1; }
sleep 5

echo "== smoke"
for p in / /app; do
  c=$(curl -s -o /tmp/body -w '%{http_code}' "http://127.0.0.1:$PORT$p")
  [[ "$c" =~ ^(200|301|302|303|401)$ ]] && ok "GET $p -> $c" || bad "GET $p -> $c"
done
c=$(curl -sL -o /tmp/body -w '%{http_code}' "http://127.0.0.1:$PORT/")
grep -qi '<html' /tmp/body && ok "GET / (followed) -> $c html" || bad "GET / (followed) -> $c no html"
kill -0 $PID 2>/dev/null && ok "server still alive" || bad "server died"
echo "== boot log errors (informational)"
grep -iE 'error|cannot find module|ENOENT' "$LOG" | cut -c1-200 | sort | uniq -c | sort -rn | head -20 || true

kill $PID 2>/dev/null; wait $PID 2>/dev/null || true; trap - EXIT

if [[ "${SKIP_REINSTALL:-0}" != 1 ]]; then
  echo "== install (2nd run, idempotency)"
  sum() { sha256sum config.json secure.config.json | sha256sum; }
  before=$(sum)
  bash scripts/install-linux.sh --port "$PORT" >/tmp/reinstall.log 2>&1 && ok "re-run exit 0" || { bad "re-run failed"; tail -30 /tmp/reinstall.log; }
  [[ "$(sum)" == "$before" ]] && ok "config untouched on re-run" || bad "config changed on re-run"
  grep -q "apt packages already present" /tmp/reinstall.log && ok "apt skipped on re-run" || bad "apt not skipped"
fi
[[ $fail -eq 0 ]] && echo "CLEAN INSTALL: PASS" || echo "CLEAN INSTALL: FAIL"
exit $fail
