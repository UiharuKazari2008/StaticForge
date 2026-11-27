#!/bin/bash
# redact-lock.sh <1968x2184 screencap or frame of Melaton's lock screen> <out.png> : keeps only what proves the cover is ours (the
# time band, the slide handle and its caption). The Today picture is made a coarse mosaic and the handle's unread count is covered
# (StaticForge #1392 part C: no personal content in kept screenshots).
set -eu
ffmpeg -v error -y -i "$1" -filter_complex "[0:v]format=rgb24,split=3[a][b][c];[a]scale=16:18,scale=1968:2184:flags=neighbor[m];[b]crop=760:171:0:2013[band];[c]drawbox=x=962:y=134:w=88:h=66:color=black:t=fill,crop=440:186:763:106[sl];[m][band]overlay=0:2013[t];[t][sl]overlay=763:106,scale=492:546" -frames:v 1 "$2"
