# stack-table.py <run folder>... : for every SIGQUIT dump of a run, what the app's main thread and system_server's getWindows
# thread were doing, with the offset from the app's "Start proc" line.
import datetime, glob, os, re, sys
for run in sys.argv[1:]:
    t0 = None
    for l in open(os.path.join(run, 'summary.txt')):
        m = re.match(r't0 \(Start proc\) epoch ([\d.]+)', l)
        if m: t0 = float(m.group(1))
    print('== %s' % os.path.basename(run.rstrip('/')))
    for f in sorted(glob.glob(os.path.join(run, 'traces', '*'))):
        t = open(f, errors='replace').read()
        m = re.search(r'----- pid (\d+) at (\S+ [\d:]+)\.(\d{6})\d*([+-]\d{4}) -----', t)
        when = datetime.datetime.strptime(m.group(2) + '.' + m.group(3) + m.group(4), '%Y-%m-%d %H:%M:%S.%f%z').timestamp() - t0
        if 'Cmd line: system_server' in t:
            got = []
            for b in re.split(r'\n(?=")', t):
                if 'AbstractAccessibilityServiceConnection.getWindows(' in b:
                    name = b.split('\n')[0]; fr = re.findall(r'^  at (com\.android\.server\.accessibility\.\S+)', b, re.M)
                    got.append('%s | %s' % (name.split(' prio')[0] + ' ' + name.split()[-1], fr[0].replace('com.android.server.accessibility.', '') if fr else '?'))
            print('  +%6.2f system_server: %s' % (when, '; '.join(got) or 'no thread inside getWindows'))
        else:
            b = t[t.find('\n"main" prio'):].split('\n\n')[0]
            j = re.findall(r'^  at (\S+?\(.*?\))$', b, re.M)
            app = [x for x in j if x.startswith('jp.net') or re.match(r'^[a-z0-9]{1,4}\.', x)]
            top = [x.split('(')[0] for x in j[:6]]
            call = next((x for x in top if 'Stub$Proxy' in x), top[0] if top else '?')
            print('  +%6.2f app main: %s%s' % (when, call.replace('android.accessibilityservice.', ''), (' <- ' + ' <- '.join(a.replace('jp.net.seventhreeseven.dreamscape.', '') for a in app[:3])) if app else ''))
