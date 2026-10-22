#!/usr/bin/env bash
# Builds the About Melaton banner (winver.exe's "About Windows" brand strip): Vista's 413x72
# banner gradient with the Melaton mark, "Melaton" and "2026 R7" (R7 in orange) centred where Vista has the
# flag, "Windows Vista" and "Ultimate", and the small copyright at bottom right; plus the 413x5
# orange rule under it. #aboutMelatoninModal (public/css/about-melaton.css) draws both.
#
# Sources: basebrd.dll from the Vista VM (bitmaps 101 = the colour banner, 111 = its rule), dumped
# with C:\agent\dumpres.exe through ~/.config/vista-vm/vm.sh and cached in ~/.cache/vista-vm. The
# gradient is horizontal only, so its top row (above the art) stretched to 72 rows is the clean
# background. Fonts: Segoe UI as in build-vista-logon-branding.sh, Selawik Light for the edition,
# Tahoma (from the VM) for the copyright. Only the PNGs are committed.
#
# Usage: bash scripts/build-about-windows-banner.sh [outdir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/public/static_images/vista-about}"
VM="$HOME/.config/vista-vm/vm.sh"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/vista-vm"
BRD="$CACHE/basebrd"
FONTS="$CACHE/fonts"
SEGOE="${SEGOE_UI_TTF:-$HOME/.local/share/fonts/segoeui.ttf}"
LIGHT="${XDG_CACHE_HOME:-$HOME/.cache}/selawik/selawkl.ttf"
TAHOMA="$FONTS/tahoma.ttf"
MARK_FONT="$ROOT/public/dist/remixicon/remixicon.ttf"
MARK_GLYPH=$'\uebd3'   # ri-contrast-2-fill, the Melaton mark (Start menu, Workspace backdrop)

# Geometry from Vista's banner (px): flag box 77,16 48x38; "Windows Vista" 28px on baseline 48;
# "Ultimate" 20px light on the same baseline; copyright right edge 406, baseline 67. The group
# (mark, name, edition) is centred on the 413 px strip as Vista's is.
W=413; H=72
MARK=34; MARK_TOP=19
NAME_PT=28; EDITION_PT=20; BASELINE=48; NAME_KERNING=-0.6
GAP_MARK=6; GAP_RUNS=6
COPY_PT=8; COPY_RIGHT=406; COPY_BASELINE=67
NAME="Melaton"; EDITION_YEAR="2026"; EDITION_REL="R7"; EDITION="$EDITION_YEAR $EDITION_REL"
COPYRIGHT="© 2026 Xyridian Corporation"
REL_FILL="#F88800"   # the release in the Xyridian logo's star orange

command -v convert >/dev/null || { echo "ImageMagick (convert) is required" >&2; exit 1; }

fetch_vm() { # vmpath local
    [[ -f "$2" ]] && return 0
    [[ -x "$VM" ]] || { echo "missing $2 and no $VM to fetch it" >&2; exit 1; }
    mkdir -p "$(dirname "$2")"
    "$VM" get "$1" "$2" >/dev/null
}

if [[ ! -f "$BRD/2_101.bmp" || ! -f "$BRD/2_111.bmp" ]]; then
    "$VM" run 'C:\agent\dumpres.exe C:\Windows\Branding\Basebrd\basebrd.dll C:\agent\brd 1' 30 >/dev/null
    fetch_vm 'C:\agent\brd\2_101.bmp' "$BRD/2_101.bmp"
    fetch_vm 'C:\agent\brd\2_111.bmp' "$BRD/2_111.bmp"
fi
fetch_vm 'C:\Windows\Fonts\tahoma.ttf' "$TAHOMA"
fetch_vm 'C:\Windows\Fonts\segoeui.ttf' "$SEGOE"
[[ -f "$LIGHT" ]] || { echo "Selawik Light missing at $LIGHT (run scripts/build-vista-logon-branding.sh once)" >&2; exit 1; }

width_of() { # font pt text [kerning]
    convert -density 72 -background none -fill white -font "$1" -pointsize "$2" -kerning "${4:-0}" label:"$3" -format '%w' info:
}
name_w=$(width_of "$SEGOE" "$NAME_PT" "$NAME" "$NAME_KERNING")
edition_w=$(width_of "$LIGHT" "$EDITION_PT" "$EDITION")
# the release starts where "2026 " ends: the whole run's advance less the release's own
rel_off=$(( edition_w - $(width_of "$LIGHT" "$EDITION_PT" "$EDITION_REL") ))
copy_w=$(width_of "$TAHOMA" "$COPY_PT" "$COPYRIGHT")
content=$(( MARK + GAP_MARK + name_w + GAP_RUNS + edition_w ))
left=$(( (W - content) / 2 ))
name_x=$(( left + MARK + GAP_MARK ))
edition_x=$(( name_x + name_w + GAP_RUNS ))
copy_x=$(( COPY_RIGHT - copy_w ))

mkdir -p "$OUT"
convert "$BRD/2_101.bmp" -crop "${W}x1+0+0" +repage -scale "${W}x${H}!" \
    \( -density 72 -background none -fill white -font "$MARK_FONT" -pointsize "$MARK" label:"$MARK_GLYPH" -trim +repage \
       -resize "${MARK}x${MARK}" \) -geometry "+${left}+${MARK_TOP}" -composite \
    -density 72 \
    -font "$SEGOE" -pointsize "$NAME_PT" -kerning "$NAME_KERNING" -fill white -annotate "+${name_x}+${BASELINE}" "$NAME" \
    -kerning 0 -font "$LIGHT" -pointsize "$EDITION_PT" -fill white -annotate "+${edition_x}+${BASELINE}" "$EDITION_YEAR" \
    -fill "$REL_FILL" -annotate "+$(( edition_x + rel_off ))+${BASELINE}" "$EDITION_REL" \
    -font "$TAHOMA" -pointsize "$COPY_PT" -fill white -annotate "+${copy_x}+${COPY_BASELINE}" "$COPYRIGHT" \
    -define png:color-type=2 "PNG24:$OUT/banner.png"
convert "$BRD/2_111.bmp" -define png:color-type=2 "PNG24:$OUT/banner-rule.png"

echo "wrote $OUT/banner.png (mark at $left, name at $name_x, edition at $edition_x, copyright at $copy_x) and banner-rule.png"
