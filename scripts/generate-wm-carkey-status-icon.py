#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-carkey-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph for the phone's car key (Yozora #874, a Melaton extension; the ROM
# has none): shown while Samsung Digital Key reports the car in range. Drawn as the ROM draws its
# status glyphs (see generate-wm-lapis-status-icon.py): 1-bit white, 2 px strokes at 2x on the mail
# glyph's rows (6..29).
#   status-carkey   a car from the side: cabin and body outlined, wheels solid
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def inside_body(x, y):
    # the body: x 2..30, rows 16..25
    return 2 <= x < 30 and 16 <= y < 25


def inside_cabin(x, y):
    # the cabin: a trapezoid, roof x 10..22 at row 8, x 5..27 at row 16
    if not 8 <= y < 16:
        return False
    t = (y - 8) / 8
    return 10 - 5 * t <= x < 22 + 5 * t


def car(x, y):
    # wheels: solid, centres (9, 25) and (23, 25), radius 4
    for cx in (9, 23):
        if math.hypot(x - cx, y - 25) < 4:
            return True
    # clear a ring round each wheel so it stands off the body
    for cx in (9, 23):
        if math.hypot(x - cx, y - 25) < 6:
            return False
    if not (inside_body(x, y) or inside_cabin(x, y)):
        return False
    # outline 2 px: a point inside whose 2 px neighbourhood leaves the shape
    for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2)):
        if not (inside_body(x + dx, y + dy) or inside_cabin(x + dx, y + dy)):
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
    if os.environ.get('SHOW'):
        for row in g2:
            print(''.join('#' if v else '.' for v in row))
        for row in g1:
            print(''.join('#' if v else '.' for v in row))


write('status-carkey', car)
