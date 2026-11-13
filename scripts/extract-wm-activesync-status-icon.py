#!/usr/bin/env python3
# Usage: python3 scripts/extract-wm-activesync-status-icon.py ~/.cache/wm65/dump/res/repllog.exe public/static_images/wm61
# Melaton Mobile's title-bar glyph for ActiveSync Received Items (Yozora #803): the ActiveSync program's
# own small icon (repllog.exe RT_ICON 7 = 16 px, 4 = 32 px; 8-bit palette + AND mask), as WM's title bar
# shows a program's notification by its small icon. 1x = 16 px, 2x = 32 px, 4x = 2x point-upscaled.
import os, struct, sys, zlib

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/wm65/dump/res/repllog.exe')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/static_images/wm61'


def decode(path):
    d = open(path, 'rb').read()
    hs, w, h2, _pl, bpp = struct.unpack_from('<IiiHH', d, 0)
    h = h2 // 2
    assert bpp == 8, bpp
    pal = [d[hs + i * 4: hs + i * 4 + 4] for i in range(256)]
    px = hs + 256 * 4
    row = (w + 3) & ~3
    mrow = ((w + 31) // 32) * 4
    mask = px + row * h
    out = []
    for y in range(h):
        sy = h - 1 - y
        line = []
        for x in range(w):
            b, g, r, _ = pal[d[px + sy * row + x]]
            m = (d[mask + sy * mrow + x // 8] >> (7 - x % 8)) & 1
            line.append((r, g, b, 0 if m else 255))
        out.append(line)
    return out


def png(path, img):
    h, w = len(img), len(img[0])
    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in r) for r in img)
    ch = lambda t, x: struct.pack('>I', len(x)) + t + x + struct.pack('>I', zlib.crc32(t + x) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


small = decode(os.path.join(SRC, '3_7.bin'))
big = decode(os.path.join(SRC, '3_4.bin'))
png(os.path.join(OUT, 'status-activesync.png'), small)
png(os.path.join(OUT, 'status-activesync@2x.png'), big)
png(os.path.join(OUT, 'status-activesync@4x.png'), [[p for p in r for _ in (0, 1)] for r in big for _ in (0, 1)])
print('wrote status-activesync (16 / 32 / 64)')
