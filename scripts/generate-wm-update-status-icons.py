#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-update-status-icons.py [~/.cache/wm65/dump/res/shellres.192.dll] [public/static_images/wm61]
#
# Melaton Update's title-bar glyphs (Yukimi, Nov 14 2026: better icons for downloading and ready
# to restart), built on the ROM's own tray-and-arrow (6.5 VGA title-bar set, shellres.192.dll
# group 4672: 32 px, white with alpha), never colour:
#   status-update-dl-strip   downloading: the ROM's arrow slides down into the tray (4 frames,
#                            side by side; wmShell paintUpdateIcon steps them at 220 ms)
#   status-update            ready to restart: the ROM's tray with a restart arrow (a circular
#                            arrow, clockwise, head at the top) in place of the down arrow, drawn
#                            anti-aliased as the ROM's own edges (16x supersampled)
# 2x = the 32 px art; 1x = 2x2 box-averaged; 4x = point upscale (wmShell HD_ART lists both).
import math, os, struct, sys, zlib

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/wm65/dump/res/shellres.192.dll')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/static_images/wm61'
GROUP = 4672
N = 32


def alpha_of(group):
    d = open(os.path.join(SRC, f'14_{group}.bin'), 'rb').read()
    _r, _t, n = struct.unpack_from('<HHH', d, 0)
    iid = None
    for i in range(n):
        w, _h, _c, _x, _pl, bpp, _sz, ii = struct.unpack_from('<BBBBHHIH', d, 6 + i * 14)
        if (w or 256) == 32 and bpp == 32:
            iid = ii
    b = open(os.path.join(SRC, f'3_{iid}.bin'), 'rb').read()
    hs, w, h2, _pl, bpp = struct.unpack_from('<IiiHH', b, 0)
    h = h2 // 2
    return [[b[hs + ((h - 1 - y) * w + x) * 4 + 3] for x in range(w)] for y in range(h)]


def png(path, a):
    """a: rows of alpha 0-255 -> white RGBA PNG."""
    h, w = len(a), len(a[0])
    raw = b''.join(b'\x00' + bytes(v for x in r for v in (255, 255, 255, x)) for r in a)
    ch = lambda t, x: struct.pack('>I', len(x)) + t + x + struct.pack('>I', zlib.crc32(t + x) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def half(a):
    return [[(a[2 * y][2 * x] + a[2 * y][2 * x + 1] + a[2 * y + 1][2 * x] + a[2 * y + 1][2 * x + 1]) // 4 for x in range(len(a[0]) // 2)] for y in range(len(a) // 2)]


def double(a):
    return [[v for v in r for _ in (0, 1)] for r in a for _ in (0, 1)]


def save(name, a2):
    png(os.path.join(OUT, f'{name}@2x.png'), a2)
    png(os.path.join(OUT, f'{name}.png'), half(a2))
    png(os.path.join(OUT, f'{name}@4x.png'), double(a2))


src = alpha_of(GROUP)
# the tray: its two sides (columns 3-4 and 27-28) and its bottom (rows 24-26); the rest is the arrow
tray = [[src[y][x] if (x <= 5 or x >= 26 or y >= 24) else 0 for x in range(N)] for y in range(N)]
arrow = [[src[y][x] if not (x <= 5 or x >= 26 or y >= 24) else 0 for x in range(N)] for y in range(N)]


def frame(dy):
    """The arrow moved down dy rows, clipped above the tray's bottom (row 23)."""
    out = [r[:] for r in tray]
    for y in range(N):
        sy = y - dy
        if y > 23 or sy < 0 or sy >= N:
            continue
        for x in range(N):
            out[y][x] = max(out[y][x], arrow[sy][x])
    return out


# downloading: the arrow comes in from above and drops into the tray
frames = [frame(dy) for dy in (-9, -4, 0, 4)]
strip = [sum((f[y] for f in frames), []) for y in range(N)]
save('status-update-dl-strip', strip)

# ready to restart: the tray with a circular arrow (270 degrees, clockwise, head at its end)
SS = 16
cx, cy, r, sw = 16.0, 13.0, 8.4, 3.6  # centre, radius, stroke width (32 px units)
start, end = math.radians(-60), math.radians(225)  # the gap at the top right


def in_arc(px, py):
    dx, dy = px - cx, py - cy
    d = math.hypot(dx, dy)
    if abs(d - r) > sw / 2:
        return False
    ang = math.atan2(dy, dx)  # 0 = right, positive = down (screen)
    a = (ang - start) % (2 * math.pi)
    return a <= (end - start)


# the arrowhead at the arc's start (top right), pointing along the clockwise motion's reverse:
# a triangle whose tip leads the gap, so it reads as "go round again"
hx, hy = cx + r * math.cos(start), cy + r * math.sin(start)
tang = start - math.pi / 2  # direction of travel at the start, anticlockwise
tip = (hx + 4.6 * math.cos(tang), hy + 4.6 * math.sin(tang))
nx, ny = math.cos(start), math.sin(start)
base1 = (hx + 4.4 * nx - 1.2 * math.cos(tang), hy + 4.4 * ny - 1.2 * math.sin(tang))
base2 = (hx - 4.4 * nx - 1.2 * math.cos(tang), hy - 4.4 * ny - 1.2 * math.sin(tang))


def in_tri(px, py, a, b, c):
    def s(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    p = (px, py)
    d1, d2, d3 = s(p, a, b), s(p, b, c), s(p, c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


ready = [r[:] for r in tray]
for y in range(23):
    for x in range(6, 26):
        hit = 0
        for sy in range(SS):
            for sx in range(SS):
                px, py = x + (sx + .5) / SS, y + (sy + .5) / SS
                if in_arc(px, py) or in_tri(px, py, tip, base1, base2):
                    hit += 1
        v = round(255 * hit / (SS * SS))
        ready[y][x] = max(ready[y][x], v)
save('status-update', ready)
print('wrote status-update and status-update-dl-strip to', OUT)
