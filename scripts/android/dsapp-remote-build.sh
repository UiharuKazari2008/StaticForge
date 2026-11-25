#!/bin/bash
# Remote part of a server Android build (#821): send the source zip to the build host, unpack it, run its
# build script, fetch the APK. Run by modules/androidBuilds.js under flock on the manual joint build's lock
# (~/.cache/claude-run/dsapp-joint-build.lock) so this and scripts a session runs by hand never collide.
# usage: dsapp-remote-build.sh <host> <dir> <folder> <script> <source zip> <apk out>
# <dir> is the build host's folder (C:/Users/ykaza/claude-build), <folder> the unpacked source's folder
# (the build script builds "dsapp-latest" and writes <folder>.apk beside it), <script> its build script in <dir>.
# The arguments come from config and are checked by the module; they hold no quotes, spaces or shell characters.
set -u
H=${1:?host}; D=${2:?dir}; F=${3:?folder}; S=${4:?script}; Z=${5:?zip}; OUT=${6:?apk out}
echo "sending the source to $H"
scp -q "$Z" "$H:$D/$F.zip" || { echo "BUILD HOST: sending the source failed"; exit 11; }
ssh -o ConnectTimeout=10 "$H" "Remove-Item -Force -ErrorAction SilentlyContinue '$D/$F.apk'"
echo "unpacking and building on $H"
ssh "$H" "\$d='$D/$F'; if (Test-Path \$d) { Remove-Item -Recurse -Force \$d }; Expand-Archive -Path '$D/$F.zip' -DestinationPath \$d; powershell -ExecutionPolicy Bypass -File '$D/$S'" 2>&1
echo "fetching the APK"
scp -q "$H:$D/$F.apk" "$OUT" || { echo "BUILD HOST: no APK came out (NO APK)"; exit 12; }
echo "APK received"
