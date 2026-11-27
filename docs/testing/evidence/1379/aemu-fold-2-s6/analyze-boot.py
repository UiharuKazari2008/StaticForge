#!/usr/bin/env python3
# analyze-boot.py <run prefix> <dmesg seconds of "processing action (sys.boot_completed=1)">
# boot_completed in epoch ms = (epoch of the events line boot_progress_start) - (its uptime value) + the dmesg time.
import sys, re
MASK = 0x03600000
p = sys.argv[1]; kbc = float(sys.argv[2])
ev = {}
for ln in open(p + '-bootevents.txt', errors='replace'):
    m = re.match(r'^\s*(\d+\.\d+)\s+\d+\s+\d+\s+\w\s+(\w+): (\d+)', ln)
    if m and m.group(2) not in ev: ev[m.group(2)] = (int(float(m.group(1)) * 1000), int(m.group(3)))
bps_t, bps_v = ev['boot_progress_start']
bc = bps_t - bps_v + int(kbc * 1000)
unl = ev.get('uc_finish_user_unlocked', (None, None))[0]
L = open(p + '-logcat.txt', errors='replace').read().splitlines()
def first(rx):
    for ln in L:
        m = re.match(r'^\s*(\d+\.\d+)\s', ln)
        if m and re.search(rx, ln): return int(float(m.group(1)) * 1000), ln
    return None, None
sp, _ = first(r'Start proc \d+:jp\.net\.seventhreeseven\.dreamscape/\S+ for')
tok, tokln = first(r'MelatonBars: holder token linked')
S = []
for ln in open(p + '-sample.txt', errors='replace'):
    m = re.match(r'^(\d{13}) (.*)$', ln.strip())
    if m: S.append((int(m.group(1)), dict(x.split('=', 1) for x in m.group(2).split())))
held = lambda kv: kv.get('recs') != '0' and kv.get('net', '-') != '-' and int(kv['net'], 16) & MASK == MASK
fh = next((t for t, kv in S if held(kv)), None)
cont = fh is not None and all(held(kv) for t, kv in S if t >= fh)
gaps = sorted(S[i+1][0]-S[i][0] for i in range(len(S)-1)) or [0]
def d(a, b): return '%.2f s' % ((a - b) / 1000.0) if a and b else '-'
print('boot_completed (epoch ms): %d   user unlocked (uc_finish_user_unlocked): %s' % (bc, unl))
print('app "Start proc": %s  (%s after boot_completed)' % (sp, d(sp, bc)))
print('"holder token linked": %s' % tok)
if tokln: print('  ' + tokln.strip())
print('first sample with the row held: %s; held in every later sample: %s (%d samples after it)' % (fh, cont, sum(1 for t, _ in S if fh and t > fh)))
print('ROW HELD after boot_completed: %s (sampler), %s (token linked)' % (d(fh, bc), d(tok, bc)))
print('ROW HELD after user unlocked:  %s (sampler)' % d(fh, unl))
print('ROW HELD after app Start proc: %s (sampler), %s (token linked)' % (d(fh, sp), d(tok, sp)))
print('sampler: %d samples, first %+.1f s and last %+.1f s from boot_completed, period median %d ms, longest %d ms' % (len(S), (S[0][0]-bc)/1000, (S[-1][0]-bc)/1000, gaps[len(gaps)//2], gaps[-1]))
shz = [t for t, kv in S if kv.get('shz') != '-']
print('samples with a shizuku_server: %d of %d%s' % (len(shz), len(S), (' (first %s after boot_completed)' % d(shz[0], bc)) if shz else ''))
apps = []
for t, kv in S:
    if kv.get('app') != '-' and kv.get('app') not in apps: apps.append(kv.get('app'))
holders = []
for t, kv in S:
    if kv.get('holder') != '-' and kv.get('holder') not in holders: holders.append(kv.get('holder'))
print('app pids seen: %s; holder pids seen: %s' % (apps, holders))
bad = [ln for ln in L if re.search(r'could not be emptied|gesture fallback|gesture navigation without|dropped|Allow USB debugging|holder died|FATAL', ln)]
print('lines with a failed hold / fallback / ADB failure / crash: %d' % len(bad))
for ln in bad[:20]: print('  ' + ln.strip()[:300])
print('timeline (seconds from boot_completed, a line per change):')
last = None
for t, kv in S:
    k = tuple((x, kv.get(x)) for x in ('recs','what1','lockrec','net','holder','app','shz','adbd'))
    if k != last:
        print('  %+8.2f s  %s' % ((t-bc)/1000, ' '.join('%s=%s' % q for q in k))); last = k
