#!/bin/bash
# redact-pin.sh <run's guest folder> <out.jpg> : one strip of a tools/pin-guest.sh run (StaticForge #1392 part D): Melaton's lock
# screen | the keypad with the typed dots | the screen after. Lock screen: tools/redact-lock.sh (Today picture a mosaic, unread
# count blacked out). Keypad: the Today picture a mosaic, only the entry bar and the keys kept. The last shot is kept as it is:
# the caller looks at it first (Android Settings, or black: Android's PIN pad is a FLAG_SECURE window).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); G=$1; OUT=$2
T=$(mktemp -d "${WORK:?set WORK}/redact.XXXXXX"); trap 'rm -rf "$T"' EXIT
"$HERE/redact-lock.sh" "$G/a-cover.png" "$T/a.png"
# the keys' rectangles of the saved lock copy on the 1968 wide screen (x y w h)
RECTS="633,286,702,58"
for y in 425 565 705 845; do for x in 633 871 1109; do RECTS="$RECTS 63$x,$y,226,129"; done; done
for x in 633 871 1109; do RECTS="$RECTS 63$x,1075,226,128"; done
RECTS=$(echo "$RECTS" | sed 's/ 63\([0-9]\)/ \1/g')
F="[0:v]format=rgb24,split=2[s][m0];[m0]scale=16:18,scale=1968:2184:flags=neighbor[b0];"
set -- $RECTS; N=$#; F+="[s]split=$N"; for i in $(seq 1 $N); do F+="[c$i]"; done; F+=";"
i=0; for r in $RECTS; do i=$((i+1)); IFS=, read -r x y w h <<<"$r"; F+="[c$i]crop=$w:$h:$x:$y[k$i];[b$((i-1))][k$i]overlay=$x:$y[b$i];"; done
F+="[b$N]scale=492:546"
ffmpeg -v error -y -i "$G/c-dots.png" -filter_complex "$F" -frames:v 1 "$T/c.png"
ffmpeg -v error -y -i "$T/a.png" -i "$T/c.png" -i "$G/d-after.png" -filter_complex "[0:v]format=rgb24,pad=498:552:3:3:red[x];[1:v]format=rgb24,pad=498:552:3:3:red[y];[2:v]format=rgb24,scale=492:546,pad=498:552:3:3:red[z];[x][y][z]hstack=3" -frames:v 1 -q:v 5 "$OUT"
