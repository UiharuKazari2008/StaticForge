#!/usr/bin/env python3
# analyze.py <sample file> <logcat excerpt> [fromMs toMs]: the row in the sampler (records, net flags) and in SystemUI's disable-flag log.
# The row is HELD while all of Back|Home|Recents|Search (0x03600000) are set.
import sys, re
MASK = 0x03600000
sf, lf = sys.argv[1], sys.argv[2]
lo = int(sys.argv[3]) if len(sys.argv) > 3 else 0
hi = int(sys.argv[4]) if len(sys.argv) > 4 else 10**15
S = []
for ln in open(sf, errors='replace'):
    m = re.match(r'^(\d{13}) (.*)$', ln.strip())
    if not m or not (lo <= int(m.group(1)) <= hi): continue
    kv = dict(x.split('=', 1) for x in m.group(2).split())
    S.append((int(m.group(1)), kv))
if not S: print('no samples in the window'); sys.exit(1)
gaps = sorted(S[i+1][0]-S[i][0] for i in range(len(S)-1)) or [0]
t0 = S[0][0]
print('window %d..%d (%.1f s), %d samples, period median %d ms, longest %d ms' % (t0, S[-1][0], (S[-1][0]-t0)/1000, len(S), gaps[len(gaps)//2], gaps[-1]))
norec = [s for s in S if s[1].get('recs') == '0']
nonet = [s for s in S if s[1].get('net','-') == '-' or int(s[1]['net'], 16) & MASK != MASK]
print('samples with NO shell disable record: %d' % len(norec))
print('samples with the row NOT held in system_server net flags of display 0 (mDisabled1 & 0x03600000): %d' % len(nonet))
two = [s for s in S if ',' in s[1].get('holder','')]
print('samples with two holder pids: %d%s' % (len(two), (' (+%.1f .. +%.1f s)' % ((two[0][0]-t0)/1000, (two[-1][0]-t0)/1000)) if two else ''))
print('timeline (a line per change; offset from the first sample, device ms):')
last = None
for t, kv in S:
    k = tuple((x, kv[x]) for x in ('recs','what1','lockrec','net','holder','app','usersvc','shz','adbd') if x in kv)
    if k != last:
        print('  +%7.1f s %d  %s' % ((t-t0)/1000, t, ' '.join('%s=%s' % p for p in k))); last = k
print("SystemUI disable-flag lines (disableFlagsInteractor) in the logcat excerpt, inside the window:")
n = bad = 0
for ln in open(lf, errors='replace'):
    m = re.match(r'^\s*(\d{9,10}\.\d+)\s.*disableFlagsInteractor: newValue: DisableFlagsModel\(disable1=(\d+), disable2=(\d+)', ln)
    if not m: continue
    t = int(float(m.group(1))*1000)
    if not (lo <= t <= hi): continue
    d = int(m.group(2)); n += 1; held = d & MASK == MASK; bad += 0 if held else 1
    print('  +%7.1f s %d  disable1=0x%07x disable2=%s  row %s; status-bar lock bits 0x%07x' % ((t-t0)/1000, t, d, m.group(3), 'HELD' if held else 'GIVEN BACK', d & ~MASK))
print('SystemUI lines: %d, of them with the row given back: %d' % (n, bad))
