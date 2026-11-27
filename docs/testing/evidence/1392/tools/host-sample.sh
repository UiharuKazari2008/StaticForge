#!/bin/bash
# host-sample.sh <seconds> <out file> : runs host-sample.ps1 on Ruiko over ssh (observation only), lines streamed to <out>.
HERE=$(cd "$(dirname "$0")" && pwd)
enc=$( { echo "\$DURATION = $1"; echo "\$AVD = '${LANE_ID:-aemu-fold-1}'"; cat "$HERE/host-sample.ps1"; } | iconv -f UTF-8 -t UTF-16LE | base64 -w0)
ssh -o ConnectTimeout=10 -o BatchMode=yes ruiko "powershell -NoProfile -NonInteractive -EncodedCommand $enc" </dev/null 2>/dev/null | sed -u 's/\r$//' | grep --line-buffered -v '^#< CLIXML\|^<Objs' > "$2"
