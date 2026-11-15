#!/usr/bin/env python3
# Usage: python3 scripts/generate-lapis-countdown-sound.py
# Lapis Remote's remote start countdown (Yozora #835): our own sound, played at 5, 3, 2 and 1 minutes
# left. A 2010 luxury-car cabin chime: two soft bell tones falling a major third (E6 then C6), each a
# warm sine with a little octave and fifth, quick attack and a long exponential decay, so it reads as
# "time is nearly up" without the urgency of an alarm. Writes public/sounds/wm61/LapisCountdown.wav
# (22.05 kHz 16-bit mono) for Melaton Mobile's lapis-run-left notification class.
import math, os, struct, sys, wave

RATE = 22050
OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/sounds/wm61/LapisCountdown.wav'
# (frequency Hz, start s, ring length s)
NOTES = [(1318.5, 0.0, 0.9), (1046.5, 0.28, 1.1)]
LENGTH = 1.45


def bell(f, t, ring):
    if t < 0 or t > ring:
        return 0.0
    env = min(1.0, t / 0.006) * math.exp(-t * 4.2 / ring)
    s = math.sin(2 * math.pi * f * t) + 0.28 * math.sin(2 * math.pi * 2 * f * t) * math.exp(-t * 6) + 0.12 * math.sin(2 * math.pi * 1.5 * f * t) * math.exp(-t * 8)
    return s * env / 1.4


samples = []
for i in range(int(RATE * LENGTH)):
    t = i / RATE
    samples.append(sum(bell(f, t - start, ring) for f, start, ring in NOTES))
peak = max(abs(x) for x in samples) or 1
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(x / peak * 0.8 * 32767)) for x in samples))
print(OUT, f'{len(samples) / RATE:.2f} s')
