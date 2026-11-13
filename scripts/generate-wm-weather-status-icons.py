#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-weather-status-icons.py public/static_images/wm61
# Melaton Mobile's title-bar glyphs for Weather (Yozora #792, Melaton extensions; the ROM has none),
# drawn as the ROM draws its status glyphs: 1-bit white, 2 px strokes at 2x on the mail glyph's rows
# (6..29), a 2 px clear gap where two shapes meet.
#   status-weather-alert   a solid cloud with a solid warning triangle over its corner (2 px gap, an
#                          exclamation knocked out on the even grid so it survives the 1x halving)
#   status-rain-alarm      an umbrella: scalloped canopy, shaft and hook, two drops falling past it
# 2x drawn (4x4 supersampled curves, 50 % threshold); 1x = 2x2 downscale thresholded at 50 %;
# 4x = point upscale (wmShell HD_ART lists both names).
import math, struct, zlib, sys, os

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def raster(fn):
    """fn(x, y) -> bool at sub-pixel points; 4x4 supersampled, on at >= 50 %."""
    g = [[0] * W for _ in range(W)]
    for py in range(W):
        for px in range(W):
            n = sum(1 for sy in range(4) for sx in range(4) if fn(px + (sx + .5) / 4, py + (sy + .5) / 4))
            g[py][px] = 1 if n >= 8 else 0
    return g


def circle(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def union(*fs):
    return lambda x, y: any(f(x, y) for f in fs)


def rect(x0, y0, x1, y1):
    return lambda x, y: x0 <= x < x1 and y0 <= y < y1


# ---------------------------------------------------------------- the cloud with a warning triangle

def cloud_solid(x, y):
    # a flat-bottomed cloud: two puffs over a body, rows 7..22
    return union(circle(7, 18, 4.5), circle(13.5, 13, 6.2), circle(20.5, 15.5, 4.6), rect(7, 16, 20.5, 22.5))(x, y)


def cloud_inner(x, y):
    return union(circle(9, 16, 3.5), circle(16, 12, 4.5), circle(22, 15.5, 3), rect(9, 15, 22, 19.5))(x, y)


TRI = ((23.0, 12.0), (31.8, 30.0), (14.2, 30.0))  # apex, right, left


def in_tri(x, y, pts, grow=0.0):
    (ax, ay), (bx, by), (cx, cy) = pts
    def side(px, py, qx, qy, rx, ry):
        return (qx - px) * (ry - py) - (qy - py) * (rx - px)
    # grow pushes each edge outward by `grow` px (the clear gap around the triangle)
    def edge_ok(px, py, qx, qy, ox, oy):
        l = math.hypot(qx - px, qy - py)
        s = side(px, py, qx, qy, x, y) / l
        o = side(px, py, qx, qy, ox, oy)
        return s * (1 if o > 0 else -1) >= -grow
    return edge_ok(ax, ay, bx, by, cx, cy) and edge_ok(bx, by, cx, cy, ax, ay) and edge_ok(cx, cy, ax, ay, bx, by)


def alert(x, y):
    if in_tri(x, y, TRI):
        # the exclamation knocked out: a 2 px bar (rows 18..24) and a 2 px dot (26..28), on even pixels
        if 22 <= x < 24 and (18 <= y < 24 or 26 <= y < 28):
            return False
        return True
    if in_tri(x, y, TRI, grow=2.0):
        return False  # the clear gap
    return cloud_solid(x, y)


# ---------------------------------------------------------------- the umbrella

def umbrella(x, y):
    # canopy: a half disc over rows 6..17 with three scallops cut from its rim
    cx, cy, r = 16, 17.5, 13
    canopy = (x - cx) ** 2 + (y - cy) ** 2 <= r * r and y <= 17.5
    if canopy:
        for sx in (7.3, 16, 24.7):
            if (x - sx) ** 2 + (y - 18.6) ** 2 <= 4.6 ** 2:
                canopy = False
        # the tip
    if 15 <= x < 17 and 4.5 <= y < 6.5:
        return True
    if canopy:
        return True
    # shaft and the hook (a 2 px J ending at x 11)
    if 15 <= x < 17 and 13.5 <= y < 26:
        return True
    hook = (x - 13) ** 2 + (y - 26) ** 2
    if 2.0 ** 2 <= hook <= 4.0 ** 2 and y >= 26 and x <= 17:
        return True
    # two falling drops (2 x 4 px, slanted by a 2 px step) left and right of the shaft, below the rim
    for dx, dy in ((5, 21), (25, 22)):
        if (dx <= x < dx + 2 and dy <= y < dy + 2) or (dx - 1 <= x < dx + 1 and dy + 2 <= y < dy + 4):
            return True
    return False


def write(name, fn):
    g2 = raster(fn)
    g1 = [[1 if sum(g2[2 * y + j][2 * x + i] for j in (0, 1) for i in (0, 1)) >= 2 else 0 for x in range(16)] for y in range(16)]
    g4 = [[g2[y // 2][x // 2] for x in range(64)] for y in range(64)]
    png(os.path.join(OUT, f'{name}.png'), 16, 16, g1)
    png(os.path.join(OUT, f'{name}@2x.png'), 32, 32, g2)
    png(os.path.join(OUT, f'{name}@4x.png'), 64, 64, g4)
    print(name)


write('status-weather-alert', alert)
write('status-rain-alarm', umbrella)
