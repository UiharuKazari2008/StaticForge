#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-data-sync-frames.py public/static_images/wm61 uw [nr ...]
# A mobile network type's connecting frames (#760, wmShell syncKind 'data-<type>'): the type's
# badge (status-data-<type>@2x) with the ROM's turning arrows under it, frame by frame. The arrows
# are taken from the G frames (status-data-g-sync-NN@2x minus status-data-g@2x: the ROM's own,
# shellres.192 4763-4775) and moved right by as much as the badge is wider than 32 px (where the
# connected icon puts its arrows). 2x drawn; 4x point-upscaled; 1x box-downscaled where the folder
# has 1x frames (6.1; 6.5's are 2x / 4x only). Then rerun scripts/build-wm-sprite-strips.sh.
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
frames = []
for k in range(13):
    _, _, gf = rgba(os.path.join(WM, f'status-data-g-sync-{k:02d}@2x.png'))
    frames.append({i: bytes(gf[i*4:i*4+4]) for i in range(32 * 32) if gf[i*4+3] and gf[i*4:i*4+4] != gb[i*4:i*4+4]})
one_x = os.path.exists(os.path.join(WM, 'status-data-g-sync-00.png'))
for t in sys.argv[2:]:
    W, H, badge = rgba(os.path.join(WM, f'status-data-{t}@2x.png'))
    for k, arrows in enumerate(frames):
        px = bytearray(badge)
        for i, v in arrows.items():
            x, y = i % 32 + (W - 32), i // 32
            px[(y*W+x)*4:(y*W+x)*4+4] = v
        name = os.path.join(WM, f'status-data-{t}-sync-{k:02d}')
        png(f'{name}@2x.png', W, 32, px)
        png(f'{name}@4x.png', W * 2, 64, bytearray(b''.join(bytes(px[((y // 2) * W + x // 2) * 4:((y // 2) * W + x // 2) * 4 + 4]) for y in range(64) for x in range(W * 2))))
        if one_x:
            w1 = W // 2
            p1 = bytearray(w1 * 16 * 4)
            for y in range(16):
                for x in range(w1):
                    q = [(2*y+dy)*W + 2*x+dx for dy in (0, 1) for dx in (0, 1)]
                    a = sum(px[i*4+3] for i in q)
                    if a: p1[(y*w1+x)*4:(y*w1+x)*4+4] = bytes([sum(px[i*4+c] * px[i*4+3] for i in q) // a for c in range(3)] + [a // 4])
            png(f'{name}.png', w1, 16, p1)
    print(t, W)
print('ok')
