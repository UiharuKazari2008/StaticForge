#!/usr/bin/env bash
# Builds the Workspaces splash's overflow sheet (Yozora #468): Vista flow bands with a floral
# fusion that spill past the 800x450 splash frame. Input: the generated art, light on pure black
# (public/static_images/splash/src/workspaces-bands-src.jpg). Output: a 1080x730 WebP with alpha,
# the frame plus 140 px on every side (manual-modal-splash.css #workspaceSplash .splash-bands):
#   1. luminance becomes alpha and the colour is un-premultiplied, so the bands glow over anything;
#   2. the faint floor (alpha under 6%) goes to 0, so nothing reads as a tinted rectangle, and the
#      remaining alpha is lifted (gamma) so the bands read solid rather than ghostly;
#   3. inside the frame the sheet is held at 34% (the art shows through), full strength outside;
#   4. the outer 110 px fade to nothing on all four edges, so no band is cut off by the sheet's border.
# Usage: bash scripts/build-workspaces-splash-bands.sh [src.jpg] [out.webp]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/public/static_images/splash/src/workspaces-bands-src.jpg}"
OUT="${2:-$ROOT/public/static_images/splash/workspaces-bands.webp}"
W=1080; H=730          # sheet
FX=140; FY=140         # frame offset inside the sheet (frame is 800x450)
INSIDE=34              # % kept inside the frame
LIFT=1.8               # alpha gamma: lifts the bands' body toward opaque (Yukimi: more opacity)
EDGE=110               # px of fade at the sheet's edges
FLOOR=6                # % alpha treated as black

command -v convert >/dev/null || { echo "ImageMagick (convert) is required" >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "source art not found: $SRC" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. luminance -> alpha, un-premultiply the colour
convert "$SRC" -resize "${W}x${H}!" \( +clone -colorspace gray -auto-level -gamma 0.9 \) \
    -alpha off -compose CopyOpacity -composite "PNG32:$tmp/a.png"
convert "$tmp/a.png" -channel RGB -fx "a==0?0:min(1,u/a)" +channel "PNG32:$tmp/unpre.png"

# 2.-4. one alpha multiplier: floor cut, inside-the-frame hold, edge fade
convert "$tmp/unpre.png" -alpha extract -level "${FLOOR}%,100%" -gamma "$LIFT" "$tmp/alpha.png"
convert -size "${W}x${H}" xc:white -fill "gray(${INSIDE}%)" \
    -draw "rectangle ${FX},${FY} $((FX + 799)),$((FY + 449))" -blur 0x18 "$tmp/inside.png"
convert -size "$((W - 2 * EDGE))x$((H - 2 * EDGE))" xc:white -bordercolor black -border "$EDGE" \
    -blur "0x$((EDGE / 2))" -level 0%,100% "$tmp/edge.png"
convert "$tmp/alpha.png" "$tmp/inside.png" -compose Multiply -composite \
    "$tmp/edge.png" -compose Multiply -composite "$tmp/alpha2.png"
convert "$tmp/unpre.png" "$tmp/alpha2.png" -alpha off -compose CopyOpacity -composite \
    -define webp:lossless=false -quality 82 -define webp:alpha-quality=90 "$OUT"

echo "wrote $OUT ($(identify -format '%wx%h' "$OUT"))"
for edge in "${W}x1+0+0:top" "${W}x1+0+$((H - 1)):bottom" "1x${H}+0+0:left" "1x${H}+$((W - 1))+0:right"; do
    printf '  %-6s edge alpha max %s\n' "${edge##*:}" "$(convert "$OUT" -alpha extract -crop "${edge%%:*}" +repage -format '%[fx:maxima]' info:)"
done
