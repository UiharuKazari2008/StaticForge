#!/bin/bash
# Build jxl-pipe (lossless JPEG -> JPEG XL repacking for Alchemy's frames on slow links, #990 round 2) against the
# libjxl the host already has (Debian 13: libjxl0.11, pulled in by Chromium / ffmpeg). The headers come from the
# libjxl-dev package, unpacked into a temp dir (no root, nothing installed). Output: $ALCHEMY_DATA_DIR or
# ~/.local/share/dreamscape / alchemy-jxl-pipe, which server.js uses when present.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${ALCHEMY_DATA_DIR:-$HOME/.local/share/dreamscape}/alchemy-jxl-pipe"
WORK="$(mktemp -d "$HOME/.cache/jxl-build.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
LIB="$(ls /lib/x86_64-linux-gnu/libjxl.so.0.* 2>/dev/null | head -1)"
[ -n "$LIB" ] || { echo "libjxl is not installed (apt install libjxl0.11)"; exit 1; }
( cd "$WORK" && apt-get download libjxl-dev >/dev/null && dpkg-deb -x libjxl-dev_*.deb dev )
THREADS="$(ls /lib/x86_64-linux-gnu/libjxl_threads.so.0.* 2>/dev/null | head -1)"
gcc -O2 -Wall "$HERE/jxl-pipe.c" -I "$WORK/dev/usr/include" "$LIB" "$THREADS" -o "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "built $OUT against $LIB"
