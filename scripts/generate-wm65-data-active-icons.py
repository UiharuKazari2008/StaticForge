#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm65-data-active-icons.py public/static_images/wm65
# WM 6.5 "connected" data icons: the type badge with the ROM's left / right data arrows under it.
# The 6.5 ROM (shellres.192) builds every one the same way: G 4762 + arrows = 4776, E 4787 -> 4801,
# 3G 4838 -> 4852 (pixel-exact). status-data-g-active@2x.png is ROM ico 4776 itself; the arrows are
# taken from it (minus status-data-g@2x.png) and put on every other badge, at the right edge for a
# wider badge (as generate-wm-data-icons.py does for 6.1). ico 4763-4775 are the turning-arrow
# connecting frames (status-data-<type>-sync-NN), never the connected icon.
# 2x drawn; 1x box-downscaled; 4x point-upscaled. Needs ImageMagick (convert).
import struct, zlib, subprocess, sys, os
WM = sys.argv[1]
def rgba(path):
    w, h = map(int, subprocess.run(['identify', '-format', '%w %h', path], capture_output=True, check=True, text=True).stdout.split())
    return w, h, bytearray(subprocess.run(['convert', path, '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout)
def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[(y * w) * 4:(y * w + w) * 4]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
_, _, gb = rgba(os.path.join(WM, 'status-data-g@2x.png'))
_, _, ga = rgba(os.path.join(WM, 'status-data-g-active@2x.png'))
arrows = {i: bytes(ga[i*4:i*4+4]) for i in range(32 * 32) if ga[i*4:i*4+4] != gb[i*4:i*4+4]}
assert 100 < len(arrows) < 200, f'status-data-g-active@2x.png is not ROM ico 4776 ({len(arrows)} px differ)'
def save(name, W, px2):
    png(os.path.join(WM, f'{name}@2x.png'), W, 32, px2)
    w1 = W // 2
    px1 = bytearray(w1 * 16 * 4)
    for y in range(16):
        for x in range(w1):
            q = [(2*y+dy)*W + 2*x+dx for dy in (0, 1) for dx in (0, 1)]
            a = sum(px2[i*4+3] for i in q)
            if a:
                px1[(y*w1+x)*4:(y*w1+x)*4+4] = bytes([sum(px2[i*4+c] * px2[i*4+3] for i in q) // a for c in range(3)] + [a // 4])
    png(os.path.join(WM, f'{name}.png'), w1, 16, px1)
    w4 = W * 2
    px4 = bytearray(w4 * 64 * 4)
    for y in range(64):
        for x in range(w4):
            i = (y//2)*W + x//2
            px4[(y*w4+x)*4:(y*w4+x)*4+4] = px2[i*4:i*4+4]
    png(os.path.join(WM, f'{name}@4x.png'), w4, 64, px4)
for t in ['g', 'e', '3g', 'h', 'h-plus', '4g', '4g-plus', '5g', '5g-plus', 'nr', 'nr-a', 'uwb']:
    W, H, px = rgba(os.path.join(WM, f'status-data-{t}@2x.png'))
    assert H == 32
    for i, v in arrows.items():
        x, y = i % 32 + (W - 32), i // 32
        px[(y*W+x)*4:(y*W+x)*4+4] = v
    save(f'status-data-{t}-active', W, px)
    print(t, W)
print('ok')
