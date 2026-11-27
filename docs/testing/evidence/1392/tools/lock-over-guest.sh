#!/system/bin/sh
# StaticForge #1392 part C, lock screen: from the locked lane emulator, starts a program that shows over the lock screen without a
# sound and times how long Melaton's lock window stays over it. Default program: the Clock's screen saver activity (not exported,
# started as root). The secure still camera (arg 4 = camera) shows over the lock too, but the lane has no camera and the app crashes.
#   sh lock-over-guest.sh <old main pid | -> <seconds until the wake, or - when the display is on> <seconds after that until the program> [clock|camera]
# Runs as root inside a lane emulator.
# <old pid>: the waits count from the moment a NEW main process appears (the caller kills the old one). Output in /data/local/tmp/s1392-cam/.
PKG=jp.net.seventhreeseven.dreamscape
D=/data/local/tmp/s1392-wake
O=$D/wake.txt
OLD=$1; WAKE=$2; CAM=${3:-1}
if [ "${4:-clock}" = camera ]; then START="am start -a android.media.action.STILL_IMAGE_CAMERA_SECURE"
else START="am start -n com.google.android.deskclock/com.android.deskclock.ScreensaverActivity"; fi
rm -rf $D; mkdir -p $D; : > $O
S=$(date +%s); P=''
if [ "$OLD" != - ]; then
  while [ -z "$P" ] && [ $(( $(date +%s) - S )) -lt 180 ]; do
    for q in $(pidof $PKG); do [ "$q" != "$OLD" ] && P=$q; done
    [ -n "$P" ] && break
    sleep 0.1
  done
  [ -n "$P" ] || { echo "$(date +%s%3N) no new process" >> $O; : > $D/done; exit 1; }
  echo "$(date +%s%3N) saw new pid $P" >> $O
else echo "$(date +%s%3N) running process $(pidof $PKG)" >> $O; fi
D0=$(dumpsys display 2>/dev/null | grep -o 'uniqueId="local:[0-9]*"' | head -1 | tr -dc '0-9')
state() {
  l=$(dumpsys window windows 2>/dev/null | awk '/^  Window #/ { n=$0; sub(/.* u0 /,"",n); sub(/}.*/,"",n) } /isVisible=/ { split($0,a,"="); if (n == "MelatonLock") v=a[2] } END { print (v=="" ? "no-window" : v) }')
  f=$(dumpsys window displays 2>/dev/null | grep -m1 'mCurrentFocus=' | sed 's/.*mCurrentFocus=//; s/Window{[0-9a-f]* u0 //; s/}$//')
  k=$(dumpsys window 2>/dev/null | grep -m1 -o 'isKeyguardShowing=[a-z]*')
  o=$(dumpsys window 2>/dev/null | grep -m1 -o 'mKeyguardOccluded=[a-z]*')
  echo "MelatonLock visible=$l focus=[$f] $k $o"
}
if [ "$WAKE" != - ]; then
  sleep $WAKE
  echo "$(date +%s%3N) before the wake: $(state)" >> $O
  echo "$(date +%s%3N) KEYCODE_WAKEUP" >> $O
  input keyevent 224
fi
sleep $CAM
echo "$(date +%s%3N) before the program: $(state)" >> $O
echo "$(date +%s%3N) $START" >> $O
$START >> $D/am.txt 2>&1
echo "$(date +%s%3N) am start returned" >> $O
( sleep 1.5; echo "$(date +%s%3N) shot a begin" >> $O; screencap ${D0:+-d $D0} -p $D/a.png 2>/dev/null; echo "$(date +%s%3N) shot a end" >> $O
  sleep 9; echo "$(date +%s%3N) shot b begin" >> $O; screencap ${D0:+-d $D0} -p $D/b.png 2>/dev/null; echo "$(date +%s%3N) shot b end" >> $O ) &
SH=$!
last=''; S=$(date +%s)
while [ $(( $(date +%s) - S )) -lt 20 ]; do
  t0=$(date +%s%3N); s=$(state)
  [ "$s" != "$last" ] && echo "$t0..$(date +%s%3N) $s" >> $O
  last=$s
  sleep 0.1
done
echo "$(date +%s%3N) end: $(state)" >> $O
wait $SH
chmod -R a+rX $D
: > $D/done
