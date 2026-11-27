# guest-s6.sh: guest helper for StaticForge #1379 S6 on aemu-fold-2. Pushed to /data/local/tmp/s6.sh, run as root (su 0), removed at the end.
PKG=jp.net.seventhreeseven.dreamscape
N=melaton_navblank
D=/data/local/tmp/s6
P=5599
mkdir -p $D; chmod 777 $D 2>/dev/null
c=$1
[ $# -gt 0 ] && shift
ms() { date +%s%3N; }
join() { tr ' ' ','; }
lpid() { ss -ltnp 2>/dev/null | grep "127.0.0.1:$P " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1; }
lstop() {
  q=$(lpid)
  [ -n "$q" ] && kill $q 2>/dev/null
  rm -f $D/mode
}
lstart() { # lstart reject|forward
  lstop
  i=0; while [ -n "$(lpid)" ] && [ $i -lt 50 ]; do sleep 0.05; i=$((i+1)); done
  if [ "$1" = reject ]; then
    # accepts every connection and closes it at once
    setsid sh -c 'echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null; exec toybox nc -s 127.0.0.1 -L -p 5599 true' >$D/listener.log 2>&1 </dev/null &
  else
    # every connection relayed to the real adbd
    setsid sh -c 'echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null; exec toybox nc -s 127.0.0.1 -L -p 5599 toybox nc 127.0.0.1 5555' >$D/listener.log 2>&1 </dev/null &
  fi
  i=0; while [ -z "$(lpid)" ] && [ $i -lt 100 ]; do sleep 0.02; i=$((i+1)); done
  echo $1 > $D/mode
}
probe() { # probe <port>: an ADB CNXN packet from outside the app; the first bytes of the answer
  # stdin is held open 1 s: adbd drops a connection whose sender closes before the answer
  ( printf 'CNXN\000\000\000\001\000\020\000\000\007\000\000\000\062\002\000\000\274\261\247\261host::\000'; sleep 1 ) | timeout 4 toybox nc -w 3 127.0.0.1 $1 > $D/probe.bin 2>$D/probe.err
  echo "probe port=$1 bytes=$(wc -c < $D/probe.bin) first4hex=$(head -c 4 $D/probe.bin | xxd -p) (CNXN=434e584e) banner=[$(tail -c +25 $D/probe.bin | head -c 48 | strings -n 4 | head -1)] err=[$(cat $D/probe.err | head -1)]"
}
one() {
  d=$(dumpsys statusbar 2>/dev/null)
  t=$(ms)
  recs=$(echo "$d" | grep -c 'pkg=com.android.shell token')
  w=$(echo "$d" | grep 'pkg=com.android.shell token' | sed 's/.*what1=\(0x[0-9a-fA-F]*\).*/\1/' | tr '\n' ',')
  lk=$(echo "$d" | grep 'StatusBarShellCommandToken' | sed 's/.*what1=\(0x[0-9a-fA-F]*\) what2=\(0x[0-9a-fA-F]*\).*/\1:\2/' | tr '\n' ',')
  net=$(echo "$d" | grep -A1 'displayId=0$' | sed -n 's/.*mDisabled1=\(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
  h=$(pidof $N | join); a=$(pidof $PKG | join); z=$(pidof shizuku_server | join); b=$(pidof adbd | join)
  m=$(cat $D/mode 2>/dev/null)
  echo "$t recs=$recs what1=${w:--} lockrec=${lk:--} net=${net:--} holder=${h:--} app=${a:--} shz=${z:--} adbd=${b:--} l5599=${m:-none}"
}
case $c in
one) one;;
reject-start) lstart reject; echo "reject listener pid=$(lpid) at $(ms)";;
forward-start) lstart forward; echo "forwarder pid=$(lpid) at $(ms)";;
listener-stop) lstop; sleep 0.3; echo "listener on $P: [$(lpid)]";;
listener) echo "mode=$(cat $D/mode 2>/dev/null) pid=$(lpid) cmd=[$(tr '\0' ' ' < /proc/$(lpid)/cmdline 2>/dev/null)]";;
probe) probe ${1:-$P};;
sample) # sample <file>
  echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null
  : > $1; chmod 666 $1
  echo $$ > $D/sampler.pid
  i=0
  while [ "$(cat $D/sampler.pid 2>/dev/null)" = "$$" ] && [ $i -lt 4000 ]; do one >> $1; i=$((i+1)); sleep 0.17; done;;
sampler-stop) rm -f $D/sampler.pid;;
tcp-start) # tcp-start <file>: passive record of every packet of the app-side port (loopback)
  setsid sh -c "echo \$\$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null; echo \$\$ > $D/tcpdump.pid; exec tcpdump -i lo -nn -tt -l 'tcp port $P'" > $1 2>$D/tcpdump.err </dev/null &
  sleep 1; echo "tcpdump pid=$(cat $D/tcpdump.pid) $(head -2 $D/tcpdump.err | tr '\n' ' ')";;
tcp-stop) q=$(cat $D/tcpdump.pid 2>/dev/null); [ -n "$q" ] && kill -INT $q 2>/dev/null; rm -f $D/tcpdump.pid; echo stopped;;
run) # run <log> <minSwapMs>: kill app + holder together, keep the reject listener until the app logged its first failed hold AND
     # <minSwapMs> passed since the new process's "Start proc"; then swap in the forwarder; then probes from outside at fixed offsets.
  echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null
  L=$1; MIN=$2
  : > $L; chmod 666 $L
  old=$(pidof $PKG); h=$(pidof $N)
  echo "$(ms) before: app=$old holder=$h shizuku_server=[$(pidof shizuku_server)] listener=$(cat $D/mode) pid=$(lpid)" >> $L
  echo "$(ms) $(probe $P)  (while the reject listener is up)" >> $L
  tk=$(ms)
  kill -9 $old $h
  echo "$tk kill -9 app $old and holder $h (one command)" >> $L
  new=''; i=0
  while [ $i -lt 600 ]; do new=$(pidof $PKG); [ -n "$new" ] && [ "$new" != "$old" ] && break; sleep 0.05; i=$((i+1)); done
  [ -z "$new" ] && { echo "$(ms) no new app process within 30 s" >> $L; exit 1; }
  echo "$(ms) new app pid seen: $new" >> $L
  sp=''; i=0
  while [ -z "$sp" ] && [ $i -lt 50 ]; do sp=$(logcat -d -v epoch -b system -t 600 2>/dev/null | grep "Start proc $new:$PKG" | tail -1 | awk '{print $1}' | tr -d '.'); sleep 0.1; i=$((i+1)); done
  [ -z "$sp" ] && { sp=$(ms); echo "$(ms) no Start proc line found, using now" >> $L; }
  echo "$sp Start proc of $new (ActivityManager log time)" >> $L
  nf=0; t=$(ms)
  while :; do
    nf=$(logcat -d -v epoch -b main --pid=$new -s MelatonBars:V 2>/dev/null | grep -c 'could not be emptied')
    t=$(ms)
    [ "$nf" -ge 1 ] && [ $((t - sp)) -ge $MIN ] && break
    [ $((t - sp)) -ge 60000 ] && { echo "$t no failed hold within 60 s" >> $L; break; }
    sleep 0.1
  done
  echo "$(ms) swap: failed holds logged so far: $nf, $(( $(ms) - sp )) ms after Start proc" >> $L
  lstart forward
  echo "$(ms) forwarder up pid=$(lpid), $(( $(ms) - sp )) ms after Start proc; failed holds logged now: $(logcat -d -v epoch -b main --pid=$new -s MelatonBars:V 2>/dev/null | grep -c 'could not be emptied')" >> $L
  echo "$(ms) $(probe $P)  (through the forwarder, right after the swap)" >> $L
  for at in 30 60 90 125; do
    while [ $(( $(ms) - sp )) -lt $((at * 1000)) ]; do sleep 0.5; done
    echo "$(ms) +${at}s $(probe $P) app=$(pidof $PKG) holder=[$(pidof $N)] shizuku_server=[$(pidof shizuku_server)]" >> $L
  done
  echo "$(ms) run done" >> $L;;
*) echo "unknown: $c"; exit 2;;
esac
