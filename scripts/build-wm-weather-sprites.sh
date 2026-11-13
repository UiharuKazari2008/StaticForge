#!/usr/bin/env bash
# Usage: scripts/build-wm-weather-sprites.sh
# Melaton Mobile Weather's condition icons as one sheet per density (wx-icons.png / @2x / @4x,
# 64 / 128 / 256 px cells, left to right in ICONS order), so the app draws every hour, day and
# place from one image (wm-weather.css .wxw-ico, --i = the cell). Yozora #780. The single icons
# stay: Today, the 6.5 home screen and wmWeather.iconUrl() hand them to other code.
# Rerun after scripts/generate-wm-weather-art.js changes an icon; keep ICONS in step with
# wmWeather.js ICON_CELLS.
set -euo pipefail
cd "$(dirname "$0")/../public/static_images/wm61/weather"
ICONS=(clear-day clear-night partly-day partly-night cloudy fog drizzle rain sleet snow storm)
for x in '' @2x @4x; do
    files=()
    for i in "${ICONS[@]}"; do files+=("wx-$i$x.png"); done
    # no date chunks: an unchanged rebuild is byte-identical
    convert -background none "${files[@]}" +append +repage -define png:color-type=6 \
        -define png:exclude-chunks=date,time -strip "wx-icons$x.png"
    identify -format "wx-icons$x.png %wx%h %b\n" "wx-icons$x.png"
done
