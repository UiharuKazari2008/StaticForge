#!/usr/bin/env bash
# Builds the Welcome screen's branding strip (Yozora #495): the Melaton flower, then
# "Melaton" (the OS) in Segoe UI and "2026 R7" in the light weight (R7 in orange), white on transparent, the way
# Windows Server 2008 R2 sets its edition light next to the product name. desktop-boot.css draws
# it under the logon at center bottom 23px, 400x50 (body.vista-logon #desktopPreStartupModal).
#
# Fonts: Segoe UI Regular comes from the dev box (~/.local/share/fonts/segoeui.ttf) or the Vista
# VM (C:\Windows\Fonts\segoeui.ttf through ~/.config/vista-vm/vm.sh). Vista never shipped Segoe UI
# Light, so the light run uses Selawik Light, Microsoft's MIT-licensed Segoe-metric face, fetched
# once into ~/.cache/selawik from the GitHub release. Only the PNG is committed.
#
# Usage: bash scripts/build-vista-logon-branding.sh [out.png]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/public/static_images/vista-logon/branding.png}"
LOGO="${MELATON_MARK:-$ROOT/public/static_images/melaton/melaton-glass.png}"   # the Melaton flower (the Enso is Dreamscape's)
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/selawik"
SEGOE="${SEGOE_UI_TTF:-$HOME/.local/share/fonts/segoeui.ttf}"
LIGHT="$CACHE/selawkl.ttf"
SELAWIK_ZIP_URL="https://github.com/microsoft/Selawik/releases/download/1.01/Selawik_Release.zip"

# Strip geometry (px): slot, the mark, the two runs on one baseline. Vista's strip (basebrd.dll
# 120, 350x50) has its flag's panes in y 4..43 (45x40; 47x42 with the (R)), 3 px clear of the
# wordmark, and a soft shadow under the flag: 1 px down and right, dark grey, about half strength
# one pixel out. The flower takes that extent: 42 px of ink from y 4, 5 px clear of the name.
# The wordmark has Vista's proportions too: caps 21 px, y 19..39 (Segoe UI at 28.5 px), so
# mark height : cap height is the original's 2 : 1.
W=400; H=50
PT=28.5
MARK=42
MARK_Y=4
BASELINE=40
GAP_MARK=2    # mark to the name
SHADOW_FILL="#1e2022"; SHADOW_SIGMA=0.9; SHADOW_OPACITY=0.55; SHADOW_DX=1; SHADOW_DY=1
GAP_RUNS=10   # name to the version
NAME="Melaton"; VERSION_YEAR="2026"; VERSION_REL="R7"; VERSION="$VERSION_YEAR $VERSION_REL"
REL_FILL="#F88800"   # the release in the Xyridian logo's star orange

command -v convert >/dev/null || { echo "ImageMagick (convert) is required" >&2; exit 1; }
command -v identify >/dev/null || { echo "ImageMagick (identify) is required" >&2; exit 1; }

if [[ ! -f "$SEGOE" ]]; then
    mkdir -p "$(dirname "$SEGOE")"
    if [[ -x "$HOME/.config/vista-vm/vm.sh" ]]; then
        "$HOME/.config/vista-vm/vm.sh" get 'C:\Windows\Fonts\segoeui.ttf' "$SEGOE" >/dev/null
    fi
    [[ -f "$SEGOE" ]] || { echo "Segoe UI Regular not found at $SEGOE (set SEGOE_UI_TTF)" >&2; exit 1; }
fi

if [[ ! -f "$LIGHT" ]]; then
    mkdir -p "$CACHE"
    tmp="$(mktemp -d)"
    curl -sSL -o "$tmp/selawik.zip" "$SELAWIK_ZIP_URL"
    unzip -o -q "$tmp/selawik.zip" selawkl.ttf -d "$CACHE"
    rm -rf "$tmp"
    [[ -f "$LIGHT" ]] || { echo "Selawik Light did not unpack to $LIGHT" >&2; exit 1; }
fi

# advance widths of the two runs at this size (trimmed ink is close enough for placement)
name_w=$(convert -background none -fill white -font "$SEGOE" -pointsize "$PT" label:"$NAME" -trim +repage -format '%w' info:)
ver_w=$(convert -background none -fill white -font "$LIGHT" -pointsize "$PT" label:"$VERSION" -trim +repage -format '%w' info:)
# the release starts where "2026 " ends: advance widths (untrimmed) of the run less the release
adv() { convert -background none -fill white -font "$1" -pointsize "$PT" label:"$2" -format '%w' info:; }
rel_off=$(( $(adv "$LIGHT" "$VERSION") - $(adv "$LIGHT" "$VERSION_REL") ))
content=$(( MARK + GAP_MARK + name_w + GAP_RUNS + ver_w ))
left=$(( (W - content) / 2 ))
name_x=$(( left + MARK + GAP_MARK ))
ver_x=$(( name_x + name_w + GAP_RUNS ))
mark_y=$MARK_Y

mkdir -p "$(dirname "$OUT")"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
convert "$LOGO" -trim +repage -resize "${MARK}x${MARK}" "PNG32:$tmp/mark.png"
# the mark's shadow: its alpha in the shadow colour, blurred, on a 4 px margin so the blur has room
convert "$tmp/mark.png" -bordercolor none -border 4 -channel RGB -fill "$SHADOW_FILL" -colorize 100 +channel \
    -channel A -gaussian-blur "0x${SHADOW_SIGMA}" -evaluate multiply "$SHADOW_OPACITY" +channel "PNG32:$tmp/shadow.png"
convert -size "${W}x${H}" xc:none \
    "$tmp/shadow.png" -geometry "+$(( left - 4 + SHADOW_DX ))+$(( mark_y - 4 + SHADOW_DY ))" -composite \
    "$tmp/mark.png" -geometry "+${left}+${mark_y}" -composite \
    -font "$SEGOE" -pointsize "$PT" -fill white -annotate "+${name_x}+${BASELINE}" "$NAME" \
    -font "$LIGHT" -pointsize "$PT" -fill white -annotate "+${ver_x}+${BASELINE}" "$VERSION_YEAR" \
    -fill "$REL_FILL" -annotate "+$(( ver_x + rel_off ))+${BASELINE}" "$VERSION_REL" \
    -define png:color-type=6 "PNG32:$OUT"

echo "wrote $OUT ($(identify -format '%wx%h' "$OUT"); mark at $left, name at $name_x, version at $ver_x)"
