#!/usr/bin/env bash
# Builds the caption button glyphs (minimize / maximize / restore / close) and the button faces
# from Vista's own DWM atlas: aero.msstyles resource STREAM 850 (1199x774, straight alpha, unlike the theme's IMAGE
# bitmaps which are premultiplied). The 96 DPI glyphs sit in 14 px cells with a 1 px sizing
# margin; four states per glyph (normal, hot, pressed, disabled), the first three identical.
# Each output is a 2-row sprite: normal on top, disabled below. Verified against Notepad on the
# Vista VM: every opaque glyph pixel identical, anti-aliased edges within 1 level.
#
# Get the atlas: `C:\agent\dumpres.exe C:\Windows\Resources\Themes\Aero\aero.msstyles <dir>`
# on the VM (docs/vista-vm-agent.md), then copy STREAM_850.png here.
#
# Usage: bash scripts/build-vista-caption-glyphs.sh <STREAM_850.png> [out dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ATLAS="${1:?usage: build-vista-caption-glyphs.sh <STREAM_850.png> [out dir]}"
OUT="${2:-$ROOT/public/static_images/window-controls}"

# name  x  y(normal)  w  h ; the disabled state is 3 cells (42 px) further down
glyph() {
    local name="$1" x="$2" y="$3" w="$4" h="$5"
    convert "$ATLAS" \
        \( -clone 0 -crop "${w}x${h}+${x}+${y}" +repage \) \
        \( -clone 0 -crop "${w}x${h}+${x}+$((y + 42))" +repage \) \
        -delete 0 -append -strip "PNG32:$OUT/vista-$name.png"
}

glyph minimize 1 523 12 5
glyph maximize 18 62 12 10
glyph restore 1 573 12 12
glyph close 1 462 11 10
echo "wrote $OUT/vista-{minimize,maximize,restore,close}.png"

# Menu (an app's menu button in the cluster, Font Awesome fa-bars): Vista has no such glyph, so
# it is drawn in the glyphs' own language, the Maximize box (12x10) split into three bars: the
# #535666 edge with 0x96 corners, the close glyph's row ramp (ff fd fa e9 e9 e2 dc d7) as fill,
# and the disabled state's flat edge / corner / fill alphas from the minimize sprite.
awk 'BEGIN {
    split("255 253 250 233 233 226 220 215", ramp, " ");
    print "# ImageMagick pixel enumeration: 12,20,255,srgba";
    for (d = 0; d < 2; d++) for (y = 0; y < 10; y++) for (x = 0; x < 12; x++) {
        edge = (y % 3 == 0) || x == 0 || x == 11;
        corner = (y == 0 || y == 9) && (x == 0 || x == 11);
        if (corner) c = d ? "81,84,101,75" : "83,86,101,150";
        else if (edge) c = d ? "83,85,101,128" : "83,86,102,255";
        else if (d) c = "241,241,241,219";
        else { v = ramp[y]; c = v "," v "," v ",255" }
        printf "%d,%d: (%s)\n", x, y + 10 * d, c;
    }
}' | convert txt:- -strip "PNG32:$OUT/vista-menu.png"
echo "wrote $OUT/vista-menu.png"

# Button faces, 18 px tall at 96 DPI, in 20 px cells (1 px duplicated margin all round), four
# states each: normal, hot, pressed, disabled. The inactive window's sets draw only an outline
# at rest. left = the cluster's first button (Minimize), mid = any button between (Maximize,
# app buttons), right = Close after other buttons, single = a lone Close.
# piece  activity  x  y(first cell)  w
FACES="left active 62 416 26
left inactive 62 256 26
mid active 62 336 26
mid inactive 62 176 26
right active 62 614 44
right inactive 62 694 44
single active 108 0 44
single inactive 62 496 43"
mkdir -p "$OUT/faces"
while read -r piece act x y w; do
    k=0
    for state in normal hot pressed disabled; do
        convert "$ATLAS" -crop "${w}x18+${x}+$((y + 1 + 20 * k))" +repage -strip "PNG32:$OUT/faces/$piece-$act-$state.png"
        k=$((k + 1))
    done
done <<< "$FACES"
echo "wrote $OUT/faces/*.png"

# Tool windows (WS_EX_TOOLWINDOW, measured on the VM 2026-11-09): a separate 17x17 square button
# 5 px from the window's top edge and 6 px from its right edge. Close: the small close background
# (atlas 13x13 cells, 2 px 9-slice margins, 4 states, active at x 1 / inactive at x 16) stretched to
# 17x17 and the 7x7 small glyph (x 1, y 249, 9 px cells) drawn on it at 5,5 by the CSS. Vista has
# no small Minimize / Maximize: their faces are the small close box filled with the normal caption
# face's middle column, under 7 px glyphs.
mkdir -p "$OUT/tool"
nine17() {
    local x="$1" y="$2" out="$3" cell
    cell="$(mktemp --suffix=.png)"
    convert "$ATLAS" -crop "13x13+$x+$y" +repage "$cell"
    convert -size 17x17 xc:none \
        \( "$cell" -crop 2x2+0+0 +repage \) -geometry +0+0 -composite \
        \( "$cell" -crop 2x2+11+0 +repage \) -geometry +15+0 -composite \
        \( "$cell" -crop 2x2+0+11 +repage \) -geometry +0+15 -composite \
        \( "$cell" -crop 2x2+11+11 +repage \) -geometry +15+15 -composite \
        \( "$cell" -crop 9x2+2+0 +repage -filter Triangle -resize '13x2!' \) -geometry +2+0 -composite \
        \( "$cell" -crop 9x2+2+11 +repage -filter Triangle -resize '13x2!' \) -geometry +2+15 -composite \
        \( "$cell" -crop 2x9+0+2 +repage -filter Triangle -resize '2x13!' \) -geometry +0+2 -composite \
        \( "$cell" -crop 2x9+11+2 +repage -filter Triangle -resize '2x13!' \) -geometry +15+2 -composite \
        \( "$cell" -crop 9x9+2+2 +repage -filter Triangle -resize '13x13!' \) -geometry +2+2 -composite \
        -strip "PNG32:$out"
    rm -f "$cell"
}
k=0
for state in normal hot pressed disabled; do
    nine17 1 $((629 + 15 * k)) "$OUT/tool/close-active-$state.png"
    nine17 16 $((1 + 15 * k)) "$OUT/tool/close-inactive-$state.png"
    for act in active inactive; do
        # the small close box at rest, inactive (1 px edge, inner highlight, clear inside; its own
        # hot and pressed faces are red), filled with the normal caption face's middle column
        # (glass fold, blue hot, dark pressed)
        face="$OUT/faces/mid-$act-$state.png"
        convert "$OUT/tool/close-inactive-normal.png" \
            \( "$face" -crop 1x18+12+0 +repage -filter Triangle -resize '15x15!' \) -geometry +1+1 -compose DstOver -composite \
            -compose Over -strip "PNG32:$OUT/tool/button-$act-$state.png"
    done
    k=$((k + 1))
done
convert "$ATLAS" \( -clone 0 -crop 7x7+1+249 +repage \) \( -clone 0 -crop 7x7+1+276 +repage \) \
    -delete 0 -append -strip "PNG32:$OUT/vista-close-small.png"
# a 7 px Minimize for the 17 px face: the 12x5 glyph's ends (3 + 4 columns), both sprite rows
convert "$OUT/vista-minimize.png" \( -clone 0 -crop 3x10+0+0 +repage \) \( -clone 0 -crop 4x10+8+0 +repage \) \
    -delete 0 +append -strip "PNG32:$OUT/vista-minimize-small.png"
echo "wrote $OUT/tool/*.png, $OUT/vista-close-small.png and $OUT/vista-minimize-small.png"
