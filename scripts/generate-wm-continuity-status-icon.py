#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-continuity-status-icon.py public/static_images/wm61
# Melaton Mobile's title-bar glyph for Continuity (Yozora #798, a Melaton extension): this phone carries
# its DeX window. Drawn as the ROM draws its status glyphs (generate-wm-weather-status-icons.py): 1-bit
# white, 2 px strokes at 2x on the mail glyph's rows (6..29), a 2 px clear gap where shapes meet.
#   status-continuity   a desktop monitor (outline, stand and foot) with a phone standing in front of
#                       its lower right corner (outline, a speaker dot), cut clear around the phone
# 2x drawn; 1x = 2x2 downscale thresholded at 50 %; 4x = point upscale (wmShell HD_ART lists it).
import os, struct, sys, zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/static_images/wm61'
W = 32


def png(path, w, h, on):
    raw = b''.join(b'\x00' + b''.join(b'\xff\xff\xff\xff' if on[y][x] else b'\x00\x00\x00\x00' for x in range(w)) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


def rect_outline(x, y, x0, y0, x1, y1, t=2):
    return x0 <= x < x1 and y0 <= y < y1 and not (x0 + t <= x < x1 - t and y0 + t <= y < y1 - t)


def glyph(x, y):
    phone = (19, 12, 29, 30)  # x0, y0, x1, y1
    in_phone_box = phone[0] <= x < phone[2] and phone[1] <= y < phone[3]
    gap = phone[0] - 2 <= x < phone[2] + 2 and phone[1] - 2 <= y < phone[3] + 2
    # the phone: outline, a speaker dot near the top
    if in_phone_box:
        if rect_outline(x, y, *phone):
            return True
        return 23 <= x < 25 and 15 <= y < 17
    if gap:
        return False
    # the monitor: screen outline, neck and foot
    if rect_outline(x, y, 1, 6, 25, 22):
        return True
    if 11 <= x < 15 and 22 <= y < 26:
        return True
    if 6 <= x < 20 and 26 <= y < 28:
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


write('status-continuity', glyph)
