#!/usr/bin/env bash
# Builds the Welcome screen's branding strip (Yozora #495): the Dreamscape ring mark, then
# "Dreamscape" in Segoe UI and "2026 R7" in the light weight, white on transparent, the way
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
LOGO="$ROOT/public/static_images/logo_icon.png"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/selawik"
SEGOE="${SEGOE_UI_TTF:-$HOME/.local/share/fonts/segoeui.ttf}"
LIGHT="$CACHE/selawkl.ttf"
SELAWIK_ZIP_URL="https://github.com/microsoft/Selawik/releases/download/1.01/Selawik_Release.zip"

# Strip geometry (px): slot, the mark, the two runs on one baseline
W=400; H=50
PT=34
MARK=40
BASELINE=37
GAP_MARK=10   # mark to the name
GAP_RUNS=10   # name to the version

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
name_w=$(convert -background none -fill white -font "$SEGOE" -pointsize "$PT" label:"Dreamscape" -trim +repage -format '%w' info:)
ver_w=$(convert -background none -fill white -font "$LIGHT" -pointsize "$PT" label:"2026 R7" -trim +repage -format '%w' info:)
content=$(( MARK + GAP_MARK + name_w + GAP_RUNS + ver_w ))
left=$(( (W - content) / 2 ))
name_x=$(( left + MARK + GAP_MARK ))
ver_x=$(( name_x + name_w + GAP_RUNS ))
mark_y=$(( (H - MARK) / 2 ))

mkdir -p "$(dirname "$OUT")"
convert -size "${W}x${H}" xc:none \
    \( "$LOGO" -resize "${MARK}x${MARK}" \) -geometry "+${left}+${mark_y}" -composite \
    -font "$SEGOE" -pointsize "$PT" -fill white -annotate "+${name_x}+${BASELINE}" "Dreamscape" \
    -font "$LIGHT" -pointsize "$PT" -fill white -annotate "+${ver_x}+${BASELINE}" "2026 R7" \
    -define png:color-type=6 "PNG32:$OUT"

echo "wrote $OUT ($(identify -format '%wx%h' "$OUT"); mark at $left, name at $name_x, version at $ver_x)"
