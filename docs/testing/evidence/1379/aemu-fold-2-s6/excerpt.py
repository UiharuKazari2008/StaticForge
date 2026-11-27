import sys, re
# logcat excerpt: app tags, SystemUI disable-flag lines, ActivityManager lines that start/kill the app's process
TAGS = re.compile(r'^(MelatonBars|LocalAdb|NetIfaces|ApkInstall|BarsHeal\w*|BarsServiceHeal|BarsServiceWatch|HomeKeeper|ShellService|ShizukuControl|AndroidRuntime|NoteAlerts|AdbWireless)\s*:')
lo, hi = int(sys.argv[1]), int(sys.argv[2])
for ln in sys.stdin:
    m = re.match(r'^\s*(\d{9,10}\.\d+)\s+(\d+)\s+(\d+)\s+(\S)\s+(.*)$', ln.rstrip('\r\n'))
    if not m: continue
    t = int(float(m.group(1)) * 1000)
    if not (lo <= t <= hi): continue
    b = m.group(5)
    if b.startswith('AndroidRuntime') and m.group(4) not in 'EF' and 'NavBlankShell' not in b: continue
    if TAGS.match(b) or 'disableFlagsInteractor: newValue' in b or (b.startswith('ActivityManager') and 'jp.net.seventhreeseven.dreamscape' in b and re.search(r'Start proc|Killing| has died|Scheduling restart', b)):
        print(ln.rstrip('\r\n'))
