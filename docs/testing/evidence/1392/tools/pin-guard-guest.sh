#!/system/bin/sh
# StaticForge #1392 part D: clears the lane emulator's throwaway PIN 1234 after <seconds>, whatever happened to the caller.
#   setsid sh pin-guard-guest.sh <seconds> >/dev/null 2>&1 &      (root or shell; the caller kills it once it cleared the PIN itself)
echo $$ > /data/local/tmp/s1392d-guard.pid
sleep ${1:-1800}
locksettings clear --old 1234 > /data/local/tmp/s1392d-guard.fired 2>&1
locksettings set-disabled true >> /data/local/tmp/s1392d-guard.fired 2>&1
date >> /data/local/tmp/s1392d-guard.fired
