#!/system/bin/sh
# StaticForge #1392 part C: switches the lane emulator's display on <after> seconds after a new Dreamscape main process appears,
# then takes screencaps (display 0) and notes which of the app's windows are visible, at about +1, +2.5, +5 and +13 s after the wake.
#   sh wake-guest.sh <old main pid> <after seconds>
# Runs inside a lane emulator beside stall-watch-guest.sh (which does the kill). Silent: KEYCODE_WAKEUP only.
PKG=jp.net.seventhreeseven.dreamscape
D=/data/local/tmp/s1392-wake
O=$D/wake.txt
OLD=$1; AFTER=${2:-3}
rm -rf $D; mkdir -p $D; : > $O
S=$(date +%s); P=''
while [ -z "$P" ] && [ $(( $(date +%s) - S )) -lt 180 ]; do
  for q in $(pidof $PKG); do [ "$q" != "$OLD" ] && P=$q; done
  [ -n "$P" ] && break
  sleep 0.1
done
[ -n "$P" ] || { echo "$(date +%s%3N) no new process" >> $O; : > $D/done; exit 1; }
echo "$(date +%s%3N) saw new pid $P" >> $O
sleep $AFTER
echo "$(date +%s%3N) KEYCODE_WAKEUP" >> $O
input keyevent 224
echo "$(date +%s%3N) KEYCODE_WAKEUP returned" >> $O
# screencap without -d takes either built-in display of the fold: name the physical id of logical display 0 (the inner screen)
D0=$(dumpsys display 2>/dev/null | grep -o 'uniqueId="local:[0-9]*"' | head -1 | tr -dc '0-9')
echo "display 0 physical id $D0" >> $O
wins() { # the app's windows (Melaton*): name + isOnScreen + isVisible
  dumpsys window windows 2>/dev/null | awk '/^  Window #/ { n=$0; sub(/.* u0 /,"",n); sub(/}.*/,"",n) } /isOnScreen=/ { split($0,a,"="); s=a[2] } /isVisible=/ { split($0,a,"="); if (n ~ /Melaton/) printf "%s(onScreen=%s,visible=%s) ", n, s, a[2] }'
}
for step in 0.7:a 0.8:b 1.8:c 7:d; do
  sleep ${step%:*}; k=${step#*:}
  echo "$(date +%s%3N) shot $k begin" >> $O
  screencap ${D0:+-d $D0} -p $D/$k.png 2>/dev/null
  echo "$(date +%s%3N) shot $k end" >> $O
  echo "$(date +%s%3N) windows $k: $(wins)" >> $O
done
chmod -R a+rX $D
: > $D/done
