#!/usr/bin/env python3
# Usage: python3 scripts/generate-traffic-camera-sound.py
# Traffic's speed camera alert (Yozora #810): our own sound, a 2009 radar-detector style rising triple
# beep (three short tones climbing a fourth, the last held a little longer), soft-edged so it cuts
# through car noise without clicking. Writes public/sounds/wm61/TrafficCamera.wav (22.05 kHz 16-bit
# mono) for Melaton Mobile's notification class and the Android app's res/raw copy (same file).
import math, os, struct, sys, wave

RATE = 22050
OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/sounds/wm61/TrafficCamera.wav'
# (frequency Hz, length s, gap after s)
NOTES = [(1318.5, 0.085, 0.055), (1568.0, 0.085, 0.055), (1760.0, 0.20, 0.0)]


def tone(f, length):
    n = int(RATE * length)
    out = []
    for i in range(n):
        t = i / RATE
        # a bright, slightly square tone (fundamental + odd harmonics), 4 ms attack, gentle release
        s = math.sin(2 * math.pi * f * t) + 0.30 * math.sin(2 * math.pi * 3 * f * t) + 0.12 * math.sin(2 * math.pi * 5 * f * t)
        env = min(1.0, t / 0.004) * min(1.0, (length - t) / (0.035 if length > 0.1 else 0.012))
        out.append(s * env / 1.42)
    return out


samples = []
for f, length, gap in NOTES:
    samples += tone(f, length)
    samples += [0.0] * int(RATE * gap)
samples += [0.0] * int(RATE * 0.03)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 0.82 * 32767)) for s in samples))
print(OUT, f'{len(samples) / RATE:.2f} s')
