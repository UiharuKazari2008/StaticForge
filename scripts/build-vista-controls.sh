#!/usr/bin/env bash
# Builds the common control faces (push button, drop-down list, text box, tab, track bar, progress
# bar) from Vista's own theme bitmaps: aero.msstyles IMAGE_* resources. Those are PREMULTIPLIED
# alpha, so every frame is un-premultiplied here (straight alpha PNG32). The CSS 9-slices them
# with border-image (public/css/vista-glass-controls.css, "Vista common controls"), so each state
# is its own file. Verified side by side against a WinForms test form with native visual styles
# on the Vista VM (Segoe UI 9 pt, 96 DPI).
#
#   515  BUTTON PUSHBUTTON   22x23 x6  normal, hot, pressed, disabled, defaulted, defaulted (pulse)
#   524  COMBOBOX READONLY   11x21 x4  normal, hot, pressed, disabled
#   520  COMBOBOX glyph      10x19 x4  normal (= hot = pressed), disabled
#        (+ combo-*-fill.png: each face's centre column, rows 3-17, for <select>)
#   514  BUTTON GROUPBOX      5x6      slices 2 2 3 2, no fill (white line below the bottom edge)
#   523  EDIT border          5x5  x4  normal, hot, focused, disabled
#   726  TAB TABITEM          5x19 x5  normal, hot, selected, disabled, focused
#   727  TAB TABITEMLEFTEDGE  5x19 x5
#   730  TAB TOPTABITEM       5x19 x5  (the selected tab, drawn 2 px taller)
#   731  TAB TOPTABITEMLEFTEDGE 5x19 x5
#   725  TAB PANE             5x4      slices 1 3 2 1, fill (2 px white outside right, 1 px below)
#   790  TRACKBAR THUMBBOTTOM 11x19 x5 normal, hot, pressed, focused, disabled (vertical sprite)
#   642  TRACKBAR TRACK        5x4
#   622  PROGRESS BAR         19x14
#   626  PROGRESS FILL        51x14    (627 error red, 628 paused yellow)
#   629  PROGRESS FILL       125x14    partial (teal): Computer's drive bars
#
# Not built here: checkbox.png / radio.png (IMAGE_508 / 516, cut for Remote Access Properties) and
# spin-{up,down}-{normal,hot}.png, cropped 14x9 from the VM's 96 DPI up-down control (the
# theme's SPIN bitmaps are drawn rotated and stretched at that size).
#
# Get the bitmaps: `C:\agent\dumpres.exe C:\Windows\Resources\Themes\Aero\aero.msstyles <dir> 1`
# on the VM (docs/vista-vm-agent.md), then copy the IMAGE_*.png files into one folder.
#
# Usage: bash scripts/build-vista-controls.sh <dir with IMAGE_*.png> [out dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?usage: build-vista-controls.sh <dir with IMAGE_*.png> [out dir]}"
OUT="${2:-$ROOT/public/static_images/vista-controls}"
mkdir -p "$OUT"

unpremultiply() {
    convert "$1" -channel RGB -fx "a==0?0:min(1,u/a)" +channel "PNG32:$2"
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# frames <image id> <frame count> <name> <state names...>: one file per state
frames() {
    local id="$1" count="$2" name="$3"
    shift 3
    unpremultiply "$SRC/IMAGE_$id.png" "$TMP/$id.png"
    local w h fh i=0
    w=$(identify -format %w "$TMP/$id.png")
    h=$(identify -format %h "$TMP/$id.png")
    fh=$((h / count))
    for state in "$@"; do
        if [ "$state" != "-" ]; then
            convert "$TMP/$id.png" -crop "${w}x${fh}+0+$((i * fh))" +repage -strip "PNG32:$OUT/$name-$state.png"
        fi
        i=$((i + 1))
    done
}

# whole <image id> <file>: the bitmap as it is (sprites the CSS offsets into)
whole() {
    unpremultiply "$SRC/IMAGE_$1.png" "$TMP/$1.png"
    convert "$TMP/$1.png" -strip "PNG32:$OUT/$2.png"
}

frames 515 6 button normal hot pressed disabled default default-pulse
frames 524 4 combo normal hot pressed disabled
frames 520 4 combo-glyph normal - - disabled
# a <select> cannot carry a pseudo-element for the glyph and a border-image fill paints over the
# background, so selects take the face's centre as a background slice under an edge-only border image
for state in normal hot pressed disabled; do
    convert "$OUT/combo-$state.png" -crop 1x15+5+3 +repage -strip "PNG32:$OUT/combo-$state-fill.png"
done
whole 514 groupbox
frames 523 4 edit normal hot focus disabled
frames 726 5 tab normal hot - disabled -
frames 727 5 tab-left normal hot - disabled -
frames 730 5 tab-top - - selected - -
frames 731 5 tab-top-left - - selected - -
whole 725 tab-pane
whole 790 trackbar-thumb
whole 642 trackbar-track
whole 622 progress-bar
whole 626 progress-fill
whole 627 progress-fill-error
whole 628 progress-fill-paused
whole 629 progress-fill-partial

echo "wrote $(ls "$OUT" | wc -l) files to $OUT"
