#!/usr/bin/env bash
# Download Chrome for Testing into a gitignored cache and print CHROME_BIN.
# Branded google-chrome-stable 151.x ignores --load-extension; CFT does not.
# Do not commit the browser binary.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="${DUMP_CFT_DIR:-$ROOT/.cache/chrome-for-testing}"
MAJOR="${DUMP_CFT_MAJOR:-152}"
EXACT="${DUMP_CFT_VERSION:-}"
MILESTONE_JSON="https://googlechromelabs.github.io/chrome-for-testing/latest-versions-per-milestone-with-downloads.json"
LKG_JSON="https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"

usage() {
  cat <<'EOF'
Usage: ./scripts/nai-webapp-watch/install-chrome-for-testing.sh

Downloads Chrome for Testing into .cache/chrome-for-testing/ (gitignored)
and prints the CHROME_BIN path.

Env:
  DUMP_CFT_MAJOR=152          Pin major (default 152; verified with ResourcesSaverExt)
  DUMP_CFT_VERSION=x.y.z.w    Pin an exact CFT version instead of latest for the major
  DUMP_CFT_DIR=/path          Cache directory (default: <repo>/.cache/chrome-for-testing)

Verified: Chrome for Testing 152.0.7977.64 loads ResourcesSaverExt under
--headless=new. Branded google-chrome-stable 151.0.7922.169 ignores
--load-extension (Hangouts background_page; dump times out).
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[nai-webapp-dump-setup] curl is required to download Chrome for Testing" >&2
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "[nai-webapp-dump-setup] unzip is required (sudo apt install unzip)" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[nai-webapp-dump-setup] python3 is required to resolve CFT download JSON" >&2
  exit 1
fi

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os" in
    linux)
      case "$arch" in
        x86_64|amd64) echo linux64 ;;
        aarch64|arm64) echo linux-arm64 ;;
        *) echo "[nai-webapp-dump-setup] unsupported Linux arch: $arch" >&2; return 1 ;;
      esac
      ;;
    darwin)
      case "$arch" in
        arm64) echo mac-arm64 ;;
        x86_64) echo mac-x64 ;;
        *) echo "[nai-webapp-dump-setup] unsupported macOS arch: $arch" >&2; return 1 ;;
      esac
      ;;
    mingw*|msys*|cygwin*)
      echo win64
      ;;
    *)
      echo "[nai-webapp-dump-setup] unsupported OS: $os" >&2
      return 1
      ;;
  esac
}

chrome_relpath() {
  case "$1" in
    linux64) echo "chrome-linux64/chrome" ;;
    linux-arm64) echo "chrome-linux-arm64/chrome" ;;
    mac-arm64) echo "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ;;
    mac-x64) echo "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ;;
    win64) echo "chrome-win64/chrome.exe" ;;
    win32) echo "chrome-win32/chrome.exe" ;;
    *) return 1 ;;
  esac
}

PLATFORM="$(detect_platform)"
echo "[nai-webapp-dump-setup] Chrome for Testing platform=$PLATFORM major=${EXACT:-$MAJOR} cache=$CACHE"

RESOLVE_JSON="$(MAJOR="$MAJOR" EXACT="$EXACT" PLATFORM="$PLATFORM" MILESTONE_JSON="$MILESTONE_JSON" LKG_JSON="$LKG_JSON" python3 - <<'PY'
import json, os, sys, urllib.request

platform = os.environ["PLATFORM"]
major = os.environ.get("MAJOR") or "152"
exact = os.environ.get("EXACT") or ""
milestone_url = os.environ["MILESTONE_JSON"]
lkg_url = os.environ["LKG_JSON"]

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "staticforge-cft-setup"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def chrome_url(downloads, plat):
    for item in (downloads or {}).get("chrome") or []:
        if item.get("platform") == plat and item.get("url"):
            return item["url"]
    return None

def emit(version, url, source):
    json.dump({"version": version, "url": url, "platform": platform, "source": source}, sys.stdout)
    sys.stdout.write("\n")

if exact:
    url = "https://storage.googleapis.com/chrome-for-testing-public/%s/%s/chrome-%s.zip" % (
        exact, platform, platform
    )
    emit(exact, url, "DUMP_CFT_VERSION")
    raise SystemExit(0)

milestones = fetch(milestone_url).get("milestones") or {}
entry = milestones.get(str(major))
url = chrome_url(entry.get("downloads") if entry else None, platform)
if entry and url:
    emit(entry.get("version") or exact, url, "milestone-" + str(major))
    raise SystemExit(0)

# linux-arm64 is missing on 152; fall back to last-known-good Stable, then newest milestone with this platform.
lkg = fetch(lkg_url)
stable = (lkg.get("channels") or {}).get("Stable") or {}
url = chrome_url(stable.get("downloads"), platform)
if url:
    print("[nai-webapp-dump-setup] milestone %s has no %s build; using last-known-good Stable %s" % (
        major, platform, stable.get("version")
    ), file=sys.stderr)
    emit(stable.get("version"), url, "lkg-stable")
    raise SystemExit(0)

ranked = []
for ms, data in milestones.items():
    try:
        n = int(ms)
    except ValueError:
        continue
    u = chrome_url((data or {}).get("downloads"), platform)
    if u:
        ranked.append((n, (data or {}).get("version"), u))
ranked.sort(reverse=True)
if ranked:
    n, version, u = ranked[0]
    print("[nai-webapp-dump-setup] no Stable %s build; using newest milestone %s (%s)" % (
        platform, n, version
    ), file=sys.stderr)
    emit(version, u, "milestone-" + str(n))
    raise SystemExit(0)

print("[nai-webapp-dump-setup] no Chrome for Testing build for platform %s" % platform, file=sys.stderr)
raise SystemExit(1)
PY
)"

VERSION="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["version"])' "$RESOLVE_JSON")"
URL="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$RESOLVE_JSON")"
SOURCE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["source"])' "$RESOLVE_JSON")"
REL="$(chrome_relpath "$PLATFORM")"
DEST="$CACHE/${PLATFORM}-${VERSION}"
BIN="$DEST/$REL"

mkdir -p "$CACHE"

if [ -e "$BIN" ]; then
  echo "[nai-webapp-dump-setup] already installed: $BIN"
else
  echo "[nai-webapp-dump-setup] downloading $SOURCE $VERSION"
  echo "[nai-webapp-dump-setup] $URL"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  ZIP="$TMP/chrome.zip"
  curl -fsSL --retry 3 -o "$ZIP" "$URL"
  mkdir -p "$DEST"
  unzip -q -o "$ZIP" -d "$DEST"
  trap - EXIT
  rm -rf "$TMP"
fi

if [ ! -e "$BIN" ]; then
  echo "[nai-webapp-dump-setup] download finished but chrome binary missing at $BIN" >&2
  exit 1
fi
chmod +x "$BIN" 2>/dev/null || true

echo "[nai-webapp-dump-setup] Chrome for Testing ready ($VERSION, $SOURCE)"
if "$BIN" --version >/dev/null 2>&1; then
  echo "[nai-webapp-dump-setup] $($BIN --version)"
fi
echo "[nai-webapp-dump-setup] CHROME_BIN=$BIN"
echo "[nai-webapp-dump-setup] export CHROME_BIN='$BIN'"
echo "[nai-webapp-dump-setup] Headless dump (CFT honors --load-extension):"
echo "[nai-webapp-dump-setup]   DUMP_HEADLESS=1 DUMP_CHROME_NO_SANDBOX=1 CHROME_BIN='$BIN' ./scripts/nai-webapp-watch/dump-novelai-webapp.sh"
echo "[nai-webapp-dump-setup] Do not commit $CACHE (gitignored)."
