#!/usr/bin/env bash
# Apply StaticForge automation overlay onto an unpacked ResourcesSaverExt tree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_UNPACKED="${1:-}"

if [ -z "$TARGET_UNPACKED" ]; then
  echo "Usage: $0 <path-to-unpacked2x>" >&2
  exit 2
fi

if [ ! -f "$TARGET_UNPACKED/manifest.json" ]; then
  echo "[nai-webapp-dump] missing manifest.json under $TARGET_UNPACKED" >&2
  exit 1
fi

cp -f "$SCRIPT_DIR/automation-bridge.js" "$TARGET_UNPACKED/automation-bridge.js"

python3 - "$TARGET_UNPACKED/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    manifest = json.load(f)

bridge = "automation-bridge.js"
scripts = manifest.setdefault("content_scripts", [])
already = any(
    isinstance(s, dict) and bridge in (s.get("js") or [])
    for s in scripts
)
if not already:
    scripts.append({
        "matches": ["http://*/*", "https://*/*"],
        "js": [bridge],
        "run_at": "document_start",
        "all_frames": False,
    })

# Ensure host permissions cover novelai (already broad upstream).
host = set(manifest.get("host_permissions") or [])
host.update(["http://*/", "https://*/"])
manifest["host_permissions"] = sorted(host)

with open(path, "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
print("[nai-webapp-dump] patched manifest:", path)
PY

# Marker for dump script / operators
cat > "$TARGET_UNPACKED/.staticforge-automation.json" <<JSON
{
  "overlay": "scripts/nai-webapp-watch/extension-automation",
  "protocol": ["RESOURCES_SAVER_AUTOMATION_SAVE", "RESOURCES_SAVER_AUTOMATION_SAVE_RESULT"]
}
JSON

echo "[nai-webapp-dump] automation overlay applied → $TARGET_UNPACKED"
