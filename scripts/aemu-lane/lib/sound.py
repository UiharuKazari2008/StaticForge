#!/usr/bin/env python3
"""sound.py <since-ms (device clock)> <logcat.txt> [<playback.txt>] [<wav-info.json>]
The sounds an instance played since a time, from Android's own records and the app's sound log, as JSON.

Sources (logcat -v epoch -b main -b events, then dumpsys audio):
  noteAlerts      the app's `NoteAlerts:` lines: the event, the ringer, the sound file and its sha256 prefix ("sound <file>?v=<sha>"),
                  and "playing <file>" - AUTHORITATIVE for which sound the app chose and played (memory #316)
  playerState     Android's AudioPlayerStateMonitor / AudioService playback lines for the app's uid: state:started + usage
  notificationAlert  logcat -b events `notification_alert` (the system sounded / vibrated / blinked a notification)
  playbackNow     `dumpsys audio` playback activity right now (players still running)
"""
import json, re, sys

since = int(float(sys.argv[1]))
log = open(sys.argv[2], errors='replace').read().splitlines()
playback = open(sys.argv[3], errors='replace').read() if len(sys.argv) > 3 and sys.argv[3] != '-' else ''
wav = json.load(open(sys.argv[4])) if len(sys.argv) > 4 and sys.argv[4] != '-' else None

line_re = re.compile(r'^\s*(\d+)\.(\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]*?)\s*:\s?(.*)$')
note, state, alert = [], [], []
for ln in log:
    m = line_re.match(ln)
    if not m:
        continue
    t = int(m.group(1)) * 1000 + int(m.group(2).ljust(3, '0')[:3])
    if t < since:
        continue
    tag, msg = m.group(6), m.group(7)
    if tag == 'NoteAlerts':
        e = {'atMs': t, 'line': msg}
        s = re.search(r'ringer ([^\s,]+),? (?:default )?sound ([^\s,?]+)(?:\?v=([0-9a-f]+))?', msg)
        if s:
            e.update({'ringer': s.group(1), 'file': s.group(2), 'sha256Prefix': s.group(3)})
        p = re.search(r'playing (\S+)', msg)
        if p:
            e.update({'playing': p.group(1)})
        note.append(e)
    elif 'AudioPlayerStateMonitor' in tag or tag in ('AudioService', 'PlaybackActivityMonitor'):
        if 'state:started' in msg or 'started' in msg and 'USAGE' in msg:
            u = re.search(r'usage=(USAGE_\w+)', msg)
            pid = re.search(r'u/pid:(\d+)/(\d+)', msg)
            state.append({'atMs': t, 'usage': u.group(1) if u else None, 'uid': int(pid.group(1)) if pid else None, 'line': msg[:200]})
    elif tag == 'notification_alert':
        alert.append({'atMs': t, 'line': msg[:200]})

now_players = []
for m in re.finditer(r'AudioPlaybackConfiguration piid:(\d+) deviceIds:\S* type:(\S+) u/pid:(\d+)/(\d+) state:(\w+) attr:AudioAttributes:[^\n]*?usage=(USAGE_\w+)', playback):
    now_players.append({'piid': int(m.group(1)), 'uid': int(m.group(3)), 'pid': int(m.group(4)), 'state': m.group(5), 'usage': m.group(6)})

# one sound decision = one `ringer N, sound <file>` line of the app (the app chose that file for that event); it was
# PLAYED only when a `playing <file>` line follows (ringer NORMAL). The lane keeps the ringer SILENT (Yukimi, Nov 26 2026:
# no alarm-like sound on any phone or emulator; the app's default notice sounds are WM Alarm files): the app then logs what
# it would have sounded and plays nothing, which is what a test asserts.
decisions = [{'atMs': n['atMs'], 'file': n.get('file'), 'sha256Prefix': n.get('sha256Prefix'), 'ringer': n.get('ringer'),
              'silentByRinger': n.get('ringer') in ('0', 'RINGER_MODE_SILENT')} for n in note if n.get('file')]
played = [{'atMs': n['atMs'], 'file': n.get('playing')} for n in note if n.get('playing')]
sounds = decisions or [{'atMs': s['atMs'], 'usage': s['usage'], 'source': 'playerState'} for s in state if s.get('usage') == 'USAGE_NOTIFICATION']
alarm = [s for s in state if s.get('usage') in ('USAGE_ALARM', 'USAGE_NOTIFICATION_RINGTONE')]
out = {'ok': True, 'sinceMs': since, 'count': len(sounds), 'sounds': sounds, 'playedCount': len(played), 'played': played,
       'alarmLikeStarted': len(alarm),      # the lane rule: nothing alarm-like plays; this must stay 0
       'sources': {'noteAlerts': note, 'playerState': state, 'notificationAlert': alert, 'playbackNow': now_players},
       'authoritative': 'noteAlerts (the app named the file and sha256 prefix it played); playerState / notificationAlert confirm Android saw it',
       'wav': wav}
print(json.dumps(out))
