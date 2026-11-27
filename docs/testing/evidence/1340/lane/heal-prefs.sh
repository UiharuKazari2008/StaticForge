#!/bin/bash
# heal-prefs.sh <id> show | write <age-seconds,...>   bars_heal.xml of a LANE emulator (root shell). write: "switches" = device
# clock minus each age, "faultAt" removed; the file is overwritten in place (inode, owner, mode, SELinux label kept).
set -u
I=${1:?id}; case "$I" in aemu-*) ;; *) echo refused; exit 2;; esac
cd /home/kanmi/staticforge || exit 1
L="scripts/aemu-lane/lane.sh --agent claude-f80b3b73"
D=/data/data/jp.net.seventhreeseven.dreamscape/shared_prefs
SHOW="date '+%T.%3N devicems='\$(date +%s%3N); ls -liZ $D/bars_heal.xml*; cat $D/bars_heal.xml; echo"
case "${2:?show|write}" in
  show) $L $I su "$SHOW" | tr -d '\r';;
  clear) $L $I su "F=$D/bars_heal.xml
echo BEFORE; cat \$F; echo
printf '%s\n' \"<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\" '<map />' > \$F
restorecon \$F >/dev/null 2>&1
echo AFTER; $SHOW" | tr -d '\r';;
  write)
    # the guest's sh does 32-bit arithmetic: the stamps are computed HERE (64-bit) from the device clock
    NOW=$($L $I sh 'date +%s%3N' | tr -d '\r'); case "$NOW" in [0-9]*) ;; *) echo "no device clock"; exit 1;; esac
    STAMPS=''; for a in $(echo "${3:?ages}" | tr ',' ' '); do STAMPS="${STAMPS:+$STAMPS,}$((NOW - a * 1000))"; done
    echo "device clock used: $NOW"
    $L $I su "F=$D/bars_heal.xml
[ -f \$F ] || { echo 'no bars_heal.xml'; exit 1; }
[ -f \$F.bak ] && { echo 'a .bak exists: stop'; exit 1; }
echo BEFORE; ls -liZ \$F; cat \$F; echo
S=$STAMPS
printf '%s\n' \"<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\" '<map>' \"    <string name=\\\"switches\\\">\$S</string>\" '</map>' > \$F
restorecon \$F
echo AFTER; $SHOW" | tr -d '\r';;
esac
