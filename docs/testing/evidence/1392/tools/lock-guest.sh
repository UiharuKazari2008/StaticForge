#!/system/bin/sh
# StaticForge #1392 part C, lock screen: with the lane emulator locked and its display off, notes the app's windows, then
# switches the display on, records logical display 0 from the first moment it can and takes screencaps. Silent: KEYCODE_WAKEUP only.
#   sh lock-guest.sh <old main pid | -> <seconds until the wake> [sample offsets in s before the wake]
# <old pid>: the sample offsets and the wake count from the moment a NEW main process appears (stall-watch-guest.sh does the kill);
# "-": they count from now (the running process). Output in /data/local/tmp/s1392-wake/.
PKG=jp.net.seventhreeseven.dreamscape
D=/data/local/tmp/s1392-wake
O=$D/wake.txt
OLD=$1; AFTER=${2:-20}; SAMPLES=${3:-"3 8 13 18"}
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
echo "display 0 physical id $D0" >> $O
state() { # keyguard, wakefulness, and in z-order (top first) the visible windows plus every Melaton / shade window
  k=$(dumpsys window 2>/dev/null | grep -m1 -o 'isKeyguardShowing=[a-z]*')
  w=$(dumpsys power 2>/dev/null | grep -m1 -o 'mWakefulness=[A-Za-z]*')
  l=$(dumpsys window windows 2>/dev/null | awk '/^  Window #/ { z=$2; n=$0; sub(/.* u0 /,"",n); sub(/}.*/,"",n); vv="?" } /mViewVisibility=/ { vv=$1; sub(/.*=/,"",vv) } /mHasSurface=/ { hs=$1; sub(/.*=/,"",hs) } /isOnScreen=/ { split($0,a,"="); on=a[2] } /isVisible=/ { split($0,a,"="); if (a[2]=="true" || n ~ /MelatonLock|NotificationShade/) printf "%s %s(viewVis=%s,surface=%s,onScreen=%s,visible=%s); ", z, n, vv, hs, on, a[2] }')
  echo "$(date +%s%3N) $1: $k $w windows[top first]: $l" >> $O
}
last=0
for at in $SAMPLES; do sleep $(( at - last )); last=$at; state "off +${at}s"; done
sleep $(( AFTER - last ))
echo "$(date +%s%3N) KEYCODE_WAKEUP" >> $O
input keyevent 224
echo "$(date +%s%3N) KEYCODE_WAKEUP returned" >> $O
# screenrecord cannot start on a display that is off (UNASSIGNED_LAYER_STACK): started right after the wake, again until it records
( i=0; while [ $i -lt 30 ]; do i=$((i+1)); echo "$(date +%s%3N) screenrecord try $i" >> $D/rec.log; screenrecord --display-id $D0 --time-limit 5 --bit-rate 4000000 $D/rec.mp4 >> $D/rec.log 2>&1; [ -s $D/rec.mp4 ] && break; sleep 0.1; done ) &
R=$!
state "just after the wake"
echo "$(date +%s%3N) shot a begin" >> $O
screencap ${D0:+-d $D0} -p $D/a.png 2>/dev/null
echo "$(date +%s%3N) shot a end" >> $O
sleep 3
echo "$(date +%s%3N) shot b begin" >> $O
screencap ${D0:+-d $D0} -p $D/b.png 2>/dev/null
echo "$(date +%s%3N) shot b end" >> $O
state "after shot b"
wait $R
echo "$(date +%s%3N) screenrecord ended ($?)" >> $O
chmod -R a+rX $D
: > $D/done
