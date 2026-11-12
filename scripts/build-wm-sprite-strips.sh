#!/usr/bin/env bash
# Usage: scripts/build-wm-sprite-strips.sh
# Melaton Mobile frame animations as one horizontal strip per animation and scale
# (<name>-strip.png / @2x / @4x), so an animation is one image and one CSS steps() animation
# (wm-shell.css .wm-strip) instead of a file and a JS timer per frame. Rerun after any frame changes.
# The frames stay: other code and the Today art still use single frames.
set -euo pipefail
cd "$(dirname "$0")/../public/static_images"
strip() { # dir out frame... (BLANK = an empty frame the size of the others)
    local dir=$1 out=$2; shift 2
    for x in '' @2x @4x; do
        local files=() ref=''
        for f in "$@"; do [ "$f" = BLANK ] && continue; [ -f "$dir/$f$x.png" ] || continue 2; ref=${ref:-$dir/$f$x.png}; done
        local size; size=$(identify -format '%wx%h' "$ref")
        for f in "$@"; do if [ "$f" = BLANK ]; then files+=("-size" "$size" "xc:none"); else files+=("$dir/$f$x.png"); fi; done
        convert -background none "${files[@]}" +append +repage -define png:color-type=6 "$dir/$out-strip$x.png"
    done
}
rep() { local n=$1 f=$2; for ((i = 0; i < n; i++)); do printf '%s ' "$f"; done; }
seq_names() { local base=$1 n=$2 w=$3; for ((i = 0; i < n; i++)); do if [ "$w" = 2 ]; then printf '%s-%02d ' "$base" "$i"; else printf '%s-%d ' "$base" "$i"; fi; done; }
for d in wm61 wm65; do
    # wait cursor: 16 frames
    strip $d wait $(seq_names wait 16 1)
    # the data icon's two sequences, in the order of 6.1 / 6.5 shell32's own table (#771):
    #   A (Melaton: connecting): connected, arrows run out, the bare badge twice, arrows run back in,
    #     connected three times; 200 ms a frame. Plain data 24 frames (4684 4744-4752 4688x2
    #     4753-4761 4684x3), Wi-Fi and each type 16.
    #   B (Melaton: ActiveSync moving data): the turning arrows, the bare badge twice, the rest of the
    #     turn, its first frame three times; 150 ms a frame. Plain data 24 (4685 4724-4733 4688x2
    #     4734-4743 4685x3), Wi-Fi and each type 18.
    # (wmShell SEQ holds the frame counts and times)
    A=$(seq_names status-data-anim 18 2); A=($A)
    strip $d status-data-conn status-data-on ${A[@]:0:9} BLANK BLANK ${A[@]:9:9} $(rep 3 status-data-on)
    S=$(seq_names status-data-sync 20 2); S=($S)
    strip $d status-data-xfer status-data-turn ${S[@]:0:10} BLANK BLANK ${S[@]:10:10} $(rep 3 status-data-turn)
    W=$(seq_names status-wifi-anim 10 2); W=($W)
    strip $d status-wifi-conn status-wifi-connected ${W[@]:0:5} status-wifi-available status-wifi-available ${W[@]:5:5} $(rep 3 status-wifi-connected)
    W=$(seq_names status-wifi-sync 12 2); W=($W)
    strip $d status-wifi-xfer status-wifi-turn ${W[@]:0:6} status-wifi-available status-wifi-available ${W[@]:6:6} $(rep 3 status-wifi-turn)
    for t in g e 3g h h-plus 4g 4g-plus 5g 5g-plus nr nr-a uw; do
        T=$(seq_names status-data-$t-anim 10 2); T=($T)
        strip $d status-data-$t-conn status-data-$t-active ${T[@]:0:5} status-data-$t status-data-$t ${T[@]:5:5} $(rep 3 status-data-$t-active)
        T=$(seq_names status-data-$t-sync 13 2); T=($T)
        strip $d status-data-$t-xfer ${T[@]:0:7} status-data-$t status-data-$t ${T[@]:7:6} $(rep 3 ${T[0]})
    done
    # searching for service: 3 frames
    strip $d status-signal-search status-signal-search-1 status-signal-search-2 status-signal-search-3
done
# the Director clapper while a turn runs (wmShell DIRECTOR_CLAP order)
strip wm61 status-director-clap status-director-open-2 status-director-open-1 status-director-open-0 status-director status-director-open-0 status-director-open-1
# two-state buttons: normal | pressed, so the first press has no blank frame while the pressed art loads
strip wm61 today-search-button today-search-button today-search-button-pressed
echo ok
