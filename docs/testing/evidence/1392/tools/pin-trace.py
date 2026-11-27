# pin-trace.py <atrace text (sched + binder_driver)> <app main pid> : StaticForge #1392 part D. When each look for the PIN pad ran on
# the app's window-read lanes, how long it took, how much of it was on the CPU and how many binder calls it made, and when each
# answer came, relative to the trace's start (just before the OK tap). A "look" is a burst of a window-read thread's work; bursts
# more than GAP s apart with no binder call outstanding are separate looks.
import re, sys, collections
GAP = 0.12
path, main = sys.argv[1], sys.argv[2]
LINE = re.compile(r'^\s*(.+?)-(\d+)\s+\(\s*[\d-]+\)\s+\[\d+\]\s+\S+\s+([\d.]+):\s+(\w+):\s?(.*)$')
base = None; real = None
ev = collections.defaultdict(list); names = {}; wakes = []; run = collections.defaultdict(list); on = {}; procs = {}
for ln in open(path, errors='replace'):
    m = LINE.match(ln.rstrip('\n'))
    if not m: continue
    comm, tid, ts, kind, rest = m.group(1), m.group(2), float(m.group(3)), m.group(4), m.group(5)
    names[tid] = comm
    if kind == 'tracing_mark_write' and 'realtime_ts=' in rest:
        base, real = ts, int(rest.split('realtime_ts=')[1]) / 1000.0
    if kind == 'sched_switch':
        p = re.search(r'prev_pid=(\d+).*?==> next_comm=(.*?) next_pid=(\d+)', rest)
        if p:
            names.setdefault(p.group(3), p.group(2))
            if p.group(1) in on: run[p.group(1)].append((on.pop(p.group(1)), ts))
            on[p.group(3)] = ts
    elif kind == 'sched_waking':
        p = re.search(r'comm=(.*?) pid=(\d+)', rest)
        if p: wakes.append((ts, tid, comm, p.group(2), p.group(1)))
    elif kind == 'binder_transaction':
        p = re.search(r'dest_proc=(\d+) dest_thread=\d+ reply=(\d)', rest)
        if p: ev[tid].append((ts, p.group(1), p.group(2)))
    elif kind == 'binder_transaction_received':
        ev[tid].append((ts, None, 'recv'))
if base is None: sys.exit('no clock sync line')
rel = lambda t: t - base
lanes = sorted(t for t, n in names.items() if n.startswith('window-'))
print('trace start = realtime %.3f; app main tid %s; window threads: %s' % (real, main, ', '.join('%s(%s)' % (names[t], t) for t in lanes)))
out = []
for t in lanes:
    if not names[t].startswith('window-read'): continue
    iv = sorted(run.get(t, []))
    if not iv: continue
    calls = [(ts, d) for ts, d, r in ev.get(t, []) if r == '0']
    bursts = [[iv[0][0], iv[0][1], iv[0][1] - iv[0][0]]]
    for a, b in iv[1:]:
        if a - bursts[-1][1] > GAP: bursts.append([a, b, b - a])
        else: bursts[-1][1] = b; bursts[-1][2] += b - a
    for a, b, cpu in bursts:
        mine = [d for ts, d in calls if a <= ts <= b]
        if b - a < 0.002 and not mine: continue
        woke_by_main = any(w[1] == main and w[3] == t and abs(w[0] - a) < 0.05 for w in wakes)
        to_main = [w[0] for w in wakes if w[1] == t and w[3] == main and a <= w[0] <= b + 0.01]
        dest = collections.Counter(mine)
        out.append((a, 'window-read %-6s +%7.3f .. +%7.3f  wall %6.0f ms  cpu %5.0f ms  binder calls %4d (to pid %s)%s' % (t, rel(a), rel(b), (b - a) * 1000, cpu * 1000, len(mine),
              ' '.join('%s x%d' % (k, v) for k, v in dest.most_common(4)), '  [started by main]' if woke_by_main else '')))
for _, line in sorted(out): print(line)
print('# gap used to split looks: %.0f ms' % (GAP * 1000))
