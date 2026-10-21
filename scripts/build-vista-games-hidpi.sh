#!/bin/bash
# HiDPI copies of the Vista games' 1x-only art (Yozora #609). The games' sprite sheets and in-game
# images already ship a 2x version (the sheets' @2x pages, the images' x2 PNGs); what the
# originals had only at 96 DPI is the art drawn as HTML: the Change Appearance thumbnails, the
# Games Explorer glyphs and ESRB box, and the task dialog's command link arrow. Each one is
# upscaled 4x with Real-ESRGAN (x4plus), brought down to 2x with Lanczos and written next to
# the source as <name>@2x.png; the pages pick it up through srcset / image-set.
#
# Needs realesrgan-ncnn-vulkan (github.com/xinntao/Real-ESRGAN, release v0.2.5.0) with its
# models/ beside it: REALESRGAN=/path/to/realesrgan-ncnn-vulkan (default ~/.cache/realesrgan/bin).
# InkBall is left out on purpose: its DirectDraw bitmaps are pixel art drawn nearest-neighbour,
# which a 2x screen shows exactly.
#
#   scripts/build-vista-games-hidpi.sh [--force]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART="$ROOT/public/static_images/vista-games"
BIN="${REALESRGAN:-$HOME/.cache/realesrgan/bin/realesrgan-ncnn-vulkan}"
MODELS="$(dirname "$BIN")/models"
FORCE="${1:-}"
[ -x "$BIN" ] || { echo "realesrgan-ncnn-vulkan not found at $BIN" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

list() {
    # Change Appearance thumbnails (and the games' Explorer thumbnails) in every pack
    find "$ART" -path '*/images/*' -name '*thumb*.png' ! -name '*@2x.png' ! -name '*x2.png' ! -path '*/gameux/*'
    # Games Explorer: command bar glyphs, search glyph, ESRB box (the trophies come from app_icons)
    find "$ART/explorer" -name '*.png' ! -name '*@2x.png' ! -name 'games-*'
    # the task dialog's command link arrow
    find "$ART/ui" -name '*.png' ! -name '*@2x.png'
    # the address bar's Games icon
    echo "$ART/icons/games-16.png"
    # Cartograph's command bar glyphs and details swoosh, which Games Explorer shares
    for f in organize views help details-swoosh; do echo "$ROOT/public/static_images/vista-explorer/$f.png"; done
}

n=0
while read -r src; do
    [ -f "$src" ] || continue
    out="${src%.png}@2x.png"
    if [ -f "$out" ] && [ "$FORCE" != "--force" ] && [ "$out" -nt "$src" ]; then continue; fi
    w=$(identify -format '%w' "$src")
    h=$(identify -format '%h' "$src")
    "$BIN" -i "$src" -o "$TMP/x4.png" -n realesrgan-x4plus -s 4 -m "$MODELS" >/dev/null 2>&1
    convert "$TMP/x4.png" -filter Lanczos -resize "$((w * 2))x$((h * 2))!" -strip "$out"
    n=$((n + 1))
done < <(list)
echo "wrote $n @2x image(s)"
