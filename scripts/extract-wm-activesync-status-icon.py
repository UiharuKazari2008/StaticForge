#!/usr/bin/env python3
# Usage: python3 scripts/extract-wm-activesync-status-icon.py ~/.cache/wm65/dump/res/syncres.dll public/static_images/wm61
# ActiveSync's own title-bar glyph from the ROM (Yozora #803): syncres.dll icon group 124, 1-bit white
# (palette 0 black / 1 white, AND mask = transparent), RT_ICON 46 = 16 px, 47 = 32 px. 1x = 16 px,
# 2x = 32 px, 4x = the 32 px point-upscaled (wmShell HD_ART lists it).
import os, struct, sys, zlib

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/wm65/dump/res/syncres.dll')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/static_images/wm61'


def decode(path):
    d = open(path, 'rb').read()
    hs, w, h2, _pl, bpp = struct.unpack_from('<IiiHH', d, 0)
    assert bpp == 1, bpp
    h = h2 // 2
    pal = [d[hs:hs + 4], d[hs + 4:hs + 8]]
    px = hs + 8
    row = ((w + 31) // 32) * 4
    mask = px + row * h
    out = []
    for y in range(h):
        sy = h - 1 - y
        line = []
        for x in range(w):
            v = (d[px + sy * row + x // 8] >> (7 - x % 8)) & 1
            m = (d[mask + sy * row + x // 8] >> (7 - x % 8)) & 1
            b, g, r, _ = pal[v]
            line.append((r, g, b, 0 if m else 255))
        out.append(line)
    return out


def png(path, img):
    h, w = len(img), len(img[0])
    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in r) for r in img)
    ch = lambda t, x: struct.pack('>I', len(x)) + t + x + struct.pack('>I', zlib.crc32(t + x) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


small = decode(os.path.join(SRC, '3_46.bin'))
big = decode(os.path.join(SRC, '3_47.bin'))
png(os.path.join(OUT, 'status-activesync.png'), small)
png(os.path.join(OUT, 'status-activesync@2x.png'), big)
png(os.path.join(OUT, 'status-activesync@4x.png'), [[p for p in r for _ in (0, 1)] for r in big for _ in (0, 1)])
print('wrote status-activesync from syncres.dll group 124 (16 / 32 / 64)')
