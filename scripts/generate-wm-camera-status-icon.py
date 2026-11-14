#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-camera-status-icon.py [public/static_images/wm61] [--show]
# Traffic's speed camera glyph (Yozora #810, a Melaton-only concept: the ROM has none), drawn as the
# ROM draws its title-bar glyphs (generate-wm-continuity-status-icon.py): 1-bit white, 2 px strokes at
# 2x on the mail glyph's rows (6..29). A roadside speed camera: its housing (outline) with the round
# lens filled, the flash unit on top, on a pole with a foot.
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import math, os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def glyph(x, y):
    px, py = x + 0.5, y + 0.5
    # flash unit on top of the housing (filled)
    if 18 <= x < 26 and 6 <= y < 9:
        return True
    # housing: outline 2 px, x 4..28, y 10..22
    x0, y0, x1, y1 = 4, 10, 28, 22
    if x0 <= x < x1 and y0 <= y < y1 and not (x0 + 2 <= x < x1 - 2 and y0 + 2 <= y < y1 - 2):
        return True
    # the lens: a filled disc inside the housing's left half, a clear ring round it
    if math.hypot(px - 11.5, py - 16) <= 3.6:
        return True
    # a small window on the right half
    if 19 <= x < 24 and 14 <= y < 18:
        return True
    # pole and foot
    if 15 <= x < 17 and 22 <= y < 28:
        return True
    if 11 <= x < 21 and 28 <= y < 30:
        return True
    return False


big = [[glyph(x, y) for x in range(W)] for y in range(W)]
small = [[sum(big[2 * y + j][2 * x + i] for i in (0, 1) for j in (0, 1)) >= 2 for x in range(W // 2)] for y in range(W // 2)]
huge = [[big[y // 2][x // 2] for x in range(W * 2)] for y in range(W * 2)]
png(os.path.join(OUT, 'status-camera@2x.png'), W, W, big)
png(os.path.join(OUT, 'status-camera.png'), W // 2, W // 2, small)
png(os.path.join(OUT, 'status-camera@4x.png'), W * 2, W * 2, huge)
if '--show' in sys.argv:
    for r in big:
        print(''.join('#' if v else '.' for v in r))
    print()
    for r in small:
        print(''.join('#' if v else '.' for v in r))
