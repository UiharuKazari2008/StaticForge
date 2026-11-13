#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-traffic-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph for Traffic (Yozora #795, a Melaton extension; the ROM has none),
# drawn as the ROM draws its status glyphs (see generate-wm-weather-status-icons.py): 1-bit white,
# 2 px strokes at 2x on the mail glyph's rows (6..29).
#   status-traffic   a car seen from the front: hollow windshield under the roof, solid body with
#                    the headlights and grille knocked out, two wheels
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def car(x, y):
    # roof and windshield: a trapezoid outline, rows 7..15, 2 px strokes
    if 7 <= y < 16:
        t = (y - 7) / 8.0
        left = 9 - 4 * t
        right = 23 + 4 * t
        if y < 9 and left <= x < right:
            return True  # roof
        if left <= x < left + 2 or right - 2 <= x < right:
            return True  # pillars
    # body: rows 16..24, x 3..29, rounded corners; headlights and grille knocked out
    if 16 <= y < 25 and 3 <= x < 29:
        if (y < 17 or y >= 24) and (x < 4 or x >= 28):
            return False
        if 18 <= y < 21 and (6 <= x < 10 or 22 <= x < 26):
            return False  # headlights
        if 18 <= y < 20 and 12 <= x < 20:
            return False  # grille
        return True
    # wheels: rows 25..29
    if 25 <= y < 30 and (5 <= x < 10 or 22 <= x < 27):
        return True
    return False


def write(name, fn):
    g2 = [[1 if fn(px + .5, py + .5) else 0 for px in range(W)] for py in range(W)]
    g1 = [[1 if sum(g2[2 * y + j][2 * x + i] for j in (0, 1) for i in (0, 1)) >= 2 else 0 for x in range(16)] for y in range(16)]
    g4 = [[g2[y // 2][x // 2] for x in range(64)] for y in range(64)]
    png(os.path.join(OUT, f'{name}.png'), 16, 16, g1)
    png(os.path.join(OUT, f'{name}@2x.png'), 32, 32, g2)
    png(os.path.join(OUT, f'{name}@4x.png'), 64, 64, g4)
    print(name)


write('status-traffic', car)
