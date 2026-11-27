#!/system/bin/sh
# StaticForge #1392 part D (runs inside a lane emulator as root, beside stall-watch-guest.sh, which does the kill and keeps the
# logcat and the traces): from the moment a NEW app process appears, about every 0.2 s for <seconds> s, one line with the main
# thread's and the "MelatonLock" thread's state, schedstat (ns on a CPU, ns waiting for one, slices) and the latter's wchan;
# an ART thread dump (SIGQUIT, the app only) at +4 s and +8 s. No debuggerd, nothing sent to system_server.
#   sh thread-sample-guest.sh <old main pid> [seconds]
PKG=jp.net.seventhreeseven.dreamscape
O=/data/local/tmp/s1392d-ts
OLD=$1; DUR=${2:-25}
rm -rf $O; mkdir -p $O
S=$(date +%s); P=''
while [ -z "$P" ] && [ $(( $(date +%s) - S )) -lt 180 ]; do
  for q in $(pidof $PKG); do [ "$q" != "$OLD" ] && P=$q; done
  [ -n "$P" ] && break
  sleep 0.1
done
[ -n "$P" ] || { echo "no new process" > $O/lock-thread.txt; : > $O/done; exit 1; }
echo "$(date +%s%3N) saw new pid $P" > $O/lock-thread.txt
( sleep 4; echo "$(date +%s%3N) SIGQUIT +4 s" >> $O/dumps.txt; kill -3 $P; sleep 4; echo "$(date +%s%3N) SIGQUIT +8 s" >> $O/dumps.txt; kill -3 $P ) &
L=''; S=$(date +%s)
while [ $(( $(date +%s) - S )) -lt $DUR ] && [ -d /proc/$P ]; do
  if [ -z "$L" ]; then for t in /proc/$P/task/*; do read -r c < $t/comm 2>/dev/null; [ "$c" = MelatonLock ] && { L=${t##*/}; break; }; done; fi
  read -r ms < /proc/$P/task/$P/schedstat
  ls=''; lw=''
  if [ -n "$L" ]; then read -r ls < /proc/$P/task/$L/schedstat; lw="$(sed 's/^.*) //' /proc/$P/task/$L/stat | cut -c1) $(cat /proc/$P/task/$L/wchan)"; fi
  echo "$(date +%s%3N) main[$(sed 's/^.*) //' /proc/$P/task/$P/stat | cut -c1) $ms] lock tid=${L:--} [$ls] $lw" >> $O/lock-thread.txt
  sleep 0.2
done
wait
chmod -R a+rX $O
: > $O/done
