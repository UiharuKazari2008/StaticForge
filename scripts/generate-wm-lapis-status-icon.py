#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-lapis-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph for Lapis Remote (Yozora #835, a Melaton extension; the ROM has none):
# shown while a remote start is running. Drawn as the ROM draws its status glyphs (see
# generate-wm-traffic-status-icon.py): 1-bit white, 2 px strokes at 2x on the mail glyph's rows (6..29).
#   status-lapis   the engine start button's mark: a ring open at the top with a bar through the gap
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def start(x, y):
    # the bar: x 14..18, rows 6..18
    if 14 <= x < 18 and 6 <= y < 18:
        return True
    # the ring: centre (16, 19), 3 px thick, open at the top either side of the bar
    r = math.hypot(x - 16, y - 19)
    if 7.5 <= r < 10.6:
        if y < 14 and abs(x - 16) < 6:
            return False
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


write('status-lapis', start)
