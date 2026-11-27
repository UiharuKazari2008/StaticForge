#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-fleet-status-icons.py public/static_images/wm61
# Melaton Mobile's title-bar glyphs for Fleet's notices (StaticForge #1291, Yukimi Nov 26 2026: Fleet's notices get a
# registered icon of their own, specific to the kind). Drawn as the ROM draws its status glyphs
# (generate-wm-tape-status-icon.py): 1-bit white, 2 px strokes at 2x on the mail glyph's rows (6..29).
#   status-fleet-done    a ring with a check mark   (a work item finished)
#   status-fleet-attn    a diamond with an exclamation mark   (a work item needs Yukimi)
#   status-fleet-login   a key   (a Claude account has to sign in again)
# Not the warning triangle (status-warning) or the bubble (status-notify): a Fleet notice must read as Fleet's.
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists them).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def box(x, y, x0, y0, x1, y1):
    return x0 <= x < x1 and y0 <= y < y1


def seg_dist(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def done(x, y):
    d = math.hypot(x - 16, y - 17.5)
    if 9.5 <= d < 11.8:
        return True
    return min(seg_dist(x, y, 10.5, 17.8, 14.6, 21.6), seg_dist(x, y, 14.6, 21.6, 22.2, 13.2)) < 1.35


def attn(x, y):
    d = abs(x - 16) + abs(y - 17.5)
    if 10.4 <= d < 13.2:
        return True
    return box(x, y, 14.8, 11.8, 17.2, 19.6) or box(x, y, 14.8, 21.2, 17.2, 23.6)


def login(x, y):
    d = math.hypot(x - 9, y - 17.5)
    if 3.2 <= d < 6.2:
        return True
    if box(x, y, 14.8, 16.5, 30.0, 18.9):
        return True
    return box(x, y, 24.0, 18.9, 26.4, 22.6) or box(x, y, 27.6, 18.9, 30.0, 21.4)


def grids(fn):
    g2 = [[1 if fn(px + .5, py + .5) else 0 for px in range(W)] for py in range(W)]
    g1 = [[1 if sum(g2[2 * y + j][2 * x + i] for j in (0, 1) for i in (0, 1)) >= 2 else 0 for x in range(16)] for y in range(16)]
    g4 = [[g2[y // 2][x // 2] for x in range(64)] for y in range(64)]
    return g1, g2, g4


for name, fn in (('status-fleet-done', done), ('status-fleet-attn', attn), ('status-fleet-login', login)):
    g = grids(fn)
    for k, (sfx, size) in enumerate((('', 16), ('@2x', 32), ('@4x', 64))):
        png(os.path.join(OUT, f'{name}{sfx}.png'), size, size, g[k])
print('status-fleet-done, status-fleet-attn, status-fleet-login')
