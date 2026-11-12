#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-data-anim-frames.py <shellres.192.dll resource dump> public/static_images/wm61|wm65 [type ...]
# The frames of the shell's data icon sequence A (shell32's table: connected, arrows run out, badge,
# arrows run back in, connected; Melaton plays it while connecting) and the first frames of its
# sequence B that the repo lacked, from the ROM's own shellres.192 icons (the dump holds 14_<id>.bin
# group icons and 3_<n>.bin images, ~/.cache/wm6x/dump/res/shellres.192.dll):
#   status-data-anim-00..17   4744-4761   plain data arrows, sequence A
#   status-wifi-anim-00..09   4712-4721   Wi-Fi, sequence A
#   status-data-turn          4685        plain data, sequence B's first frame
#   status-wifi-turn          4678        Wi-Fi, sequence B's first frame
#   status-data-<type>-anim-00..09        each type's badge with the G frames' arrows (4777-4786
#                                         minus G 4762), moved right by the badge's extra width
#                                         (for G, E and 3G this is the ROM's own 4777 / 4802 / 4853 set)
# 2x = the ROM frame (32 x 32); 4x point-upscaled; 1x box-downscaled where the folder keeps 1x
# frames (6.1). Then rerun scripts/build-wm-sprite-strips.sh.
import struct, zlib, subprocess, sys, os, tempfile
RES, WM = sys.argv[1], sys.argv[2]
ONE_X = os.path.exists(os.path.join(WM, 'status-data-sync-00.png'))
def rgba(path):
    w, h = map(int, subprocess.run(['identify', '-format', '%w %h', path], capture_output=True, check=True, text=True).stdout.split()[:2])
    return w, h, bytearray(subprocess.run(['convert', path, '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout)
def rom(gid):
    g = open(os.path.join(RES, f'14_{gid}.bin'), 'rb').read(); n = struct.unpack('<HHH', g[:6])[2]
    ents = []; datas = []
    for i in range(n):
        w, h, c, r, pl, bc, sz, iid = struct.unpack('<BBBBHHIH', g[6 + i * 14:20 + i * 14])
        d = open(os.path.join(RES, f'3_{iid}.bin'), 'rb').read(); ents.append((w, h, c, r, pl, bc, len(d))); datas.append(d)
    off = 6 + 16 * n; hdr = struct.pack('<HHH', 0, 1, n); body = b''
    for (w, h, c, r, pl, bc, sz), d in zip(ents, datas):
        hdr += struct.pack('<BBBBHHII', w, h, c, r, pl, bc, sz, off); off += sz; body += d
    with tempfile.NamedTemporaryFile(suffix='.ico', delete=False) as f: f.write(hdr + body); p = f.name
    try:
        w, h, px = rgba(p + '[0]')
    finally: os.unlink(p)
    assert (w, h) == (32, 32), (gid, w, h)
    for i in range(0, len(px), 4):  # clear the colour of transparent pixels
        if px[i + 3] == 0: px[i:i + 4] = b'\0\0\0\0'
    return px
def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[(y * w) * 4:(y * w + w) * 4]) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
def save(name, W, px):
    p = os.path.join(WM, name)
    png(f'{p}@2x.png', W, 32, px)
    png(f'{p}@4x.png', W * 2, 64, bytearray(b''.join(bytes(px[((y // 2) * W + x // 2) * 4:((y // 2) * W + x // 2) * 4 + 4]) for y in range(64) for x in range(W * 2))))
    if ONE_X:
        w1 = W // 2; p1 = bytearray(w1 * 16 * 4)
        for y in range(16):
            for x in range(w1):
                q = [(2*y+dy)*W + 2*x+dx for dy in (0, 1) for dx in (0, 1)]
                a = sum(px[i*4+3] for i in q)
                if a: p1[(y*w1+x)*4:(y*w1+x)*4+4] = bytes([sum(px[i*4+c] * px[i*4+3] for i in q) // a for c in range(3)] + [a // 4])
        png(f'{p}.png', w1, 16, p1)
for k in range(18): save(f'status-data-anim-{k:02d}', 32, rom(4744 + k))
for k in range(10): save(f'status-wifi-anim-{k:02d}', 32, rom(4712 + k))
save('status-data-turn', 32, rom(4685))
save('status-wifi-turn', 32, rom(4678))
g = rom(4762)
arrows = []
for k in range(10):
    f = rom(4777 + k)
    arrows.append({i: bytes(f[i*4:i*4+4]) for i in range(1024) if f[i*4+3] and f[i*4:i*4+4] != g[i*4:i*4+4]})
TYPES = sys.argv[3:] or ['g', 'e', '3g', 'h', 'h-plus', '4g', '4g-plus', '5g', '5g-plus', 'nr', 'nr-a', 'uw', 'lte', 'lte-plus', '5g-uw', 'nr-uw']
for t in TYPES:
    W, H, badge = rgba(os.path.join(WM, f'status-data-{t}@2x.png'))
    for i in range(0, len(badge), 4):
        if badge[i + 3] == 0: badge[i:i + 4] = b'\0\0\0\0'
    for k, a in enumerate(arrows):
        px = bytearray(badge)
        for i, v in a.items():
            x, y = i % 32 + (W - 32), i // 32
            px[(y*W+x)*4:(y*W+x)*4+4] = v
        save(f'status-data-{t}-anim-{k:02d}', W, px)
print('ok')
