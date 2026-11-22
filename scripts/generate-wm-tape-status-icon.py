#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-tape-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph while XM Radio records (#1020 follow-up, Yukimi Nov 21 2026: "a tape icon with a
# 250ms animation of it moving"). The ROM has no cassette in its title-bar sets (a Melaton-only concept), so it is
# drawn as the ROM draws its status glyphs (generate-wm-continuity-status-icon.py): 1-bit white, 2 px strokes at 2x on
# the mail glyph's rows (6..29).
#   status-tape          a cassette: the shell's outline, the label window, two reels with three spokes, the head
#                        opening at the bottom edge
#   status-tape-0..3     the reels turned 0 / 30 / 60 / 90 degrees (three spokes repeat every 120: four frames loop)
#   status-tape-strip    the four frames side by side (wm-shell.css .wm-strip, 250 ms a frame)
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists them).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32
FRAMES = 4


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def rect_outline(x, y, x0, y0, x1, y1, t=2):
    return x0 <= x < x1 and y0 <= y < y1 and not (x0 + t <= x < x1 - t and y0 + t <= y < y1 - t)


REELS = ((10.5, 16.0), (21.5, 16.0))


def make(turn):
    def glyph(x, y):
        # the shell: 30 x 22, its corners cut
        x0, y0, x1, y1 = 1, 7, 31, 29
        if (x < x0 + 1 or x >= x1 - 1) and (y < y0 + 1 or y >= y1 - 1):
            return False
        if rect_outline(x, y, x0, y0, x1, y1):
            return True
        # the head opening: a trapezoid's top edge and slanted sides along the bottom
        if 23 <= y < 25 and 8 <= x < 24:
            return True
        if 25 <= y < 27 and (7 <= x < 9 or 23 <= x < 25):
            return True
        # the reels: a 2 px ring and three spokes, turned
        for cx, cy in REELS:
            d = math.hypot(x - cx, y - cy)
            if 3.0 <= d < 5.0:
                return True
            if d < 3.0:
                a = (math.degrees(math.atan2(y - cy, x - cx)) - turn) % 120
                if (a < 22 or a > 98) and d >= 0.9:
                    return True
        # the tape between the reels, over the window's top
        if 11 <= y < 12 and 10 <= x < 22:
            return True
        return False
    return glyph


def grids(fn):
    g2 = [[1 if fn(px + .5, py + .5) else 0 for px in range(W)] for py in range(W)]
    g1 = [[1 if sum(g2[2 * y + j][2 * x + i] for j in (0, 1) for i in (0, 1)) >= 2 else 0 for x in range(16)] for y in range(16)]
    g4 = [[g2[y // 2][x // 2] for x in range(64)] for y in range(64)]
    return g1, g2, g4


frames = [grids(make(i * 30)) for i in range(FRAMES)]
for k, (sfx, size) in enumerate((('', 16), ('@2x', 32), ('@4x', 64))):
    png(os.path.join(OUT, f'status-tape{sfx}.png'), size, size, frames[0][k])
    for i in range(FRAMES):
        png(os.path.join(OUT, f'status-tape-{i}{sfx}.png'), size, size, frames[i][k])
    strip = [sum((frames[i][k][y] for i in range(FRAMES)), []) for y in range(size)]
    png(os.path.join(OUT, f'status-tape-strip{sfx}.png'), size * FRAMES, size, strip)
print('status-tape, status-tape-0..3, status-tape-strip')
