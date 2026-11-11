#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-data-icons.py public/static_images/wm61 public/static_images/wm61
# WM 6.1-style data-type status icons (Melaton-drawn): letters as 2 px holes in the ROM's 3G box,
# 1 px left / 2 px top-right-bottom border, 12-row glyphs; active = + the ROM data arrows (ico_4776,
# taken from status-data-4g-active@2x minus status-data-4g@2x). 2x drawn; 1x box-downscaled; 4x point-upscaled.
import struct, zlib, subprocess, sys, os
WM = sys.argv[1]; OUT = sys.argv[2]
def rgba(path):
    return subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], capture_output=True, check=True).stdout
def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[(y * w) * 4:(y * w + w) * 4]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
G = {  # 1 = hole (letter stroke), rows 0..11
 'L': ['110000']*10 + ['111111']*2,
 'T': ['11111111']*2 + ['00011000']*10,
 'E': ['111111']*2 + ['110000']*3 + ['111110']*2 + ['110000']*3 + ['111111']*2,
 'N': ['1100011','1100011','1110011','1110011','1111011','1111011','1101111','1101111','1100111','1100111','1100011','1100011'],
 'R': ['111110','111111','110011','110011','110011','111111','111110','110110','110111','110011','110011','110011'],
 'U': ['110011']*10 + ['111111', '011110'],
 'W': ['11000011']*4 + ['11011011']*6 + ['11111111', '01100110'],
 'B': ['111110','111111','110011','110011','111111','111110','111111','110011','110011','110011','111111','111110'],
}
SUP_A = ['011110', '110011', '110011', '111111', '110011', '110011', '110011']  # white, outside the box (as 5G+'s plus)
base = rgba(os.path.join(WM, 'status-data-4g@2x.png')); act = rgba(os.path.join(WM, 'status-data-4g-active@2x.png'))
arrows = [i for i in range(32 * 32) if act[i*4+3] > 127 and base[i*4+3] <= 127]
def box_width(label):
    return 1 + sum(len(G[c][0]) for c in label) + (len(label) - 1) + 2
def canvas(label):
    # wider than square when the box is (Yukimi): the arrows keep their gap right of the box
    return 32 + max(0, box_width(label) - 17)
def draw(label, sup=None, active=False):
    W = canvas(label)
    px = bytearray(W * 32 * 4)
    def put(x, y, on):
        if 0 <= x < W and 0 <= y < 32:
            px[(y*W+x)*4:(y*W+x)*4+4] = bytes([255, 255, 255, 255]) if on else bytes(4)
    w = box_width(label)
    if active:
        for i in arrows: put(i % 32 + (W - 32), i // 32, True)
    for y in range(16):
        for x in range(w): put(x, y, True)
    x0 = 1
    for c in label:
        for r, row in enumerate(G[c]):
            for dx, b in enumerate(row):
                if b == '1': put(x0 + dx, 2 + r, False)
        x0 += len(G[c][0]) + 1
    if sup:
        for r, row in enumerate(sup):
            for dx, b in enumerate(row):
                if b == '1': put(w + 1 + dx, r, True)
    return px
def save(name, px2, W):
    png(os.path.join(OUT, f'{name}@2x.png'), W, 32, px2)
    w1 = W // 2
    px1 = bytearray(w1 * 16 * 4)
    for y in range(16):
        for x in range(w1):
            q = [(2*y+dy)*W + 2*x+dx for dy in (0, 1) for dx in (0, 1)]
            a = sum(px2[i*4+3] for i in q)
            px1[(y*w1+x)*4:(y*w1+x)*4+4] = bytes([255, 255, 255, a // 4]) if a else bytes(4)
    png(os.path.join(OUT, f'{name}.png'), w1, 16, px1)
    w4 = W * 2
    px4 = bytearray(w4 * 64 * 4)
    for y in range(64):
        for x in range(w4):
            i = (y//2)*W + x//2
            px4[(y*w4+x)*4:(y*w4+x)*4+4] = px2[i*4:i*4+4]
    png(os.path.join(OUT, f'{name}@4x.png'), w4, 64, px4)
for name, label, sup in [('nr', 'NR', None), ('nr-a', 'NR', SUP_A), ('uwb', 'UWB', None)]:
    W = canvas(label)
    save(f'status-data-{name}', draw(label, sup), W)
    save(f'status-data-{name}-active', draw(label, sup, True), W)
    print(name, W)
print('ok')
