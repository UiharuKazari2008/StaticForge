# run-table.py <run folder>... : one markdown row per run from summary.txt, ticks.txt and host.txt
import os, re, sys
print('| run | display | first MelatonBars | token linked | main thread outside its looper for 2 s or more | longest main-thread log silence up to the link | longest hb.txt gap (wall / uptime) | getWindows seen in system_server | host: qemu cores mean (max), host CPU % mean (max), longest sample step |')
print('|---|---|---|---|---|---|---|---|---|')
for run in sys.argv[1:]:
    s = open(os.path.join(run, 'summary.txt')).read()
    name = os.path.basename(run.rstrip('/'))
    t0 = float(re.search(r'epoch ([\d.]+)', s).group(1))
    m = re.search(r'first MelatonBars line: (.*?)   holder token linked: (.*)', s)
    sil = re.search(r'log silence of the main thread \(tid=pid\).*?: ([\d.]+ s from \+[\d.]+)', s)
    hb = re.search(r'longest gap ([\d.]+) s wall / ([\d.]+) s uptime', s)
    seg = re.search(r'main thread outside its looper poll for 2 s or more: (.*)', s).group(1)
    seg = re.sub(r', \{[^}]*\}\)', ')', seg)
    ss = [f for f in os.listdir(os.path.join(run, 'traces')) if f.endswith('system_server-extract.txt')] if os.path.isdir(os.path.join(run, 'traces')) else []
    inside = sum(1 for f in ss if 'ensureWindowsAvailableTimedLocked(' in open(os.path.join(run, 'traces', f)).read())
    host = []
    hp = os.path.join(run, 'host.txt')
    if os.path.exists(hp):
        for l in open(hp):
            k = dict(x.split('=', 1) for x in l.split() if '=' in x)
            if 'dt' in k and int(k['dt']) > 0 and -0.5 <= int(k['ms']) / 1000 - t0 <= 32: host.append((float(k['qemuCores']), int(k['hostCpuPct']), int(k['dt'])))
    h = '%.1f (%.1f), %d (%d), %.1f s' % (sum(x[0] for x in host) / len(host), max(x[0] for x in host), sum(x[1] for x in host) / len(host), max(x[1] for x in host), max(x[2] for x in host) / 1000) if host else 'not sampled'
    rt = open(os.path.join(run, 'run.txt')).read() if os.path.exists(os.path.join(run, 'run.txt')) else ''
    disp = 'OFF' if ('-off-' in name) else 'on'
    print('| %s | %s | %s | %s | %s | %s | %s / %s s | %s | %s |' % (name, disp, m.group(1), m.group(2).replace(' in the window', ''), seg, sil.group(1) if sil else '-', hb.group(1), hb.group(2), ('%d of %d dumps' % (inside, len(ss))) if ss else '-', h))
