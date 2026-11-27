# lockrec: the record of the app's `cmd statusbar send-disable-flag` (pkg=android, StatusBarShellCommandToken), what1:what2; added before TEST 3.
# g1379 guest helper (StaticForge #1379 proof on aemu-fold-2). Pushed to /data/local/tmp/g1379.sh, removed at the end.
PKG=jp.net.seventhreeseven.dreamscape
D=/data/local/tmp
N=melaton_navblank
PF=$D/g1379-sampler.pid
OUT=$D/g1379-sample.txt
c=$1
[ $# -gt 0 ] && shift
join() { tr ' ' ','; }
procline() {
  q=$1
  s=$(cat /proc/$q/stat 2>/dev/null)
  [ -n "$s" ] || return 1
  r=$(echo "$s" | sed 's/^.*) //')
  set -- $r
  echo "pid=$q ppid=$2 pgrp=$3 sid=$4 uid=$(grep '^Uid:' /proc/$q/status 2>/dev/null | cut -f2) comm=[$(cat /proc/$q/comm 2>/dev/null)] cmd=[$(tr '\0' ' ' < /proc/$q/cmdline 2>/dev/null | cut -c1-200 | sed 's/  *$//')] cgroup=[$(grep '^0::' /proc/$q/cgroup 2>/dev/null)] ctx=[$(tr -d '\0' < /proc/$q/attr/current 2>/dev/null)]"
}
chain() {
  q=$1; n=0
  while [ -n "$q" ] && [ "$q" -gt 0 ] 2>/dev/null && [ $n -lt 10 ]; do
    l=$(procline $q) || break
    echo "  $l"
    q=$(echo "$l" | sed 's/^pid=[0-9]* ppid=\([0-9]*\).*/\1/')
    n=$((n+1))
  done
}
one() { # one sample line: one dumpsys statusbar call, so records and net flags are of the same moment
  d=$(dumpsys statusbar 2>/dev/null)
  t=$(date +%s%3N)
  recs=$(echo "$d" | grep -c 'pkg=com.android.shell token')
  w=$(echo "$d" | grep 'pkg=com.android.shell token' | sed 's/.*what1=\(0x[0-9a-fA-F]*\).*/\1/' | tr '\n' ',')
  lk=$(echo "$d" | grep 'StatusBarShellCommandToken' | sed 's/.*what1=\(0x[0-9a-fA-F]*\) what2=\(0x[0-9a-fA-F]*\).*/\1:\2/' | tr '\n' ',')
  net=$(echo "$d" | grep -A1 'displayId=0$' | sed -n 's/.*mDisabled1=\(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
  h=$(pidof $N | join); a=$(pidof $PKG | join); u=$(pidof $PKG:shell | join); z=$(pidof shizuku_server | join); b=$(pidof adbd | join)
  echo "$t recs=$recs what1=${w:--} lockrec=${lk:--} net=${net:--} holder=${h:--} app=${a:--} usersvc=${u:--} shz=${z:--} adbd=${b:--}"
}
case $c in
one) one;;
who) # full parent chain / cgroup / process group of everything involved
  for pair in "adbd:$(pidof adbd)" "shizuku_server:$(pidof shizuku_server)" "userservice:$(pidof $PKG:shell)" "holder:$(pidof $N)" "app:$(pidof $PKG)"; do
    name=${pair%%:*}; pids=${pair#*:}
    if [ -z "$pids" ]; then echo "$name: none"; continue; fi
    for p in $pids; do echo "$name pid $p, parent chain:"; chain $p; done
  done;;
state)
  one
  echo "out=[$(cat $D/$N.out 2>/dev/null | tr '\n' '|')] moveout=$([ -e $D/$N.move.out ] && echo "PRESENT[$(cat $D/$N.move.out | tr '\n' '|')]" || echo absent)"
  dumpsys statusbar 2>/dev/null | grep -E 'pkg=com.android.shell token|StatusBarShellCommandToken'
  echo "navmode=$(settings get secure navigation_mode) overlay=$(cmd overlay list 2>/dev/null | grep -E '\[x\].*navbar' | sed 's/.*navbar\.//' | tr '\n' ,)";;
a11y) dumpsys accessibility 2>/dev/null | grep -E 'Bound services|Crashed services|Binding services';;
sample) # runs as root (su 0), moved out of adbd's cgroup so an adbd restart does not take it down
  echo $$ > /sys/fs/cgroup/cgroup.procs 2>/dev/null
  : > $OUT; chmod 666 $OUT
  echo $$ > $PF; chmod 666 $PF
  i=0
  while [ "$(cat $PF 2>/dev/null)" = "$$" ] && [ $i -lt 5000 ]; do
    one >> $OUT
    i=$((i+1))
    sleep 0.17
  done;;
sampler) p=$(cat $PF 2>/dev/null); if [ -n "$p" ] && [ -d /proc/$p ]; then echo "alive $p lines=$(wc -l < $OUT) $(grep '^0::' /proc/$p/cgroup)"; else echo dead; fi;;
sampler-stop) rm -f $PF;;
*) echo "unknown helper command: $c"; exit 2;;
esac
