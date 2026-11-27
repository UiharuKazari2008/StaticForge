#!/usr/bin/env python3
"""notifs.py <package> < dumpsys-notification-noredact.txt  ->  JSON list of the package's posted notifications (compact)."""
import json, re, sys

pkg = sys.argv[1]
text = sys.stdin.read().replace('\r', '')
# only the live list: stop at the archive / ranking sections
end = len(text)
for m in re.finditer(r'^\s*(Archive|mArchive|Notification Ranking|Ranking Config|mRankingHelper)', text, re.M):
    end = min(end, m.start())
text = text[:end]

blocks = re.split(r'\n(?=\s*NotificationRecord\()', text)
out = []
for b in blocks:
    head = re.match(r'\s*NotificationRecord\(([^\n]*)', b)
    if not head or f'pkg={pkg}' not in head.group(1):
        continue
    h = head.group(1)
    rec = {}
    m = re.search(r'key=(\S+?):', h)
    rec['key'] = m.group(1) if m else None
    m = re.search(r'importance=(\d+)', h)
    rec['importance'] = int(m.group(1)) if m else None
    m = re.search(r'\bid=(-?\d+)', h)
    rec['id'] = int(m.group(1)) if m else None
    m = re.search(r'tag=(\S+)', h)
    rec['tag'] = m.group(1) if m and m.group(1) != 'null' else None
    m = re.search(r'channel=([^\s)]+)', b)
    rec['channel'] = m.group(1) if m else None
    m = re.search(r'\n\s*flags=(0x[0-9a-f]+)', b)
    rec['flags'] = m.group(1) if m else None
    for k in ('title', 'text', 'subText', 'bigText'):
        m = re.search(r'android\.%s=\w+ \((.*)\)\s*$' % k, b, re.M)
        if m:
            rec[k] = m.group(1)
    m = re.search(r'mSound=(\S+?)[,}]', b)
    rec['channelSound'] = m.group(1) if m else None
    m = re.search(r'\n\s*sound=(\S+)', b)
    rec['sound'] = m.group(1) if m and m.group(1) != 'null' else None
    m = re.search(r'\n\s*when=(\d+)', b) or re.search(r'\bwhen=(\d+)', h)
    rec['when'] = int(m.group(1)) if m else None
    out.append({k: v for k, v in rec.items() if v is not None})
print(json.dumps(out))
