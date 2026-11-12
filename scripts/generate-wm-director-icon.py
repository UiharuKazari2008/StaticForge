#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-director-icon.py public/static_images/wm61
# The Director's tray glyph (Melaton extension; the ROM has none), drawn as the ROM draws its
# status glyphs: 1-bit, 2 px strokes at 2x, on the mail glyph's rows (6..29). A clapperboard: the
# stick (2 px outline, 2 px end caps, 4 px slanted stripes) over a slate (2 px frame, two lines of
# slate writing). status-director = closed; status-director-open-0..4 lift the stick about its left
# hinge by 4 degrees a step (wmShell DIRECTOR_CLAP uses 0..2; strip: build-wm-sprite-strips.sh).
# 2x drawn (4x4 supersampled where the stick is turned, 50 % threshold); 1x = 2x2 downscale
# thresholded at 50 %; 4x = point upscale.
import math, struct, zlib, sys, os
OUT = sys.argv[1]
W = 32
HX, HY = 0.0, 14.0  # the hinge: the stick's bottom-left corner
def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
def stick_pt(x, y):
    # 2 px rails top and bottom; between them 4 px stripes that step 2 px every 2 rows (the even
    # grid keeps the 1x downscale clean)
    if not (0 <= x < 32 and 6 <= y < 14): return 0
    if y < 8 or y >= 12: return 1
    return 1 if math.floor((x - 2 * math.floor((y - 8) / 2)) / 4) % 2 == 0 else 0
def draw(ang):
    g = [[0] * W for _ in range(W)]
    # slate: rows 16..29, 2 px frame; writing at rows 20-21 (x 6..25) and 24-25 (x 6..19)
    for y in range(16, 30):
        for x in range(W):
            g[y][x] = 1 if (y < 18 or y >= 28 or x < 2 or x >= 30) else 0
    for y in (20, 21):
        for x in range(6, 26): g[y][x] = 1
    for y in (24, 25):
        for x in range(6, 20): g[y][x] = 1
    a = math.radians(ang)
    for py in range(W):
        for px in range(W):
            n = 0
            for sy in range(4):
                for sx in range(4):
                    x = px + (sx + .5) / 4 - HX; y = py + (sy + .5) / 4 - HY
                    n += stick_pt(x * math.cos(a) - y * math.sin(a) + HX, x * math.sin(a) + y * math.cos(a) + HY)
            if n >= 8: g[py][px] = 1
    return g
def save(name, g):
    png(os.path.join(OUT, f'{name}@2x.png'), W, W, g)
    png(os.path.join(OUT, f'{name}.png'), 16, 16, [[1 if sum(g[2*y+dy][2*x+dx] for dy in (0, 1) for dx in (0, 1)) >= 2 else 0 for x in range(16)] for y in range(16)])
    png(os.path.join(OUT, f'{name}@4x.png'), 64, 64, [[g[y // 2][x // 2] for x in range(64)] for y in range(64)])
save('status-director', draw(0))
for i in range(5):
    save(f'status-director-open-{i}', draw(4 * (i + 1)))
print('ok')
