#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-notification-sounds.py [out-dir] [name ...]
# Melaton Mobile's own notification sounds (Yozora #848), one per sound class of wmShell.js
# SND_EVENTS. All synthesised here (no samples), 22.05 kHz 16-bit mono like TrafficCamera.wav and
# LapisCountdown.wav, written to public/sounds/wm61:
#
#   BatteryLow.wav       battery-low       two wooden mallet notes falling a fourth: "running down"
#   BatteryCritical.wav  battery-very-low  a harder falling three-note figure, played twice
#   BatteryFull.wav      battery-full      a bright bell arpeggio rising an octave: "topped up"
#   WeatherAlert.wav     weather-alert     a weather-radio style high-low pair, twice, the last held
#   WeatherSevere.wav    weather-severe    the 853 Hz + 960 Hz two-tone attention signal, in the
#                                          long-short-short cadence of a phone's emergency alert.
#                                          Tones only: no header or end-of-message data bursts.
#   RainAlarm.wav        rain-alarm        five water drops, then one soft bell
#   SoftwareUpdate.wav   update            a glassy rising fifth and octave with a shimmer on top
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


def beep(f, t, length, edge=0.008, trem=0.0):
    """A held soft-square tone with shaped edges; trem = depth of a 14 Hz flutter."""
    if t < 0 or t > length:
        return 0.0
    env = min(1.0, t / edge) * min(1.0, (length - t) / edge)
    s = math.sin(TAU * f * t) + 0.25 * math.sin(TAU * 3 * f * t) + 0.08 * math.sin(TAU * 5 * f * t)
    return s * env * (1 - trem * (0.5 + 0.5 * math.sin(TAU * 14 * t)))


def render(length, fn):
    return [fn(i / RATE) for i in range(int(RATE * length))]


def battery_low():
    notes = [(880.0, 0.0, 0.55), (659.3, 0.21, 0.75)]
    return render(1.0, lambda t: sum(mallet(f, t - s, r) for f, s, r in notes))


def battery_critical():
    figure = [(880.0, 0.0), (698.5, 0.12), (587.3, 0.24)]
    notes = [(f, s + rep, 0.34 if i < 2 else 0.5) for rep in (0.0, 0.62) for i, (f, s) in enumerate(figure)]
    return render(1.45, lambda t: sum(mallet(f, t - s, r, hard=1.0) for f, s, r in notes))


def battery_full():
    notes = [(1046.5, 0.0, 0.5), (1318.5, 0.105, 0.5), (1568.0, 0.21, 0.6), (2093.0, 0.315, 1.0)]
    return render(1.4, lambda t: sum(bell(f, t - s, r) for f, s, r in notes))


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
    notes = [(784.0, 0.0, 0.6, 1.0), (1174.7, 0.13, 0.6, 0.9), (1568.0, 0.26, 1.2, 1.0), (1975.5, 0.39, 1.1, 0.45)]
    return render(1.55, lambda t: sum(g * glass(f, t - s, r) for f, s, r, g in notes))


SOUNDS = {
    'BatteryLow': battery_low,
    'BatteryCritical': battery_critical,
    'BatteryFull': battery_full,
    'WeatherAlert': weather_alert,
    'WeatherSevere': weather_severe,
    'RainAlarm': rain_alarm,
    'SoftwareUpdate': software_update,
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
    path = os.path.join(out_dir, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(x / peak * 0.8 * 32767)) for x in samples))
    print(path, f'{len(samples) / RATE:.2f} s')
