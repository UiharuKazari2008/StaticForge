#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-update-status-icons.py [public/static_images/wm61]
#
# Melaton Update's title-bar glyphs (Yukimi, Nov 14 2026), drawn as the shell's other status icons
# are: 1-bit white on the 16 px grid (1 px strokes), the ROM's tray-and-arrow idea (shellres group
# 4672) in its 6.1 weight; 2x and 4x are point upscales, so they stay as blocky as their neighbours
# (Yukimi: the first 32 px anti-aliased drawing was far too fine for Windows Mobile).
#   status-update-dl-strip   downloading: the arrow drops into the tray (4 frames side by side;
#                            wmShell paintUpdateIcon steps them at 220 ms)
#   status-update            ready to restart: the tray with a check mark in it
import os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
N = 16

# 2 px strokes on the 16 px grid, as the mail, data and volume glyphs beside it
TRAY = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '##............##',
    '##............##',
    '##............##',
    '##............##',
    '##............##',
    '################',
    '################',
    '................',
    '................',
]

# the arrow at rest (the last frame): its tip on row 11, inside the tray
ARROW = [
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
]
ARROW_TOP = 2  # the arrow's first row at rest

# ready to restart: the tray with a check mark (the update is in, a restart puts it on)
CHECK = [
    '................',
    '................',
    '............##..',
    '...........###..',
    '..........###...',
    '...##....###....',
    '...###..###.....',
    '....######......',
    '.....####.......',
    '......##........',
]


def grid(rows):
    return [[1 if c == '#' else 0 for c in r] for r in rows]


def frame(dy):
    g = grid(TRAY)
    for i, r in enumerate(ARROW):
        y = ARROW_TOP + dy + i
        if y < 0 or y > 11:  # clipped at the top edge and above the tray's bottom
            continue
        for x, c in enumerate(r):
            if c == '#':
                g[y][x] = 1
    return g


def png(path, g):
    h, w = len(g), len(g[0])
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if v else b'\x00\x00\x00\x00' for v in r) for r in g)
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def up(g, k):
    return [[v for v in r for _ in range(k)] for r in g for _ in range(k)]


def save(name, g):
    png(os.path.join(OUT, f'{name}.png'), g)
    png(os.path.join(OUT, f'{name}@2x.png'), up(g, 2))
    png(os.path.join(OUT, f'{name}@4x.png'), up(g, 4))


frames = [frame(dy) for dy in (-7, -4, -2, 0)]
save('status-update-dl-strip', [sum((f[y] for f in frames), []) for y in range(N)])
ready = grid(TRAY)
for y, r in enumerate(CHECK):
    for x, c in enumerate(r):
        if c == '#':
            ready[y][x] = 1
save('status-update', ready)
print('wrote status-update and status-update-dl-strip to', OUT)
