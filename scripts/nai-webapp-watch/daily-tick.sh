#!/usr/bin/env bash
# Daily operator entry: cheap hash poll; full dump only when hashes change.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

POLL_JSON="$(node scripts/nai-webapp-watch/poll-hashes.js --json || true)"
status=0
echo "$POLL_JSON" | node -e '
const fs = require("fs");
const input = fs.readFileSync(0, "utf8");
const report = JSON.parse(input);
console.log("[nai-webapp-watch daily]", JSON.stringify({
  ok: report.ok,
  changed: report.changed,
  capturedAt: report.snapshot?.capturedAt
}));
process.exit(report.ok ? 0 : 2);
' || status=$?
if [ "$status" -ne 0 ]; then
  echo "[nai-webapp-watch daily] public hashes changed — run headed dump:" >&2
  echo "  ./scripts/nai-webapp-watch/dump-novelai-webapp.sh" >&2
  exit "$status"
fi

echo "[nai-webapp-watch daily] unchanged — no dump needed"
exit 0
