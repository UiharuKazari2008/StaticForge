# redact-logs.py <folder> : removes every line that can carry a geofence coordinate, a location, notification text, a name or a
# network name from the text files under <folder> (the #1371 script's logcat copies are not filtered by it), and says how many.
# StaticForge #1392 part C. The same patterns as analyze-run.py's, for log lines.
import os, re, sys
RED = re.compile(r'[Gg]eofenc|[Ll]atitude|[Ll]ongitude|Location\[|-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}| [VDIWEF] (NoteAlerts|InboxNotifier|TextMessage\w*) *:|android\.(title|text)|tickerText|From: |SSID|ssid|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b(?!/)|notification_(enqueue|alert)|CONSOLE')
total = 0
for root, _, files in os.walk(sys.argv[1]):
    for f in files:
        if not re.search(r'(logcat[^/]*\.txt|dmesg\.txt|crash-step\.txt|step\.txt|log\.txt|-obs\.txt|-proof\.txt)$', f): continue
        p = os.path.join(root, f)
        lines = open(p, errors='replace').readlines()
        keep = [l for l in lines if not RED.search(l)]
        n = len(lines) - len(keep)
        if n:
            open(p, 'w').write(''.join(keep) + '# redact-logs.py: %d lines removed (could carry coordinates, notification text or names)\n' % n)
            print('%s: %d lines removed' % (os.path.relpath(p, sys.argv[1]), n)); total += n
print('total removed: %d' % total)
