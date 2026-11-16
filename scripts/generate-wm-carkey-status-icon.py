#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-carkey-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph for the phone's car key (Yozora #874, a Melaton extension; the ROM
# has none): shown while Samsung Digital Key reports the car in range. Drawn as the ROM draws its
# status glyphs (see generate-wm-lapis-status-icon.py): 1-bit white, 2 px strokes at 2x on the mail
# glyph's rows (6..29).
#   status-carkey   a solid key (ring, blade, two teeth) with two thick signal arcs over its ring
#                   (Yukimi's pick, Nov 16; was a car from the side, too close to Traffic's car)
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def arcs(x, y, cx, cy, radii, a0, a1, th):
    r = math.hypot(x - cx, y - cy)
    a = math.degrees(math.atan2(cy - y, x - cx))
    return a0 <= a <= a1 and any(R <= r < R + th for R in radii)


def key(x, y):
    # the ring: centre (9, 21), 3.2..8
    r = math.hypot(x - 9, y - 21)
    if 3.2 <= r < 8:
        return True
    # the blade and its two teeth
    if 15 <= x < 31 and 18.5 <= y < 23.5:
        return True
    if (22 <= x < 25 or 27 <= x < 30) and 23.5 <= y < 28:
        return True
    # two signal arcs over the ring, 3 px thick at 2x
    return arcs(x, y, 9, 21, [10, 15.5], 48, 112, 3)


def write(name, fn):
    g2 = [[1 if fn(px + .5, py + .5) else 0 for px in range(W)] for py in range(W)]
    g1 = [[1 if sum(g2[2 * y + j][2 * x + i] for j in (0, 1) for i in (0, 1)) >= 2 else 0 for x in range(16)] for y in range(16)]
    g4 = [[g2[y // 2][x // 2] for x in range(64)] for y in range(64)]
    png(os.path.join(OUT, f'{name}.png'), 16, 16, g1)
    png(os.path.join(OUT, f'{name}@2x.png'), 32, 32, g2)
    png(os.path.join(OUT, f'{name}@4x.png'), 64, 64, g4)
    print(name)
    if os.environ.get('SHOW'):
        for row in g2:
            print(''.join('#' if v else '.' for v in row))
        for row in g1:
            print(''.join('#' if v else '.' for v in row))


write('status-carkey', key)
