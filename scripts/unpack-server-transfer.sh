#!/usr/bin/env bash
# Restore a Dreamscape transfer archive onto a host (existing clone or empty directory).
#
# Usage:
#   bash scripts/unpack-server-transfer.sh -i ARCHIVE.tar.zst [-d DEST] [options]
#
# Options:
#   -i, --input PATH      .tar.zst archive (required)
#   -d, --dest PATH       Project root to restore into (default: parent of this script)
#   --force               Overwrite existing paths without prompting
#   --verify              Run manifest verify after extract
#   --no-install          Skip configure-nekoai + pnpm install at end
#   -h, --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

INPUT=""
DEST="$ROOT"
FORCE=0
VERIFY=0
RUN_INSTALL=1

usage() {
    sed -n '2,13p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -i|--input) INPUT="$2"; shift 2 ;;
        -d|--dest) DEST="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --verify) VERIFY=1; shift ;;
        --no-install) RUN_INSTALL=0; shift ;;
        -h|--help) usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

if [[ -z "$INPUT" ]]; then
    echo "ERROR: -i/--input required" >&2
    usage 1
fi

if [[ ! -f "$INPUT" ]]; then
    echo "ERROR: archive not found: $INPUT" >&2
    exit 1
fi

if ! command -v zstd >/dev/null 2>&1; then
    echo "ERROR: zstd required" >&2
    exit 1
fi

MANIFEST="${INPUT%.tar.zst}.manifest.json"
if [[ ! -f "$MANIFEST" ]]; then
    MANIFEST=""
    echo "Note: no sidecar manifest (${INPUT%.tar.zst}.manifest.json)"
fi

mkdir -p "$DEST"

if [[ "$FORCE" -eq 0 ]]; then
    for probe in images .cache config.json; do
        if [[ -e "$DEST/$probe" ]]; then
            echo "ERROR: $DEST/$probe already exists. Use --force or choose an empty directory." >&2
            exit 1
        fi
    done
fi

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "Extracting $INPUT -> $TMP ..."
zstd -d -q -c "$INPUT" | tar -C "$TMP" -xf -

STAGE="$TMP/dreamscape-transfer"
if [[ ! -d "$STAGE" ]]; then
    echo "ERROR: archive missing dreamscape-transfer/ prefix" >&2
    exit 1
fi

echo "Installing into $DEST ..."
shopt -s dotglob nullglob

# App source first (full transfer), then data overlays
if [[ -d "$STAGE/app" ]]; then
    echo "  app/ -> $DEST"
    cp -a "$STAGE/app/." "$DEST/"
fi

for item in "$STAGE"/*; do
    base="$(basename "$item")"
    [[ "$base" == "app" ]] && continue
    if [[ -d "$item" ]]; then
        echo "  $base/ -> $DEST/$base"
        mkdir -p "$DEST/$base"
        cp -a "$item/." "$DEST/$base/"
    elif [[ -f "$item" ]]; then
        echo "  $base -> $DEST/$base"
        cp -a "$item" "$DEST/$base"
    fi
done

if [[ "$VERIFY" -eq 1 && -n "$MANIFEST" ]]; then
    echo "Verifying manifest ..."
    node "$DEST/scripts/transfer-manifest.js" verify --root "$DEST" --manifest "$MANIFEST"
fi

echo ""
echo "Unpack complete."

if [[ "$RUN_INSTALL" -eq 1 && -f "$DEST/package.json" ]]; then
    echo "Running setup (deps + bootstrap; root required) ..."
    run_setup() {
        DREAMSCAPE_APP_ROOT="$DEST" bash "$DEST/scripts/setup.sh" --skip-apt
    }
    if [[ "$(id -u)" -eq 0 ]]; then
        run_setup
    elif command -v sudo >/dev/null 2>&1; then
        sudo env DREAMSCAPE_APP_ROOT="$DEST" bash "$DEST/scripts/setup.sh" --skip-apt
    else
        echo "ERROR: setup requires root. Re-run: sudo bash scripts/unpack-server-transfer.sh ..." >&2
        exit 1
    fi
else
    echo "Next steps:"
    echo "  cd \"$DEST\""
    echo "  node scripts/configure-nekoai.js   # optional: NEKOAI_JS_SOURCE=local ..."
    echo "  pnpm install"
fi

echo "  node web_server.js"
