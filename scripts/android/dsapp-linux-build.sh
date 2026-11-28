#!/bin/bash
# Linux part of a server Android build on a rack host (Fat Misaka): send the source zip over, build the signed release APK in the
# dsapp build image (JDK 21 + Android SDK 36, the image rackd's dsapp preset uses) and fetch it. The same steps as Ruiko's build-latest.ps1:
# gradlew assembleRelease, zipalign -p 4, apksigner with the shared debug key (cert 5c7b3ecc), so phones accept the update.
# The key lives only on the host (root-only, /etc/rackd/secrets/dsapp/debug.keystore) and is mounted read-only into the container;
# it is never copied here and never printed. Run by modules/androidBuilds.js under flock on the joint build lock.
# usage: dsapp-linux-build.sh <host> <image> <secrets dir> <work dir> <source zip> <apk out>
# Exit codes: 11 sending the source failed, 12 no APK came back (infrastructure); 21 the build itself failed (a compile error).
set -u
H=${1:?host}; IMG=${2:?image}; SEC=${3:?secrets dir}; WD=${4:?work dir}; Z=${5:?zip}; OUT=${6:?apk out}
echo "sending the source to $H"
scp -q "$Z" "$H:/tmp/dsapp-src.zip" || { echo "BUILD HOST: sending the source failed"; exit 11; }
ssh -o ConnectTimeout=10 "$H" "sudo bash -s" <<REMOTE
set -u
WD='$WD'; IMG='$IMG'; SEC='$SEC'
command -v unzip >/dev/null || { echo "BUILD HOST: no unzip"; exit 11; }
[ -r "\$SEC/debug.keystore" ] || { echo "BUILD HOST: no signing key at \$SEC (root-only)"; exit 11; }
docker image inspect "\$IMG" >/dev/null 2>&1 || { echo "BUILD HOST: image \$IMG is missing"; exit 11; }
mkdir -p "\$WD/cache" "\$WD/out"
rm -rf "\$WD/src" "\$WD/out"/*
mkdir -p "\$WD/src"
unzip -q /tmp/dsapp-src.zip -d "\$WD/src" || { echo "BUILD HOST: unpacking the source failed"; exit 11; }
rm -f /tmp/dsapp-src.zip
echo "building in \$IMG"
docker run --rm --cpus 24 --memory 32g -v "\$WD/src:/work/src" -v "\$WD/cache:/cache" -v "\$WD/out:/out" -v "\$SEC:/secrets:ro" \
  -w /work/src -e GRADLE_OPTS=-Xmx8g "\$IMG" bash -c '
set -eo pipefail
chmod +x ./gradlew
printf "sdk.dir=/opt/android-sdk\n" > local.properties
./gradlew --no-daemon --console=plain -q assembleRelease 2>&1 | tail -60
u=\$(ls app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)
[ -n "\$u" ] || { echo "NO APK"; exit 21; }
bt=\$(ls -d /opt/android-sdk/build-tools/* | sort -V | tail -1)
"\$bt/zipalign" -f -p 4 "\$u" /tmp/aligned.apk
"\$bt/apksigner" sign --ks /secrets/debug.keystore --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out /out/dsapp.apk /tmp/aligned.apk
"\$bt/apksigner" verify --print-certs /out/dsapp.apk 2>&1 | grep -E "certificate SHA-256"
' ; rc=\$?
[ \$rc -eq 0 ] || exit 21
REMOTE
rc=$?
[ $rc -eq 0 ] || exit $rc
echo "fetching the APK"
ssh "$H" "sudo cat '$WD/out/dsapp.apk'" > "$OUT" || { echo "BUILD HOST: no APK came out (NO APK)"; exit 12; }
[ -s "$OUT" ] || { echo "BUILD HOST: no APK came out (NO APK)"; exit 12; }
echo "APK received"
