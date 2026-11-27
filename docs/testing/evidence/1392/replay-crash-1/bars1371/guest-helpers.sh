# bars1371 guest helper: pushed by scripts/aemu-lane/tests/bars-row-1371-lane.sh, removed by its `end` step.
PKG=jp.net.seventhreeseven.dreamscape
D=/data/local/tmp
N=melaton_navblank
PF=$D/bars1371-sampler.pid
OUT=$D/bars1371-sample.txt
c=$1
[ $# -gt 0 ] && shift
rec_count() { dumpsys statusbar 2>/dev/null | grep -c 'pkg=com.android.shell token'; }
join() { tr ' ' ','; }
vc() {
  v=$(pm list packages --show-versioncode 2>/dev/null | grep "^package:$PKG versionCode:" | sed 's/.*versionCode://; s/[^0-9].*//' | head -1)
  [ -n "$v" ] || v=$(dumpsys package $PKG 2>/dev/null | sed -n 's/^ *versionCode=\([0-9]*\).*/\1/p' | head -1)
  echo "$v"
}
procline() {
  q=$1
  s=$(cat /proc/$q/stat 2>/dev/null)
  [ -n "$s" ] || return 1
  r=$(echo "$s" | sed 's/^.*) //')
  set -- $r
  echo "pid=$q ppid=$2 pgrp=$3 sid=$4 uid=$(grep '^Uid:' /proc/$q/status 2>/dev/null | cut -f2) comm=[$(cat /proc/$q/comm 2>/dev/null)] cmd=[$(tr '\0' ' ' < /proc/$q/cmdline 2>/dev/null | cut -c1-300)] cgroup=[$(tr '\n' ' ' < /proc/$q/cgroup 2>/dev/null)] ctx=[$(tr -d '\0' < /proc/$q/attr/current 2>/dev/null)]"
  return 0
}
case $c in
selftest) echo "ms=$(date +%s%3N)";;
clock) echo "$(date +%s%3N) $(date '+%s %Y-%m-%d %H:%M:%S')";;
quick)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  echo "holder=${h:--} app=${a:--} recs=$(rec_count)";;
state)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  o=$(cat $D/$N.out 2>/dev/null | tr '\n' ' ')
  echo "holder=${h:--} app=${a:--} recs=$(rec_count) out=[$o] vc=$(vc) shizuku=$(pidof shizuku_server | join) adbd=$(pidof adbd | join) mode=$(settings get secure navigation_mode) overlay=$(cmd overlay list 2>/dev/null | grep -E '\[x\].*navbar' | sed 's/.*navbar\.//' | tr '\n' ,)";;
vc) vc;;
obs)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  b=$(dumpsys accessibility 2>/dev/null | grep 'Bound services' | grep -ci 'melaton')
  sv=$(settings get secure enabled_accessibility_services | grep -c 'MelatonBarService')
  o=$(cmd overlay list 2>/dev/null | grep -E '\[x\].*navbar' | sed 's/.*navbar\.//' | tr '\n' ,)
  echo "ms=$(date +%s%3N) holder=${h:--} app=${a:--} bound=$b svc=$sv ovl=${o:--} recs=$(rec_count)";;
procs) echo "shizuku=$(pidof shizuku_server | join) adbd=$(pidof adbd | join) holder=$(pidof $N | join) app=$(pidof $PKG | join)";;
chain)
  q=$1; n=0
  while [ -n "$q" ] && [ "$q" -gt 0 ] 2>/dev/null && [ $n -lt 10 ]; do
    l=$(procline $q) || break
    echo "$l"
    q=$(echo "$l" | sed 's/^pid=[0-9]* ppid=\([0-9]*\).*/\1/')
    n=$((n+1))
  done;;
procline) procline $1;;
psrows) ps -A -o PID,PPID,NAME | sed -n 1p; ps -A -o PID,PPID,NAME | grep -E "^ *($1|$2) ";;
a11y) dumpsys accessibility 2>/dev/null | grep -E 'Bound services|Crashed services|Binding services';;
pids)
  h=$(pidof $N | join); a=$(pidof $PKG | join)
  echo "holder=${h:--} app=${a:--} recs=-";;
sample)
  ME=$$; K=0; LT=0
  for x in "$@"; do [ "$x" = keep ] && K=1; [ "$x" = light ] && LT=1; done
  [ $K = 1 ] || : > $OUT
  echo $ME > $PF
  i=0
  while [ "$(cat $PF 2>/dev/null)" = "$ME" ] && [ $i -lt 6000 ]; do
    t=$(date +%s%3N)
    if [ $LT = 1 ]; then r=-; else r=$(rec_count); fi
    h=$(pidof $N | join)
    a=$(pidof $PKG | join)
    echo "$t recs=$r pids=${h:--} app=${a:--}" >> $OUT
    i=$((i+1))
    sleep 0.2
  done;;
sampler)
  p=$(cat $PF 2>/dev/null)
  if [ -n "$p" ] && [ -d /proc/$p ]; then echo "alive $p lines=$(wc -l < $OUT)"; else echo dead; fi;;
sampler-stop) rm -f $PF;;
snap)
  U=$(pm list packages -U 2>/dev/null | grep "^package:$PKG " | sed 's/.*uid://; s/[^0-9].*//' | head -1)
  [ -n "$U" ] || U=none
  w=$(dumpsys power 2>/dev/null | grep -i wake | grep -E "uid=$U[ )]|[{ ]$U[ }]|$PKG")
  h=$(pidof $N | join)
  f=$(pidof $N | sed 's/ .*//')
  echo "snap ms=$(date +%s%3N) holder=${h:--} wl=$(echo "$w" | grep -c .) outmt=$(stat -c %Y $D/$N.out 2>/dev/null) vcs=$(grep '^voluntary_ctxt_switches' /proc/${f:-0}/status 2>/dev/null | tr -dc 0-9) uid=$U"
  echo "$w" | grep . | sed 's/^/WL: /'
  if [ "$1" = full ]; then echo "alarms=$(dumpsys alarm 2>/dev/null | grep -c "$PKG")"; fi;;
end) rm -f $PF $OUT $D/bars1371-g.sh;;
*) echo "unknown helper command: $c"; exit 2;;
esac
