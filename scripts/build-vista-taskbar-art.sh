#!/usr/bin/env bash
# Vista taskbar art for public/css/vista-taskbar.css and taskbarProperties.js, cut from the
# Vista Aero VM's own files (docs/vista-vm-agent.md; dumps cached in ~/.cache/vista-vm/taskbar):
#
#   aero.msstyles (C:\agent\dumpres.exe ... aero.msstyles <dir> 1), PREMULTIPLIED alpha:
#     IMAGE_872  60x138  Start orb for a bottom taskbar, 96 dpi: normal / hot / pressed, 46 px each
#                        (pixel-identical to the VM's "Start" window at 0,1162 over a 30 px bar)
#     IMAGE_897  134x174 taskbar button faces, 29 px each: normal, hot, pressed, disabled,
#                        checked (the foreground window), hot + checked
#     IMAGE_735  134x29  taskbar button flashing (FlashWindowEx)
#     IMAGE_911  19x60   notification area chevron: normal / hot / pressed, 20 px each
#   explorer.exe BITMAP 145-153 (335x34): the Taskbar tab's preview strips (reference only)
#   imageres.dll icon index 104: Show desktop; explorer.exe icon index 18: Switch between windows
#     (the Quick Launch shortcuts' IconLocation), 16 and 32 px, straight alpha (vm.sh icon)
#   timedate.cpl PNGFILE 5000/5001: the clock flyout's 128 px face and its gloss; icon 0 the
#     calendar of the clock's tooltip (32 px), straight alpha
#
# The toolbar gripper is drawn from the preview strip 2_146 (3 x 6 dots, 2 px each, 3 px / 4 px
# pitch: one light pixel over three dark ones) as alpha over the bar.
#
# Usage: scripts/build-vista-taskbar-art.sh [cache dir]
set -euo pipefail
SRC="${1:-$HOME/.cache/vista-vm/taskbar}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/static_images/vista-taskbar"
mkdir -p "$OUT"

unpremultiply() { convert "$1" -channel RGB -fx "a==0?0:min(1,u/a)" +channel "PNG32:$2" 2>/dev/null; }

unpremultiply "$SRC/IMAGE_872.png" "$OUT/start-orb.png"
# one file per face, for CSS border-image (sizing margins 6 px left and right, stretched between)
unpremultiply "$SRC/IMAGE_897.png" "$OUT/.taskband-sheet.png"
state=0
for face in normal hot pressed disabled checked checked-hot; do
    convert "$OUT/.taskband-sheet.png" -crop "134x29+0+$((state * 29))" +repage "PNG32:$OUT/button-$face.png"
    state=$((state + 1))
done
rm -f "$OUT/.taskband-sheet.png" "$OUT/taskband-button.png"
unpremultiply "$SRC/IMAGE_735.png" "$OUT/button-flash.png"
rm -f "$OUT/taskband-button-flash.png"
unpremultiply "$SRC/IMAGE_911.png" "$OUT/tray-chevron.png"
cp "$SRC/ir104-16.png" "$OUT/show-desktop-16.png"
cp "$SRC/ir104-32.png" "$OUT/show-desktop-32.png"
cp "$SRC/sw-16.png" "$OUT/switch-windows-16.png"
cp "$SRC/sw-32.png" "$OUT/switch-windows-32.png"
cp "$SRC/PNGFILE_5000.png" "$OUT/clock-face.png"
cp "$SRC/PNGFILE_5001.png" "$OUT/clock-gloss.png"
cp "$SRC/cal-32.png" "$OUT/calendar-32.png"

# gripper: 8 x 22, light (white 29 %) at each dot's top-left, dark (black 42 % / 72 %) elsewhere
convert -size 8x22 xc:none "PNG32:$OUT/gripper.png"
draw=()
for col in 0 3 6; do
    for row in 0 4 8 12 16 20; do
        [ $col -lt 8 ] || continue
        draw+=(-fill 'rgba(255,255,255,0.29)' -draw "point $col,$row")
        draw+=(-fill 'rgba(0,0,0,0.42)' -draw "point $((col + 1)),$row" -draw "point $col,$((row + 1))")
        draw+=(-fill 'rgba(0,0,0,0.72)' -draw "point $((col + 1)),$((row + 1))")
    done
done
convert "$OUT/gripper.png" "${draw[@]}" "PNG32:$OUT/gripper.png"

ls -la "$OUT"
