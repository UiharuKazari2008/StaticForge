#!/usr/bin/env bash
# Pack Dreamscape server state for migration. Streams tar + zstd (no full-disk copy).
#
# Usage:
#   bash scripts/pack-server-transfer.sh [options]
#
# Options:
#   -o, --output PATH     Archive base path without extension
#                         (default: ./dreamscape-transfer-YYYYMMDD-HHMMSS)
#   --data-only           Persistent data + config (default)
#   --full                Also include app source under dreamscape-transfer/app/
#   --exclude-images      Omit images/ and .previews/
#   --force               Pack while web_server.js is running (not recommended)
#   -h, --help

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="data"
OUTPUT_BASE=""
EXCLUDE_IMAGES=0
FORCE=0
PREFIX="dreamscape-transfer"

usage() {
    sed -n '2,14p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output) OUTPUT_BASE="$2"; shift 2 ;;
        --data-only) MODE="data"; shift ;;
        --full) MODE="full"; shift ;;
        --exclude-images) EXCLUDE_IMAGES=1; shift ;;
        --force) FORCE=1; shift ;;
        -h|--help) usage 0 ;;
        *) echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

if [[ -z "$OUTPUT_BASE" ]]; then
    OUTPUT_BASE="$ROOT/dreamscape-transfer-$(date +%Y%m%d-%H%M%S)"
fi

ARCHIVE="${OUTPUT_BASE}.tar.zst"
MANIFEST="${OUTPUT_BASE}.manifest.json"

if [[ "$FORCE" -eq 0 ]] && pgrep -f '[n]ode.*/web_server\.js' >/dev/null 2>&1; then
    echo "ERROR: web_server.js is running. Stop it first so SQLite is consistent." >&2
    echo "       Use --force to override." >&2
    exit 1
fi

if ! command -v zstd >/dev/null 2>&1; then
    echo "ERROR: zstd required (apt install zstd)" >&2
    exit 1
fi

ITEMS=()

if [[ "$EXCLUDE_IMAGES" -eq 0 ]]; then
    [[ -d "$ROOT/images" ]] && ITEMS+=("images")
    [[ -d "$ROOT/.previews" ]] && ITEMS+=(".previews")
fi

for dir in .cache logs securePrompts; do
    [[ -d "$ROOT/$dir" ]] && ITEMS+=("$dir")
done

for f in config.json secure.config.json prompt.config.json director.config.json \
         characters.json nax_generation_config.json \
         dataset_tags.json dataset_tags_furry.json dataset_tag_groups.json; do
    [[ -f "$ROOT/$f" ]] && ITEMS+=("$f")
done

if [[ "$MODE" == "full" ]]; then
    echo "Including application source (--full) ..."
    FULL_TAR=1
else
    FULL_TAR=0
fi

if [[ ${#ITEMS[@]} -eq 0 && "$FULL_TAR" -eq 0 ]]; then
    echo "ERROR: nothing to pack (paths missing?)" >&2
    exit 1
fi

echo "Writing manifest ..."
node "$ROOT/scripts/transfer-manifest.js" write \
    --root "$ROOT" \
    --out "$MANIFEST" \
    --mode "$MODE" \
    --exclude-images "$EXCLUDE_IMAGES" \
    --prefix "$PREFIX" \
    -- "${ITEMS[@]}"

echo "Paths:"
printf '  %s\n' "${ITEMS[@]}"
echo "Compressing (zstd -19 --long=31) -> $ARCHIVE"

XFORM="s,^,${PREFIX}/,"

if [[ "$FULL_TAR" -eq 1 ]]; then
    {
        tar -C "$ROOT" --transform "$XFORM" -cf - "${ITEMS[@]}"
        tar -C "$ROOT" \
            --exclude='node_modules' \
            --exclude='.git' \
            --exclude='images' \
            --exclude='.previews' \
            --exclude='.cache' \
            --exclude='logs' \
            --exclude='dreamscape-transfer-*.tar.zst' \
            --exclude='*.manifest.json' \
            --transform "s,^,${PREFIX}/app/," \
            -cf - .
    } | zstd -19 --long=31 -T0 -o "$ARCHIVE"
else
    tar -C "$ROOT" --transform "$XFORM" -cf - "${ITEMS[@]}" \
        | zstd -19 --long=31 -T0 -o "$ARCHIVE"
fi

HUMAN="$(du -h "$ARCHIVE" | cut -f1)"
echo ""
echo "Done."
echo "  Archive:  $ARCHIVE ($HUMAN)"
echo "  Manifest: $MANIFEST"
echo ""
echo "Destination:"
echo "  bash scripts/unpack-server-transfer.sh -i \"$ARCHIVE\" -d /path/to/dreamscape"
