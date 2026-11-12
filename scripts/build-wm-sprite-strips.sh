#!/usr/bin/env bash
# Usage: scripts/build-wm-sprite-strips.sh
# Melaton Mobile frame animations as one horizontal strip per animation and scale
# (<name>-strip.png / @2x / @4x), so an animation is one image and one CSS steps() animation
# (wm-shell.css .wm-strip) instead of a file and a JS timer per frame. Rerun after any frame changes.
# The frames stay: other code and the Today art still use single frames.
set -euo pipefail
cd "$(dirname "$0")/../public/static_images"
strip() { # dir out frame...
    local dir=$1 out=$2; shift 2
    for x in '' @2x @4x; do
        local files=()
        for f in "$@"; do [ -f "$dir/$f$x.png" ] || continue 2; files+=("$dir/$f$x.png"); done
        convert -background none "${files[@]}" +append +repage -define png:color-type=6 "$dir/$out-strip$x.png"
    done
}
seq_names() { local base=$1 n=$2 w=$3; for ((i = 0; i < n; i++)); do if [ "$w" = 2 ]; then printf '%s-%02d ' "$base" "$i"; else printf '%s-%d ' "$base" "$i"; fi; done; }
for d in wm61 wm65; do
    # wait cursor: 16 frames
    strip $d wait $(seq_names wait 16 1)
    # connecting (#760): data 20, Wi-Fi 12, each mobile type 13
    strip $d status-data-sync $(seq_names status-data-sync 20 2)
    strip $d status-wifi-sync $(seq_names status-wifi-sync 12 2)
    for t in g e 3g h h-plus 4g 4g-plus 5g 5g-plus nr nr-a uwb; do
        strip $d status-data-$t-sync $(seq_names status-data-$t-sync 13 2)
    done
    # searching for service: 3 frames
    strip $d status-signal-search status-signal-search-1 status-signal-search-2 status-signal-search-3
done
# the Director clapper while a turn runs (wmShell DIRECTOR_CLAP order)
strip wm61 status-director-clap status-director-open-2 status-director-open-1 status-director-open-0 status-director status-director-open-0 status-director-open-1
# two-state buttons: normal | pressed, so the first press has no blank frame while the pressed art loads
strip wm61 today-search-button today-search-button today-search-button-pressed
echo ok
