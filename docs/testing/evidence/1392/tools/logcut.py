# logcut.py <in logcat -v epoch> <out> [app pid ...] : StaticForge #1392 part D. Keeps the lines of the given app pids plus the
# system lines about the lock, the keyguard, windows, ANRs, crashes and the app; removes every line that can carry a coordinate,
# notification text, a name or a network name (redact-logs.py's patterns, plus the page's console lines).
import re, sys
src, dst = sys.argv[1], sys.argv[2]
pids = set(sys.argv[3:])
RED = re.compile(r'[Gg]eofenc|[Ll]atitude|[Ll]ongitude|Location\[|-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}| [VDIWEF] (NoteAlerts|InboxNotifier|TextMessage\w*) *:|NoteAlerts|InboxNotifier|TextMessage|android\.(title|text)|tickerText|From: |SSID|ssid|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b(?!/)|notification_(enqueue|alert|canceled|cancel_all|clicked|panel)|CONSOLE|computeSectionName|number=|PhoneNumberUtils')
WANT = re.compile(r'LockSettingsService|gatekeeperd|AuthenticationPolicyService|MelatonLock|MelatonBars|WindowReads|DexWindows|DexAltTab|DexStartMenu|AndroidWindows|ANR in|\bam_anr\b|am_crash|FATAL|AndroidRuntime|Exception|dreamscape|keyguard|Keyguard|wm_set_keyguard|screen_toggled|PowerManagerService|Skipped \d+ frames|Slow (dispatch|delivery)|Choreographer|LocalAdb|Shizuku|CafeTasks|dumpstate')
n = red = 0
with open(dst, 'w') as f:
    for ln in open(src, errors='replace'):
        m = re.match(r'^\s*(\d{10}\.\d+)\s+(\d+)\s+(\d+)\s+', ln)
        if not m: continue
        if 'SettingsToPropertiesMapper' in ln: continue
        if m.group(2) not in pids and not WANT.search(ln): continue
        if RED.search(ln): red += 1; continue
        f.write(ln[:500].rstrip('\n') + '\n'); n += 1
    f.write('# logcut.py: %d lines kept; %d removed (could carry coordinates, notification text or names)\n' % (n, red))
print('%d kept, %d redacted' % (n, red))
