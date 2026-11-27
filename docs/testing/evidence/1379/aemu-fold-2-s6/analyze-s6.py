#!/usr/bin/env python3
# analyze-s6.py <run prefix> [startProcMs]: reads <prefix>-sample.txt, <prefix>-logcat.txt, <prefix>-tcp5599.txt (tcpdump), prints
#  - the row timeline from the guest sampler (dumpsys statusbar), times in seconds from the new process's "Start proc"
#  - every TCP connection to the app's local-ADB port: client bytes / server bytes (0 / 0 = a bare connect probe)
#  - SystemUI disable-flag lines and the MelatonBars lines of the window
import sys, re, os
MASK = 0x03600000
p = sys.argv[1]
swap = []
if os.path.exists(p + '-swap.txt'):
    swap = open(p + '-swap.txt', errors='replace').read().splitlines()
t0 = int(sys.argv[2]) if len(sys.argv) > 2 else None
kill = None
for ln in swap:
    m = re.match(r'^(\d{13}) Start proc of (\d+)', ln)
    if m and t0 is None: t0 = int(m.group(1))
    m = re.match(r'^(\d{13}) kill -9 ', ln)
    if m: kill = int(m.group(1))
rel = lambda t: (t - t0) / 1000.0
print('zero = %d ("Start proc" of the new app process, device ms)%s' % (t0, '' if kill is None else '; kill at %+.2f s' % rel(kill)))
if os.path.exists(p + '-sample.txt'):
    S = []
    for ln in open(p + '-sample.txt', errors='replace'):
        m = re.match(r'^(\d{13}) (.*)$', ln.strip())
        if m: S.append((int(m.group(1)), dict(x.split('=', 1) for x in m.group(2).split())))
    gaps = sorted(S[i+1][0]-S[i][0] for i in range(len(S)-1)) or [0]
    print('\n## sampler: %d samples %+.1f .. %+.1f s, period median %d ms, longest %d ms' % (len(S), rel(S[0][0]), rel(S[-1][0]), gaps[len(gaps)//2], gaps[-1]))
    last = None
    for t, kv in S:
        k = tuple((x, kv.get(x)) for x in ('recs','what1','lockrec','net','holder','app','shz','adbd','l5599'))
        if k != last:
            print('  %+8.2f s %d  %s' % (rel(t), t, ' '.join('%s=%s' % q for q in k))); last = k
    held = lambda kv: kv.get('recs') != '0' and kv.get('net','-') != '-' and int(kv['net'], 16) & MASK == MASK
    after = [(t, kv) for t, kv in S if kill is None or t >= kill]
    op = [(t, kv) for t, kv in after if not held(kv)]
    print('samples after the kill with the row NOT held: %d' % len(op))
    if op:
        print('  first %+.2f s, last %+.2f s' % (rel(op[0][0]), rel(op[-1][0])))
        later = [t for t, kv in after if t > op[-1][0] and held(kv)]
        if later: print('  first sample held again after the last open one: %+.2f s; held in every sample from then to the end (%d samples)' % (rel(later[0]), len(later)))
        else: print('  NOT held again before the sampler ended')
    print('samples with any shizuku_server: %d' % sum(1 for t, kv in S if kv.get('shz') != '-'))
if os.path.exists(p + '-tcp5599.txt'):
    C = {}
    order = []
    for ln in open(p + '-tcp5599.txt', errors='replace'):
        m = re.match(r'^(\d+\.\d+) IP 127\.0\.0\.1\.(\d+) > 127\.0\.0\.1\.(\d+): Flags \[([^\]]*)\].*length (\d+)', ln)
        if not m: continue
        t = int(float(m.group(1)) * 1000); a, b, fl, n = int(m.group(2)), int(m.group(3)), m.group(4), int(m.group(5))
        cp, toserver = (a, True) if b == 5599 else (b, False)
        if fl == 'S' and toserver:
            C[(cp, len(order))] = {'t': t, 'c': 0, 's': 0, 'fl': [], 'port': cp, 'end': t}; order.append((cp, len(order)))
        key = next((k for k in reversed(order) if k[0] == cp), None)
        if key is None: continue
        c = C[key]; c['c' if toserver else 's'] += n; c['end'] = t
        if 'R' in fl: c['fl'].append('RST-from-' + ('client' if toserver else 'server'))
    bare = [C[k] for k in order if C[k]['c'] == 0]
    data = [C[k] for k in order if C[k]['c'] > 0]
    print('\n## TCP connections to 127.0.0.1:5599: %d in all; %d with no bytes from the client (connect probes), %d where the client sent bytes' % (len(order), len(bare), len(data)))
    for c in data:
        print('  %+8.2f s %d  clientport %d  client->port %d B, port->client %d B, lasted %.2f s %s' % (rel(c['t']), c['t'], c['port'], c['c'], c['s'], (c['end']-c['t'])/1000.0, ','.join(sorted(set(c['fl'])))))
    if bare: print('  bare probes at (s): ' + ' '.join('%+.2f' % rel(c['t']) for c in bare))
if os.path.exists(p + '-logcat.txt'):
    print('\n## SystemUI disable-flag lines and MelatonBars / LocalAdb lines from the kill on')
    for ln in open(p + '-logcat.txt', errors='replace'):
        m = re.match(r'^\s*(\d{9,10}\.\d+)\s+(\d+)\s+(\d+)\s+(\S)\s+(.*)$', ln.rstrip('\n'))
        if not m: continue
        t = int(float(m.group(1)) * 1000)
        if kill is not None and t < kill: continue
        body = m.group(5)
        d = re.search(r'disableFlagsInteractor: newValue: DisableFlagsModel\(disable1=(\d+), disable2=(\d+)', body)
        if d:
            v = int(d.group(1))
            print('  %+8.2f s SystemUI disable1=0x%07x disable2=%s  row %s' % (rel(t), v, d.group(2), 'HELD' if v & MASK == MASK else 'GIVEN BACK'))
        elif re.match(r'(MelatonBars|LocalAdb)\b', body) or 'Start proc' in body:
            print('  %+8.2f s pid %s %s %s' % (rel(t), m.group(2), m.group(4), body[:330]))
