#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-activesync-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph for ActiveSync Received Items (Yozora #803). Title-bar glyphs are
# 1-bit white like the ROM's (never colour: Yukimi, Nov 13), drawn as generate-wm-weather-status-icons.py
# and generate-wm-continuity-status-icon.py draw theirs: 2x on a 32 px grid, 2 px strokes on the mail
# glyph's rows (6..29). The shape is ActiveSync's sync arrows (the program icon's two arrows chasing
# round a circle, repllog.exe): two arcs with an arrowhead at each clockwise end.
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32
CX, CY, R = 15.5, 17.5, 9.0


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def in_tri(px, py, a, b, c):
    def s(p, q, r): return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = s((px, py), a, b), s((px, py), b, c), s((px, py), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


# arcs (degrees, 0 = right, clockwise on screen since y grows downward): each runs 140 deg, the gaps
# before the heads leave room for them
ARCS = [(200, 330), (20, 150)]


def head(end_deg):
    # an arrowhead at the arc's clockwise end, pointing on along the circle
    t = math.radians(end_deg)
    ex, ey = CX + R * math.cos(t), CY + R * math.sin(t)
    tx, ty = -math.sin(t), math.cos(t)          # clockwise tangent
    nx, ny = math.cos(t), math.sin(t)           # outward normal
    tip = (ex + tx * 6.0, ey + ty * 6.0)
    return (tip, (ex + nx * 4.5, ey + ny * 4.5), (ex - nx * 4.5, ey - ny * 4.5))


HEADS = [head(a1) for _, a1 in ARCS]


def glyph(x, y):
    px, py = x + 0.5, y + 0.5
    if not (6 <= y <= 29):
        return False
    for h in HEADS:
        if in_tri(px, py, *h):
            return True
    d = math.hypot(px - CX, py - CY)
    if abs(d - R) > 1.0:
        return False
    ang = math.degrees(math.atan2(py - CY, px - CX)) % 360
    return any(a0 <= ang <= a1 for a0, a1 in ARCS)


big = [[glyph(x, y) for x in range(W)] for y in range(W)]
small = [[sum(big[2 * y + j][2 * x + i] for i in (0, 1) for j in (0, 1)) >= 2 for x in range(W // 2)] for y in range(W // 2)]
huge = [[big[y // 2][x // 2] for x in range(W * 2)] for y in range(W * 2)]
png(os.path.join(OUT, 'status-activesync@2x.png'), W, W, big)
png(os.path.join(OUT, 'status-activesync.png'), W // 2, W // 2, small)
png(os.path.join(OUT, 'status-activesync@4x.png'), W * 2, W * 2, huge)
if '--show' in sys.argv:
    for r in big:
        print(''.join('#' if v else '.' for v in r))
