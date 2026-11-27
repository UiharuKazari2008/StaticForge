# pin-summary.py <run folder> ... : StaticForge #1392 part D. For each run of tools/run-pin.sh (its folder in the scratch area):
# one block of numbers, all offsets in seconds from the start of the guest's `input tap` on Melaton's OK key (the last PIN tap).
# From guest/notes.txt, logcat.txt (logcut.py) and, when there is one, guest/trace.txt (the atrace ring).
import os, re, sys
for d in sys.argv[1:]:
    d = d.rstrip('/'); name = os.path.basename(d)
    notes = open(os.path.join(d, 'guest/notes.txt')).read()
    t0 = int(open(os.path.join(d, 'guest/oktap')).read().split()[0]) / 1000.0
    pid = open(os.path.join(d, 'run.txt')).read().split()[-1]
    rows = []
    for ln in open(os.path.join(d, 'logcat.txt'), errors='replace'):
        m = re.match(r'^\s*(\d{10}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*)$', ln.rstrip('\n'))
        if m: rows.append((float(m.group(1)), m.group(2), m.group(3), m.group(5)))
    def after(rx):
        for r in rows:
            if r[0] >= t0 and re.search(rx, r[3]): return '+%.2f' % (r[0] - t0)
        return '-'
    def count(rx): return sum(1 for r in rows if r[0] >= t0 and re.search(rx, r[3]))
    u = re.search(r'deviceLocked=0 first seen \d+ \((\d+) ms', notes)
    end = re.search(r'^\d+ end: (.*?) windows:', notes, re.M)
    print('== %s (app pid %s)' % (name, pid))
    print('   bouncer asked %s  shell failed (input) %s  credential check started %s  StartUnlock %s  keyguard gone (wm) %s  deviceLocked=0 (0.2 s poll) %s'
          % (after(r'Show primary bouncer requested'), after(r'shell failed \(input\)'), after(r'Verifying lockscreen credential'), after(r'StartUnlock'),
             after(r'wm_set_keyguard_shown: \[0,0,0'), '+%.2f' % (int(u.group(1)) / 1000.0) if u else 'never in the watch'))
    bad = [r for r in rows if re.search(r'no PIN pad|window read took|window scan failed|ANR in jp\.net|am_anr.*dreamscape|am_crash.*dreamscape|FATAL EXCEPTION', r[3])]
    print('   "no PIN pad" / "window read took" / scan failed / ANR / crash lines in the whole run window: %d%s' % (len(bad), ''.join('\n     %.3f %s' % (r[0], r[3][:160]) for r in bad[:6])))
    print('   credential checks after the tap: %d  failed attempts reported: %s' % (count(r'Verifying lockscreen credential'),
          next((re.search(r'numFailedAttempts=(\d+)', r[3]).group(1) for r in rows if r[0] >= t0 and 'numFailedAttempts' in r[3]), '0')))
    if end: print('   end state: %s' % end.group(1))
    tr = os.path.join(d, 'guest/trace.txt')
    if os.path.exists(tr):
        base = None; sends = []
        for ln in open(tr, errors='replace'):
            if 'realtime_ts=' in ln:
                m = re.search(r'\s([\d.]+): .*realtime_ts=(\d+)', ln); base, real = float(m.group(1)), int(m.group(2)) / 1000.0
            m = re.match(r'^\s*.+?-(\d+)\s+\(\s*[\d-]+\)\s+\[\d+\]\s+\S+\s+([\d.]+):\s+binder_transaction:\s+(.*)$', ln.rstrip())
            # code 0x8 from the app's main thread to system_server = IAccessibilityServiceConnection.performAccessibilityAction
            # (each is followed within ms by system_server -> SystemUI code 0x6, IAccessibilityInteractionConnection.performAccessibilityAction)
            if m and m.group(1) == pid and re.search(r'dest_proc=(\d+) .*reply=0 .*code=0x8$', m.group(3)):
                dest = re.search(r'dest_proc=(\d+)', m.group(3)).group(1)
                sends.append((float(m.group(2)) - base + real - t0, dest))
        ss = [t for t, dest in sends if dest == sys_server] if (sys_server := os.environ.get('SYSTEM_SERVER_PID', '847')) else []
        print('   accessibility actions sent by the app\'s main thread (binder, from the trace): %d%s' % (len(ss), ' at ' + ' '.join('+%.2f' % t for t in ss) if ss else ''))
