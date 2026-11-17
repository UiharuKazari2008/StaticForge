#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-notification-sounds.py [out-dir] [name ...]
# Melaton Mobile's own notification sounds (Yozora #848), one per sound class of wmShell.js
# SND_EVENTS. All synthesised here (no samples), 22.05 kHz 16-bit mono like TrafficCamera.wav,
# written to public/sounds/wm61. Loudness follows how much the event needs the person (Yukimi,
# Nov 17 2026: weather alerts must get attention, things that need nothing must not pique interest):
#
#   urgent      WeatherSevere (the loudest of all), WeatherAlert, BatteryCritical   about -4 to -7 LUFS
#   act soon    LapisUnlocked, LapisIssue, BatteryLow, RainAlarm                    about -11 to -14 LUFS
#   nothing to  BatteryFull, LapisCountdown, SoftwareUpdate                         about -19 to -21 LUFS
#   do
#
# (the stock notify.mp3 is about -13 LUFS; TrafficCamera.wav, its own script, about -7)
#
#   BatteryLow.wav       battery-low       a soft high-low pair, twice: "plug in when you can"
#   BatteryCritical.wav  battery-very-low  an alarm: a fast falling three-tone burst three times,
#                                          then a long buzzing low tone
#   BatteryFull.wav      battery-full      two soft round notes rising a fourth (G4, C5): "done", quietly
#   WeatherAlert.wav     weather-alert     a weather-radio style high-low pair, twice, the last held
#   WeatherSevere.wav    weather-severe    the 853 Hz + 960 Hz two-tone attention signal, in the
#                                          long-short-short cadence of a phone's emergency alert.
#                                          Tones only: no header or end-of-message data bursts.
#                                          Driven into a soft clip so it is the loudest sound here.
#   RainAlarm.wav        rain-alarm        five water drops, then one soft bell
#   SoftwareUpdate.wav   update            two soft round notes rising a major third (C5, E5), a slow
#                                          swell and no strike, quieter than the rest (Yukimi, Nov 17:
#                                          the glassy fifth-and-octave was too sharp and too loud)
#   LapisCountdown.wav   lapis-run-left    a car's cabin warning gong, three even strokes on one note
#   LapisUnlocked.wav    lapis-unlocked    two key-fob chirps, then a rising two-note gong: "locked?"
#   LapisIssue.wav       lapis-issue       a dashboard fault chime: a gong falling a tritone, twice
import math, os, struct, sys, wave

RATE = 22050
TAU = 2 * math.pi


def mallet(f, t, ring, hard=0.0):
    """A marimba-like bar: fundamental, a short octave and the bar's 4th harmonic; hard adds bite."""
    if t < 0 or t > ring:
        return 0.0
    env = min(1.0, t / 0.003) * math.exp(-t * 5.5 / ring) * min(1.0, (ring - t) / 0.02)
    s = math.sin(TAU * f * t)
    s += 0.35 * math.sin(TAU * 2 * f * t) * math.exp(-t * 12)
    s += 0.18 * math.sin(TAU * 4 * f * t) * math.exp(-t * 22)
    s += hard * (0.30 * math.sin(TAU * 3 * f * t) + 0.14 * math.sin(TAU * 5 * f * t)) * math.exp(-t * 9)
    return s * env


def bell(f, t, ring):
    """A small warm bell: sine with a little octave and fifth, long exponential ring."""
    if t < 0 or t > ring:
        return 0.0
    env = min(1.0, t / 0.005) * math.exp(-t * 4.4 / ring) * min(1.0, (ring - t) / 0.02)
    s = math.sin(TAU * f * t) + 0.28 * math.sin(TAU * 2 * f * t) * math.exp(-t * 6) + 0.12 * math.sin(TAU * 1.5 * f * t) * math.exp(-t * 8)
    return s * env


def glass(f, t, ring):
    """A glassy FM tone: the modulator (3.5 x) dies fast, leaving a pure ring."""
    if t < 0 or t > ring:
        return 0.0
    env = min(1.0, t / 0.004) * math.exp(-t * 4.0 / ring) * min(1.0, (ring - t) / 0.02)
    return math.sin(TAU * f * t + 1.6 * math.exp(-t * 14) * math.sin(TAU * 3.5 * f * t)) * env


def beep(f, t, length, edge=0.008, trem=0.0, bite=0.0, rate=14):
    """A held soft-square tone with shaped edges; trem = depth of a flutter; bite = more square."""
    if t < 0 or t > length:
        return 0.0
    env = min(1.0, t / edge) * min(1.0, (length - t) / edge)
    s = math.sin(TAU * f * t) + (0.25 + 0.2 * bite) * math.sin(TAU * 3 * f * t) + (0.08 + 0.16 * bite) * math.sin(TAU * 5 * f * t) + 0.1 * bite * math.sin(TAU * 7 * f * t)
    return s * env * (1 - trem * (0.5 + 0.5 * math.sin(TAU * rate * t)))


def gong(f, t, ring):
    """A car's cabin chime: a struck tone with a slow beat (a twin 3 Hz off) and a short clang on top."""
    if t < 0 or t > ring:
        return 0.0
    env = min(1.0, t / 0.004) * math.exp(-t * 4.6 / ring) * min(1.0, (ring - t) / 0.02)
    s = math.sin(TAU * f * t) + 0.6 * math.sin(TAU * (f + 3) * t) + 0.3 * math.sin(TAU * 2 * f * t) * math.exp(-t * 5)
    s += 0.35 * math.sin(TAU * 2.76 * f * t) * math.exp(-t * 16)
    return s * env


def soft(f, t, ring, attack=0.025):
    """A soft round tone: a sine that swells in (no strike), a faint octave that fades at once, a warm ring."""
    if t < 0 or t > ring:
        return 0.0
    env = (1 - math.cos(math.pi * min(1.0, t / attack))) / 2 * math.exp(-t * 3.2 / ring) * min(1.0, (ring - t) / 0.04)
    return (math.sin(TAU * f * t) + 0.12 * math.sin(TAU * 2 * f * t) * math.exp(-t * 18)) * env


def chirp(t, length, f0, f1):
    """A key-fob chirp: a bright tone sliding up, cut short."""
    if t < 0 or t > length:
        return 0.0
    env = min(1.0, t / 0.003) * min(1.0, (length - t) / 0.006)
    phase = TAU * (f0 * t + (f1 - f0) * t * t / (2 * length))
    return (math.sin(phase) + 0.3 * math.sin(2 * phase)) * env


def render(length, fn):
    return [fn(i / RATE) for i in range(int(RATE * length))]


def battery_low():
    hi, lo = 987.8, 740.0
    notes = [(hi, 0.0, 0.15), (lo, 0.17, 0.22), (hi, 0.55, 0.15), (lo, 0.72, 0.30)]
    return render(1.05, lambda t: sum(beep(f, t - s, n, edge=0.015) for f, s, n in notes))


def battery_critical():
    burst = [(1318.5, 0.0), (1046.5, 0.095), (784.0, 0.19)]
    notes = [(f, s + rep, 0.085) for rep in (0.0, 0.36, 0.72) for f, s in burst]
    return render(1.72, lambda t: sum(beep(f, t - s, n, edge=0.004, bite=1.0) for f, s, n in notes)
                  + beep(659.3, t - 1.1, 0.6, bite=1.0, trem=0.6, rate=22))


def battery_full():
    notes = [(392.0, 0.0, 0.5, 1.0), (523.3, 0.15, 0.75, 0.85)]
    return render(0.95, lambda t: sum(g * soft(f, t - s, r) for f, s, r, g in notes))


def weather_alert():
    hi, lo = 1174.7, 880.0
    notes = [(hi, 0.0, 0.16), (lo, 0.2, 0.16), (hi, 0.44, 0.16), (lo, 0.64, 0.42)]
    return render(1.12, lambda t: sum(beep(f, t - s, n, trem=0.35) for f, s, n in notes))


def weather_severe():
    # long, short, short: 2.0 s, then two of 0.5 s, 0.25 s apart (3.5 s: under the class's 4 s repeat)
    bursts = [(0.0, 2.0), (2.25, 0.5), (3.0, 0.5)]

    def at(t):
        for s, n in bursts:
            if s <= t <= s + n:
                u = t - s
                env = min(1.0, u / 0.006) * min(1.0, (n - u) / 0.006)
                return (math.sin(TAU * 853 * t) + math.sin(TAU * 960 * t)) * env
        return 0.0
    return render(3.5, at)


def rain_alarm():
    # a drop: a sine whose pitch jumps up as the cavity closes, gone in a tenth of a second
    drops = [(0.0, 1400, 1.0), (0.15, 1900, 0.7), (0.26, 1250, 0.9), (0.43, 2100, 0.6), (0.52, 1600, 0.85)]
    out = [0.0] * int(RATE * 1.6)
    for start, f0, gain in drops:
        phase = 0.0
        for i in range(int(RATE * 0.14)):
            t = i / RATE
            f = f0 * (1 + 0.75 * (1 - math.exp(-t / 0.022)))
            phase += TAU * f / RATE
            env = min(1.0, t / 0.002) * math.exp(-t * 30)
            out[int(start * RATE) + i] += math.sin(phase) * env * gain
    for i in range(len(out)):
        out[i] += 0.7 * bell(1318.5, i / RATE - 0.72, 0.85)
    return out


def software_update():
    # C5 then E5, the second a touch softer: "something new, when you have a moment"
    notes = [(523.3, 0.0, 0.55, 1.0), (659.3, 0.16, 0.7, 0.85)]
    return render(0.9, lambda t: sum(g * soft(f, t - s, r) for f, s, r, g in notes))


def lapis_countdown():
    return render(1.75, lambda t: sum(gong(830.6, t - s, 0.85) for s in (0.0, 0.42, 0.84)))


def lapis_unlocked():
    return render(1.3, lambda t: 0.8 * (chirp(t, 0.07, 2300, 2900) + chirp(t - 0.13, 0.07, 2300, 2900))
                  + gong(659.3, t - 0.36, 0.5) + gong(880.0, t - 0.58, 0.7))


def lapis_issue():
    notes = [(880.0, 0.0, 0.5), (622.3, 0.24, 0.6), (880.0, 0.78, 0.5), (622.3, 1.02, 0.85)]
    return render(1.9, lambda t: sum(gong(f, t - s, r) for f, s, r in notes))


SOUNDS = {
    'BatteryLow': battery_low,
    'BatteryCritical': battery_critical,
    'BatteryFull': battery_full,
    'WeatherAlert': weather_alert,
    'WeatherSevere': weather_severe,
    'RainAlarm': rain_alarm,
    'SoftwareUpdate': software_update,
    'LapisCountdown': lapis_countdown,
    'LapisUnlocked': lapis_unlocked,
    'LapisIssue': lapis_issue,
}

# per sound: the peak (of full scale) and a drive into a soft clip (tanh; louder at the same peak, and
# harsher) - the loudness tiers above. Unlisted: peak 0.8, no drive.
LEVEL = {
    'WeatherSevere': (0.89, 6.0),
    'WeatherAlert': (0.85, 0.6),
    'BatteryCritical': (0.75, 0.0),
    'LapisUnlocked': (0.85, 2.2),
    'LapisIssue': (0.85, 2.4),
    'BatteryLow': (0.3, 0.0),
    'RainAlarm': (0.7, 0.0),
    'BatteryFull': (0.4, 0.0),
    'LapisCountdown': (0.5, 0.0),
    'SoftwareUpdate': (0.4, 0.0),
}

out_dir = sys.argv[1] if len(sys.argv) > 1 else 'public/sounds/wm61'
names = sys.argv[2:] or list(SOUNDS)
os.makedirs(out_dir, exist_ok=True)
for name in names:
    samples = SOUNDS[name]()
    # the tail to silence over the last 30 ms, so a ringing note never ends on a click
    fade = int(RATE * 0.03)
    for i in range(fade):
        samples[-1 - i] *= i / fade
    peak = max(abs(x) for x in samples) or 1
    level, drive = LEVEL.get(name, (0.8, 0.0))
    if drive > 0:
        samples = [math.tanh(drive * x / peak) for x in samples]
        peak = max(abs(x) for x in samples) or 1
    path = os.path.join(out_dir, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(x / peak * level * 32767)) for x in samples))
    print(path, f'{len(samples) / RATE:.2f} s')
