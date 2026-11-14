#!/usr/bin/env python3
# Usage: python3 scripts/extract-wm-battery-low-icon.py [wm61 shellres.192.dll dump] [wm65 shellres.192.dll dump] [public/static_images]
# The low battery notification's title-bar glyph from the ROMs (Yozora #829): shellres.192.dll
# group 5078 (5079 is the same picture), the round cell with "+" and "!" that WM's "Main Battery
# low" / "very low" notifications show (the battery stage icons are 5076-5089 beside it).
# 6.1: a 24 bpp icon with a 1-bit mask (pure white) -> wm61/status-battery-low.
# 6.5: a 32 bpp icon with alpha -> wm65/status-battery-low (wmShell ART65).
# 2x = the 32 px icon; 1x = 2x2 box-averaged alpha; 4x = point upscale (wmShell HD_ART lists it).
import os, struct, sys, zlib

SRC61 = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/wm61/dump/res/shellres.192.dll')
SRC65 = os.path.expanduser(sys.argv[2] if len(sys.argv) > 2 else '~/.cache/wm65/dump/res/shellres.192.dll')
OUT = sys.argv[3] if len(sys.argv) > 3 else 'public/static_images'
GROUP = 5078
NAME = 'status-battery-low'


def icon_id(src, group):
    d = open(os.path.join(src, f'14_{group}.bin'), 'rb').read()
    _r, _t, n = struct.unpack_from('<HHH', d, 0)
    for i in range(n):
        w, _h, _c, _x, _pl, _bpp, _sz, iid = struct.unpack_from('<BBBBHHIH', d, 6 + i * 14)
        if (w or 256) == 32:
            return iid
    raise SystemExit('no 32 px image')


def decode(src, iid):
    d = open(os.path.join(src, f'3_{iid}.bin'), 'rb').read()
    hs, w, h2, _pl, bpp = struct.unpack_from('<IiiHH', d, 0)
    assert w == 32 and bpp in (24, 32), (w, bpp)
    h = h2 // 2
    row = ((w * bpp + 31) // 32) * 4
    mrow = ((w + 31) // 32) * 4
    mask = hs + row * h
    out = []
    for y in range(h):
        sy = h - 1 - y
        line = []
        for x in range(w):
            o = hs + sy * row + x * (bpp // 8)
            if bpp == 32:
                b, g, r, a = d[o:o + 4]
            else:
                b, g, r = d[o:o + 3]
                a = 0 if (d[mask + sy * mrow + x // 8] >> (7 - x % 8)) & 1 else 255
            line.append((r, g, b, a))
        out.append(line)
    return out


def png(path, img):
    h, w = len(img), len(img[0])
    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in r) for r in img)
    ch = lambda t, x: struct.pack('>I', len(x)) + t + x + struct.pack('>I', zlib.crc32(t + x) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


for src, sub in ((SRC61, 'wm61'), (SRC65, 'wm65')):
    big = decode(src, icon_id(src, GROUP))
    small = []
    for y in range(16):
        line = []
        for x in range(16):
            px = [big[2 * y + j][2 * x + i] for i in (0, 1) for j in (0, 1)]
            line.append((255, 255, 255, sum(p[3] for p in px) // 4))
        small.append(line)
    d = os.path.join(OUT, sub)
    png(os.path.join(d, f'{NAME}@2x.png'), big)
    png(os.path.join(d, f'{NAME}.png'), small)
    png(os.path.join(d, f'{NAME}@4x.png'), [[p for p in r for _ in (0, 1)] for r in big for _ in (0, 1)])
    print(f'wrote {sub}/{NAME} from shellres.192.dll group {GROUP}')
