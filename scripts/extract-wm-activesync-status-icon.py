#!/usr/bin/env python3
# Usage: python3 scripts/extract-wm-activesync-status-icon.py ~/.cache/wm65/dump/res/shellres.192.dll public/static_images/wm61
# ActiveSync's title-bar glyph from the ROM (Yozora #803): the 6.5 VGA title-bar icons are
# shellres.192.dll's 32 px icons (as the other status art, wm65.css); 4684 is the plain connection
# arrows, 4685 the sync arrows ActiveSync's notifications use. 32 bpp white with alpha.
# 2x = the 32 px icon; 1x = 2x2 box-averaged; 4x = point upscale (wmShell HD_ART lists it).
import os, struct, sys, zlib

SRC = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else '~/.cache/wm65/dump/res/shellres.192.dll')
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/static_images/wm61'
GROUP = 4685


def icon_id(group):
    d = open(os.path.join(SRC, f'14_{group}.bin'), 'rb').read()
    _r, _t, n = struct.unpack_from('<HHH', d, 0)
    for i in range(n):
        w, _h, _c, _x, _pl, bpp, _sz, iid = struct.unpack_from('<BBBBHHIH', d, 6 + i * 14)
        if (w or 256) == 32:
            return iid
    raise SystemExit('no 32 px image')


def decode(iid):
    d = open(os.path.join(SRC, f'3_{iid}.bin'), 'rb').read()
    hs, w, h2, _pl, bpp = struct.unpack_from('<IiiHH', d, 0)
    assert bpp == 32 and w == 32, (bpp, w)
    h = h2 // 2
    out = []
    for y in range(h):
        sy = h - 1 - y
        line = []
        for x in range(w):
            b, g, r, a = d[hs + (sy * w + x) * 4: hs + (sy * w + x) * 4 + 4]
            line.append((r, g, b, a))
        out.append(line)
    return out


def png(path, img):
    h, w = len(img), len(img[0])
    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in r) for r in img)
    ch = lambda t, x: struct.pack('>I', len(x)) + t + x + struct.pack('>I', zlib.crc32(t + x) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))


big = decode(icon_id(GROUP))
small = []
for y in range(16):
    line = []
    for x in range(16):
        px = [big[2 * y + j][2 * x + i] for i in (0, 1) for j in (0, 1)]
        a = sum(p[3] for p in px) // 4
        line.append((255, 255, 255, a))
    small.append(line)
png(os.path.join(OUT, 'status-activesync@2x.png'), big)
png(os.path.join(OUT, 'status-activesync.png'), small)
png(os.path.join(OUT, 'status-activesync@4x.png'), [[p for p in r for _ in (0, 1)] for r in big for _ in (0, 1)])
print(f'wrote status-activesync from shellres.192.dll group {GROUP}')
