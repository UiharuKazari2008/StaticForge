# analyze-run.py <raw pulled folder> <evidence run folder> <package> : copies the raw files (logcat cut to the window around the
# process start and redacted) into the evidence folder and prints the run's numbers.
import os, re, shutil, sys
raw, out, pkg = sys.argv[1:4]
events = [l.rstrip('\n') for l in open(os.path.join(raw, 'events.txt'))]
pid = None; kill_ms = None; sleep_ms = None
for l in events:
    ms, rest = l.split(' ', 1)
    if rest.startswith('kill -9'): kill_ms = int(ms)
    if rest.startswith('KEYCODE_SLEEP'): sleep_ms = int(ms)
    m = re.match(r'new pid (\d+)', rest)
    if m: pid = m.group(1); seen_ms = int(ms)
print('events: new pid %s seen at device ms %s%s' % (pid, seen_ms if pid else '-', ', %.2f s after kill -9' % ((seen_ms - kill_ms) / 1000) if (pid and kill_ms) else ''))
rows = []
for ln in open(os.path.join(raw, 'logcat-all.txt'), errors='replace'):
    m = re.match(r'^\s*(\d{10}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*)$', ln.rstrip('\n'))
    if m: rows.append((float(m.group(1)), m.group(2), m.group(3), m.group(4), m.group(5), ln))
rows.sort(key=lambda r: r[0])
t0 = None
for r in rows:
    if re.search(r'Start proc %s:%s[/ ]' % (pid, re.escape(pkg)), r[4]): t0 = r[0]; break
if sleep_ms is not None:
    t0 = sleep_ms / 1000   # no new process: offsets are from the power key
    print('same process, display switched off: t0 = the power key')
if t0 is None:
    t0 = next((r[0] for r in rows if r[1] == pid), None)
    print('WARNING: no "Start proc" line, t0 = first log line of the pid')
print('t0 (Start proc) epoch %.3f' % t0)
# redaction: anything that can carry notification text, names or addresses
RED = re.compile(r'NoteAlerts|InboxNotifier|TextMessage|android\.(title|text)|tickerText|From: |SSID|ssid|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}|computeSectionName|number=|PhoneNumberUtils|[Gg]eofence|[Ll]atitude|[Ll]ongitude|Location\[|CONSOLE|notification_(enqueue|canceled|cancel_all|clicked|alert|panel)|-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}')
lo, hi = t0 - 8, t0 + 75
with open(os.path.join(out, 'logcat-window.txt'), 'w') as f:
    n = red = 0
    for r in rows:
        if lo <= r[0] <= hi:
            if RED.search(r[5]): red += 1; continue
            if 'SettingsToPropertiesMapper' in r[5]: continue   # system flag spam, megabytes
            f.write(r[5][:600].rstrip('\n') + '\n'); n += 1
    f.write('# window t0-8 s .. t0+75 s of logcat -b main,system,crash,events; %d lines removed (could carry notification text / names)\n' % red)
for name in sorted(os.listdir(raw)):
    p = os.path.join(raw, name)
    if name in ('logcat-all.txt', 'run', 'done', 'anr-before.txt', 'start'): continue
    if os.path.isdir(p):
        d = os.path.join(out, name); os.makedirs(d, exist_ok=True)
        for x in sorted(os.listdir(p)):
            text = open(os.path.join(p, x), errors='replace').read()
            head = text[:600]
            # ART's "Debug Store" line is a long list of broadcast bookkeeping: noise, dropped
            text = re.sub(r'(?m)^Debug Store:.*\n', '', text)
            if 'Cmd line: system_server' not in head:
                open(os.path.join(d, x), 'w').write(text); continue
            # system_server's dump is megabytes: keep its header, the main thread, every accessibility thread and the lock holders
            blocks = re.split(r'\n(?=\n?")', text)
            keep = []; want = set()
            for b in blocks:
                if re.search(r'^\n?"main" prio', b) or re.search(r'at com\.android\.server\.accessibility\.', b):
                    keep.append(b); want.update(re.findall(r'held by thread (\d+)', b))
            for b in blocks:
                m = re.search(r'^\n?"[^"]*".*? tid=(\d+) ', b)
                if m and m.group(1) in want and b not in keep: keep.append(b)
            with open(os.path.join(d, x + '.system_server-extract.txt'), 'w') as f:
                f.write(text[:text.find('DALVIK THREADS')] + '\n# extract: main thread, every thread with a com.android.server.accessibility frame, and the holders of the locks they wait for\n\n' + '\n'.join(k.strip('\n') + '\n' for k in keep))
    elif name == 'dmesg.txt':
        with open(os.path.join(out, name), 'w') as f:
            f.writelines(l for l in open(p, errors='replace') if not RED.search(l))
    else: shutil.copy(p, os.path.join(out, name))
def first(rx, who=None):
    for r in rows:
        if r[0] >= t0 - 0.2 and (who is None or r[1] == who) and re.search(rx, r[4]): return r[0] - t0
    return None
fm = first(r'^MelatonBars\s*:', pid); ln = first(r'holder token linked', pid)
print('first MelatonBars line: %s   holder token linked: %s' % tuple('+%.2f s' % x if x is not None else 'NONE in the window' for x in (fm, ln)))
def gaps(sel, end):
    ts = [r[0] for r in rows if sel(r) and t0 <= r[0] <= end]
    ts = [t0] + ts
    g = sorted(((ts[i + 1] - ts[i], ts[i] - t0) for i in range(len(ts) - 1)), reverse=True)
    return g[:2]
end = t0 + (ln + 0.01 if ln is not None else 45)
for label, sel in (('main thread (tid=pid)', lambda r: r[1] == pid and r[2] == pid), ('any thread of the app', lambda r: r[1] == pid)):
    print('log silence of the %s between Start proc and %s: %s' % (label, 'token linked' if ln is not None else '+45 s', ', '.join('%.2f s from +%.2f' % g for g in gaps(sel, end))))
# heartbeat: never touches /proc/<pid>
hb = [l.split() for l in open(os.path.join(raw, 'hb.txt')) if l.strip()]
hb = [(int(a[0]), float(a[1])) for a in hb if len(a) == 2]
g = max(((hb[i + 1][0] - hb[i][0], hb[i + 1][1] - hb[i][1], hb[i][0] / 1000 - t0) for i in range(len(hb) - 1)), default=(0, 0, 0))
med = sorted(hb[i + 1][0] - hb[i][0] for i in range(len(hb) - 1))[len(hb) // 2]
print('hb.txt: %d beats, median step %d ms, longest gap %.2f s wall / %.2f s uptime, from +%.2f s' % (len(hb), med, g[0] / 1000, g[1], g[2]))
# ticks: reads /proc/<pid>
ticks = []
cur = None
for l in open(os.path.join(raw, 'ticks.txt'), errors='replace'):
    if l.startswith('== '): cur = {'ms': int(l.split()[1]), 'stack': []}; ticks.append(cur)
    elif cur is None: continue
    elif l.startswith('main state='):
        m = re.match(r'main state=(\S*) wchan=(\S*)', l); cur['state'], cur['wchan'] = m.group(1), m.group(2)
    elif l.startswith('sched '): a = l.split(); cur['run'] = int(a[1]) if len(a) > 1 else None; cur['wait'] = int(a[2]) if len(a) > 2 else None
    elif l.startswith('guest '): a = [int(x) for x in l.split()[2:]]; cur['cpu'] = a
    elif l.startswith('['): cur['stack'].append(l.strip())
tg = max(((ticks[i + 1]['ms'] - ticks[i]['ms'], ticks[i]['ms'] / 1000 - t0) for i in range(len(ticks) - 1)), default=(0, 0))
print('ticks.txt: %d ticks, longest gap %.2f s from +%.2f s' % (len(ticks), tg[0] / 1000, tg[1]))
# longest stretch in which the main thread is not in its idle looper poll and gets (almost) no CPU: blocked (strict: < 30 ms CPU)
best = (0, 0, None, 0)
i = 0
while i < len(ticks):
    j = i
    while (j + 1 < len(ticks) and ticks[j + 1].get('run') is not None and ticks[j].get('run') is not None
           and ticks[j + 1]['run'] - ticks[i]['run'] < 30e6 and 'ep_poll' not in ticks[j + 1].get('wchan', '') and 'epoll' not in ticks[j + 1].get('wchan', '') and 'ep_poll' not in ticks[i].get('wchan', '') and 'epoll' not in ticks[i].get('wchan', '')):
        j += 1
    d = ticks[j]['ms'] - ticks[i]['ms']
    if d > best[0]:
        w = {}
        for t in ticks[i:j + 1]: k = (t.get('state'), t.get('wchan')); w[k] = w.get(k, 0) + 1
        best = (d, ticks[i]['ms'] / 1000 - t0, w, ticks[j]['run'] - ticks[i]['run'] if ticks[i].get('run') is not None else 0)
    i = j + 1
print('main thread blocked (not in the looper poll, < 30 ms CPU in all): longest %.2f s from +%.2f s, CPU used %.0f ms, (state, wchan) samples %s' % (best[0] / 1000, best[1], best[3] / 1e6, best[2]))
# every stretch of 2 s or more in which the main thread sat outside its looper poll (consecutive ticks)
seg = []; start = None
for t in ticks + [{'ms': ticks[-1]['ms'] + 1, 'wchan': 'ep_poll'}]:
    idle = 'ep_poll' in t.get('wchan', '') or 'epoll' in t.get('wchan', '')
    if not idle and start is None: start = t['ms']; last_ms = t['ms']; wc = {}
    if not idle: last_ms = t['ms']; wc[t.get('wchan')] = wc.get(t.get('wchan'), 0) + 1
    elif start is not None:
        if last_ms - start >= 2000: seg.append('+%.1f..+%.1f s (%.1f s, %s)' % (start / 1000 - t0, last_ms / 1000 - t0, (last_ms - start) / 1000, wc))
        start = None
print('main thread outside its looper poll for 2 s or more: %s' % ('; '.join(seg) or 'never'))
# part C: is such a stretch one blocked call or a busy start? CPU and run-queue wait the main thread got in it (schedstat), the
# longest time between two ticks in which it got < 30 ms CPU, and the longest silence of its own log lines inside it
stretch = []; cur_s = []
for t in ticks + [{'wchan': 'ep_poll'}]:
    if 'ep_poll' in t.get('wchan', '') or 'epoll' in t.get('wchan', ''):
        if len(cur_s) > 1 and cur_s[-1]['ms'] - cur_s[0]['ms'] >= 1000: stretch.append(cur_s)
        cur_s = []
    else: cur_s.append(t)
for c in stretch:
    c2 = [t for t in c if t.get('run') is not None]
    if len(c2) < 2: continue
    a, b = c2[0]['ms'] / 1000, c2[-1]['ms'] / 1000
    parked = 0; i = 0
    while i < len(c2):
        j = i
        while j + 1 < len(c2) and c2[j + 1]['run'] - c2[i]['run'] < 30e6: j += 1
        parked = max(parked, c2[j]['ms'] - c2[i]['ms']); i = max(j, i + 1)
    lt = [a] + [r[0] for r in rows if r[1] == pid and r[2] == pid and a <= r[0] <= b] + [b]
    print('  stretch +%.1f..+%.1f s (%.1f s): main ran %.2f s on CPU + waited %.2f s for a CPU; longest part with < 30 ms CPU %.1f s; main-thread log lines inside %d, longest silence %.2f s' % (
        a - t0, b - t0, b - a, (c2[-1]['run'] - c2[0]['run']) / 1e9, (c2[-1]['wait'] - c2[0]['wait']) / 1e9, parked / 1000, len(lt) - 2, max(lt[i + 1] - lt[i] for i in range(len(lt) - 1))))
for r in rows:
    if t0 - 1 <= r[0] <= t0 + 60:
        m = re.search(r'Slow (dispatch|delivery) took (\d+)ms (\S+) app=(\S+)', r[4])
        if m and int(m.group(2)) >= 2000: print('  +%6.2f Slow %s %s ms thread=%s app=%s' % (r[0] - t0, m.group(1), m.group(2), m.group(3), m.group(4)))
        if r[1] == pid and re.search(r'Skipped \d+ frames|engine did not start|engine started|TimeoutException|Long monitor contention|waiting to lock|Slow (dispatch|delivery)|ANR in', r[4]): print('  +%6.2f %s %s' % (r[0] - t0, r[2], r[4][:260]))
        elif re.search(r'Long monitor contention', r[4]) and pkg in r[4]: print('  +%6.2f %s' % (r[0] - t0, r[4][:300]))
for l in events: print('  event +%.2f %s' % (int(l.split()[0]) / 1000 - t0, l.split(' ', 1)[1]))
# part C: the window reads' own lines (which thread read, when the first look was applied) and the engine's lines
print('window and engine lines of the new process (t0 .. +75 s):')
for r in rows:
    if r[1] == pid and t0 - 0.2 <= r[0] <= t0 + 75 and re.search(r'WindowReads|window read took|first window look|window scan|engine did not start|engine started|holder token linked|early hold|over the lock screen|^MelatonLock', r[4]):
        print('  W +%6.2f tid=%s%s %s' % (r[0] - t0, r[2], ' (main)' if r[2] == pid else '', r[4][:220]))
print('traces: %s' % ', '.join(sorted(os.listdir(os.path.join(raw, 'traces')))) )
