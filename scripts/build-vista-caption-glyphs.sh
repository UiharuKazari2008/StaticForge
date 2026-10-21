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
