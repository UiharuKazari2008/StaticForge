#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-data-avail-icons.py <tapres.192.dll resource dump> public/static_images/wm61|wm65
# The large data badges (status-data-<type>-avail): what the shell shows when a network type is
# there but no data call is up (6.1 / 6.5 shell32's table keyed by Cellular System Available ->
# tapres.192.dll icons). G 22208, E 22214, 3G 22216 and H 22218 are the ROM's own; the rest are
# drawn in the version's style:
#   6.1: 1-bit, a 28 px box (2..29) with the letters cut out, 13-row glyphs in 2 px strokes on the
#        ROM's own "3G" rows (9..21); 3 and G are the ROM's, the others drawn to match.
#   6.5: Segoe UI Bold at 24 pt condensed to 70 % in the ROM's rounded box (fitted to its 3G: 15 of
#        1,024 pixels off); the boxless "+" style of its own 3G+ (22220) at 23 pt / 75 %.
#   Boxed like the ROM's; the "+" or NR-A's A sits outside the box at its top right, as on the small
#   badges, the box narrower to make room (Yukimi, Nov 12 2026); UWB (full lettering on the large badge, Yukimi) boxless (white letters, as 6.5
#   draws its 3G+).
# 2x drawn; 4x point-upscaled; 1x box-downscaled. Needs ImageMagick; 6.5 needs the Segoe UI Bold
# font file (SEGOE_BOLD, default ~/.local/share/fonts/segoeuib.ttf).
import struct, zlib, subprocess, sys, os, tempfile
RES, WM = sys.argv[1], sys.argv[2]
V65 = WM.rstrip('/').endswith('wm65')
FONT = os.environ.get('SEGOE_BOLD', os.path.expanduser('~/.local/share/fonts/segoeuib.ttf'))
def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[(y * w) * 4:(y * w + w) * 4]) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
def rom(gid):
    g = open(os.path.join(RES, f'14_{gid}.bin'), 'rb').read(); n = struct.unpack('<HHH', g[:6])[2]
    ents = []; datas = []
    for i in range(n):
        w, h, c, r, pl, bc, sz, iid = struct.unpack('<BBBBHHIH', g[6 + i * 14:20 + i * 14])
        d = open(os.path.join(RES, f'3_{iid}.bin'), 'rb').read(); ents.append((w, h, c, r, pl, bc)); datas.append(d)
    off = 6 + 16 * n; hdr = struct.pack('<HHH', 0, 1, n); body = b''
    for (w, h, c, r, pl, bc), d in zip(ents, datas):
        hdr += struct.pack('<BBBBHHII', w, h, c, r, pl, bc, len(d), off); off += len(d); body += d
    with tempfile.NamedTemporaryFile(suffix='.ico', delete=False) as f: f.write(hdr + body); p = f.name
    try: px = bytearray(subprocess.run(['convert', p + '[0]', '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout)
    finally: os.unlink(p)
    assert len(px) == 32 * 32 * 4, gid
    for i in range(0, len(px), 4):
        if px[i + 3] == 0: px[i:i + 4] = b'\0\0\0\0'
    return px
def save(name, px):
    p = os.path.join(WM, name)
    png(f'{p}@2x.png', 32, 32, px)
    png(f'{p}@4x.png', 64, 64, bytearray(b''.join(bytes(px[((y // 2) * 32 + x // 2) * 4:((y // 2) * 32 + x // 2) * 4 + 4]) for y in range(64) for x in range(64))))
    p1 = bytearray(16 * 16 * 4)
    for y in range(16):
        for x in range(16):
            q = [(2*y+dy)*32 + 2*x+dx for dy in (0, 1) for dx in (0, 1)]
            a = sum(px[i*4+3] for i in q)
            if a: p1[(y*16+x)*4:(y*16+x)*4+4] = bytes([sum(px[i*4+c] * px[i*4+3] for i in q) // a for c in range(3)] + [a // 4])
    png(f'{p}.png', 16, 16, p1)
ROMSET = {'g': 22208, 'e': 22214, '3g': 22216, 'h': 22218}
# label, boxless, superscript
DRAWN = {'h-plus': ('H', False, '+'), '4g': ('4G', False, None), '4g-plus': ('4G', False, '+'), '5g': ('5G', False, None),
         '5g-plus': ('5G', False, '+'), 'nr': ('NR', False, None), 'nr-a': ('NR', False, 'A'), 'uw': ('UWB', True, None),
         # Settings > Connections > Cellular (#771): LTE in place of 4G, 5G UW / NR UW with U and W stacked
         'lte': ('LTE', False, None), 'lte-plus': ('LTE', False, '+'), '5g-uw': ('5G', False, 'UW'), 'nr-uw': ('NR', False, 'UW')}
# ---- 6.1 glyphs: 13 rows, 2 px strokes ('#' = letter); 3 and G from tapres 22216
G61 = {
 '3': ['.#####..', '########', '#.....##', '......##', '.....##.', '...###..', '...####.', '......##', '......##', '......##', '#....###', '#######.', '.#####..'],
 'G': ['...######.', '..########', '.###.....#', '.##.......', '##........', '##........', '##....####', '##....####', '##......##', '###.....##', '.###....##', '..########', '...#####..'],
 '4': ['.....##..', '....###..', '...####..', '..##.##..', '.##..##..', '##...##..', '#########', '#########', '.....##..', '.....##..', '.....##..', '.....##..', '.....##..'],
 'L': ['##....'] * 11 + ['######'] * 2,
 'T': ['########'] * 2 + ['...##...'] * 11,
 'E': ['######', '######', '##....', '##....', '##....', '#####.', '#####.', '##....', '##....', '##....', '##....', '######', '######'],
 'B': ['#######.', '########', '##....##', '##....##', '##...##.', '#######.', '########', '##....##', '##....##', '##....##', '##...###', '########', '#######.'],
 '5': ['.#######', '.#######', '.##.....', '.##.....', '.######.', '.#######', '......##', '......##', '......##', '......##', '#....###', '#######.', '.#####..'],
 'N': ['##.....##', '###....##', '####...##', '##.#...##', '##.##..##', '##..#..##', '##..##.##', '##...#.##', '##...####', '##....###', '##....###', '##.....##', '##.....##'],
 'R': ['#######..', '########.', '##....###', '##.....##', '##.....##', '##....###', '########.', '#######..', '##...##..', '##....##.', '##....##.', '##.....##', '##.....##'],
 'U': ['##.....##'] * 10 + ['###...###', '.#######.', '..#####..'],
 'W': ['##........##', '##........##', '##........##', '##...##...##', '##...##...##', '##..####..##', '##..####..##', '##..#..#..##', '##.##..##.##', '####....####', '###......###', '###......###', '##........##'],
 'H': ['##.....##'] * 6 + ['#########', '#########'] + ['##.....##'] * 5,
 '+': ['......', '......', '......', '..##..', '..##..', '######', '######', '..##..', '..##..', '......', '......', '......', '......'],
}
SUP61 = {'+': ['..###..', '..###..', '#######', '#######', '#######', '..###..', '..###..'],
         'A': ['..###..', '.#####.', '###.###', '##...##', '#######', '#######', '##...##', '##...##'],
         # stacked U over W, right of the box
         'UW': (['##..##'] * 6 + ['######', '.####.'], ['##....##'] * 3 + ['##.##.##'] * 3 + ['########', '.##..##.'])}
def draw61(label, boxless, sup):
    glyphs = [G61[c] for c in label]
    sg = SUP61[sup] if sup else None
    # the box: 2..29, or 0..23 with the mark outside it at the top right
    bx0, bx1 = (0, 22) if sg else (2, 29)
    gap = 1 if len(glyphs) > 2 else 2  # (LTE's glyphs are narrow enough for the marked box)
    if boxless: bx0, bx1 = 0, 31
    width = sum(len(g[0]) for g in glyphs) + gap * (len(glyphs) - 1)
    x = bx0 + (bx1 - bx0 + 1 - width + 1) // 2
    on = [[False] * 32 for _ in range(32)]
    for g in glyphs:
        for r, row in enumerate(g):
            for dx, c in enumerate(row):
                if c == '#': on[9 + r][x + dx] = True
        x += len(g[0]) + gap
    px = bytearray(32 * 32 * 4)
    for y in range(32):
        for xx in range(32):
            inbox = bx0 <= xx <= bx1 and 2 <= y <= 29
            lit = on[y][xx] if boxless else (inbox and not on[y][xx])
            if lit: px[(y*32+xx)*4:(y*32+xx)*4+4] = b'\xff\xff\xff\xff'
    marks = [(sg[0], 2), (sg[1], 12)] if sup == 'UW' else [(sg, 2)] if sg else []
    for g, top in marks:
        sx0 = 31 - len(g[0])
        for r, row in enumerate(g):
            for dx, c in enumerate(row):
                if c == '#': px[((top + r)*32 + sx0 + dx)*4:((top + r)*32 + sx0 + dx)*4 + 4] = b'\xff\xff\xff\xff'
    return px
# ---- 6.5: Segoe UI Bold, 8x supersampled
def text_mask(text, pt, sx, dx, dy, w=32, stroke=0):
    # drawn on a wide canvas (nothing clipped before it is condensed), then the middle 32 px kept
    S, W = 8, 96
    cmd = ['convert', '-size', f'{W*S}x{32*S}', 'xc:black', '-font', FONT, '-pointsize', str(pt * S), '-fill', 'white', '-kerning', '0',
           *(['-stroke', 'white', '-strokewidth', str(stroke * S)] if stroke else []),
           '-gravity', 'center', '-annotate', '+0' + f'{dy*S:+.0f}', text,
           '-distort', 'ScaleRotateTranslate', f'{W*S/2},{16*S} {sx},1 0 {W*S/2 + dx*S},{16*S}',
           '-gravity', 'center', '-crop', f'{w*S}x{32*S}+0+0', '+repage', '-filter', 'box', '-resize', f'{w}x32!', '-depth', '8', 'gray:-']
    return [v / 255 for v in subprocess.run(cmd, capture_output=True, check=True).stdout]
def cols(m, w=32):
    used = [x for x in range(w) if any(m[y*w+x] > 0.15 for y in range(32))]
    return (used[0], used[-1]) if used else (0, w - 1)
def fit(text, pt, sx, dx, dy, lo, hi, stroke=0):
    # condense until the letters span no more than columns lo..hi (measured on a 64 px wide render,
    # so nothing is clipped), then centre them there
    while True:
        a, b = cols(text_mask(text, pt, sx, dx, dy, 64, stroke), 64)
        if b - a <= hi - lo or sx < 0.45: break
        sx -= 0.02
    shift = (lo + hi) / 2 - ((a + b) / 2 - 16)
    return text_mask(text, pt, sx, dx + shift, dy, 32, stroke)
def box65(x0, x1, corner):
    bx = [1.0 if x0 <= i % 32 <= x1 and 3 <= i // 32 <= 28 else 0.0 for i in range(1024)]
    for (x, y) in ((x0, 3), (x1, 3), (x0, 28), (x1, 28)): bx[y*32+x] = corner
    return bx
def draw65(label, boxless, sup, box):
    if boxless:
        m = fit(label, 23, 0.75, 0, -1.5, 0, 31)
        px = bytearray(32 * 32 * 4)
        for i, a in enumerate(m):
            if a > 0.02: px[i*4:i*4+4] = bytes([255, 255, 255, round(a * 255)])
        return px
    if sup:
        # a narrower box (0..23) and the mark outside it, top right
        bx = box65(0, 22, box[3*32+3])
        m = fit(label, 24, 0.7, 0, -1.5, 2, 20)
        # the mark heavier than the letters' size alone gives (Yukimi): larger and stroked
        # the A as squat as the + (Yukimi): smaller, widened, the same weight
        if sup == 'UW':
            u = fit('U', 11.5, 1.2, 0, -8.5, 24, 31, stroke=1.0); w = fit('W', 11.5, 0.95, 0, 1.5, 24, 31, stroke=1.0)
            mk = [max(a, b) for a, b in zip(u, w)]
        else:
            mk = fit(sup, 16, 0.95, 0, -9, 24, 31, stroke=0.9) if sup == '+' else fit(sup, 11.5, 1.45, 0, -7.5, 24, 31, stroke=1.0)
    else:
        bx, mk = box, None
        m = fit(label, 24, 0.7, 0, -1.5, 6, 25)
    px = bytearray(32 * 32 * 4)
    for i, (b, a) in enumerate(zip(bx, m)):
        v = b * (1 - a)
        if mk: v = max(v, mk[i] if not bx[i] else 0)
        if v > 0.02: px[i*4:i*4+4] = bytes([255, 255, 255, round(v * 255)])
    return px
box = None
if V65:
    h = rom(22216)
    box = box65(3, 28, h[(3*32+3)*4+3] / 255)
for t, gid in ROMSET.items(): save(f'status-data-{t}-avail', rom(gid))
for t, (label, boxless, sup) in DRAWN.items():
    save(f'status-data-{t}-avail', draw65(label, boxless, sup, box) if V65 else draw61(label, boxless, sup))
print('ok')
