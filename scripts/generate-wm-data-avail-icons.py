#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-data-avail-icons.py <tapres.192.dll resource dump> public/static_images/wm61|wm65
# The large data badges (status-data-<type>-avail): what the shell shows when a network type is
# there but no data call is up (6.1 / 6.5 shell32's table keyed by Cellular System Available ->
# tapres.192.dll icons; #771). G 22208, E 22214, 3G 22216 and H 22218 are the ROM's own; the rest
# are drawn in the version's style:
#   6.1: 1-bit, the ROM's 28 px box (2..29) with the letters cut out, 13-row glyphs in 2 px strokes
#        on the ROM's own "3G" rows (9..21); 3 and G are the ROM's, the others drawn to match.
#   6.5: Segoe UI Bold condensed in the ROM's rounded box (3..28; fitted to the ROM's 3G), each
#        label nudged by sub-pixel steps until its stems sit on whole pixels and its edges sharpened,
#        so the letters are as crisp as the ROM's (anti-aliasing only where a curve needs it).
# A type with a mark (H+, 4G+, 5G+, LTE+, NR-A, 5G UW, NR UW) is its parent badge unchanged (Yukimi:
# the parent's styling) with the mark outside the box at its top right, on a 40 px canvas; UWB is
# boxless white letters (as 6.5 draws its 3G+), also 40 px. 2x drawn; 4x point-upscaled; 1x
# box-downscaled. Needs ImageMagick; 6.5 needs the Segoe UI Bold font file (SEGOE_BOLD, default
# ~/.local/share/fonts/segoeuib.ttf).
import struct, zlib, subprocess, sys, os, tempfile
RES, WM = sys.argv[1], sys.argv[2]
V65 = WM.rstrip('/').endswith('wm65')
FONT = os.environ.get('SEGOE_BOLD', os.path.expanduser('~/.local/share/fonts/segoeuib.ttf'))
WIDE = 40
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
    try: px = subprocess.run(['convert', p + '[0]', '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout
    finally: os.unlink(p)
    assert len(px) == 32 * 32 * 4, gid
    return [px[i * 4 + 3] for i in range(1024)]  # the art is white: alpha is all
def save(name, a, W):
    # a: alpha per pixel, W x 32
    px = bytearray(W * 32 * 4)
    for i, v in enumerate(a):
        if v: px[i*4:i*4+4] = bytes([255, 255, 255, v])
    p = os.path.join(WM, name)
    png(f'{p}@2x.png', W, 32, px)
    png(f'{p}@4x.png', W * 2, 64, bytearray(b''.join(bytes(px[((y // 2) * W + x // 2) * 4:((y // 2) * W + x // 2) * 4 + 4]) for y in range(64) for x in range(W * 2))))
    w1 = W // 2; p1 = bytearray(w1 * 16 * 4)
    for y in range(16):
        for x in range(w1):
            s = sum(a[(2*y+dy)*W + 2*x+dx] for dy in (0, 1) for dx in (0, 1))
            if s: p1[(y*w1+x)*4:(y*w1+x)*4+4] = bytes([255, 255, 255, s // 4])
    png(f'{p}.png', w1, 16, p1)
def widen(a, W=WIDE):
    out = [0] * (W * 32)
    for y in range(32):
        for x in range(32): out[y*W+x] = a[y*32+x]
    return out
ROMSET = {'G': 22208, 'E': 22214, '3G': 22216, 'H': 22218}
#        key        parent label  mark
TYPES = {'g': ('G', None), 'e': ('E', None), '3g': ('3G', None), 'h': ('H', None), 'h-plus': ('H', '+'),
         '4g': ('4G', None), '4g-plus': ('4G', '+'), '5g': ('5G', None), '5g-plus': ('5G', '+'),
         'nr': ('NR', None), 'nr-a': ('NR', 'A'), 'uw': ('UWB', 'boxless'),
         'lte': ('LTE', None), 'lte-plus': ('LTE', '+'), '5g-uw': ('5G', 'UW'), 'nr-uw': ('NR', 'UW')}
# ---- 6.1 glyphs: 13 rows, 2 px strokes ('#' = letter); 3 and G from tapres 22216
G61 = {
 '3': ['.#####..', '########', '#.....##', '......##', '.....##.', '...###..', '...####.', '......##', '......##', '......##', '#....###', '#######.', '.#####..'],
 'G': ['...######.', '..########', '.###.....#', '.##.......', '##........', '##........', '##....####', '##....####', '##......##', '###.....##', '.###....##', '..########', '...#####..'],
 '4': ['.....##..', '....###..', '...####..', '..##.##..', '.##..##..', '##...##..', '#########', '#########', '.....##..', '.....##..', '.....##..', '.....##..', '.....##..'],
 '5': ['.#######', '.#######', '.##.....', '.##.....', '.######.', '.#######', '......##', '......##', '......##', '......##', '#....###', '#######.', '.#####..'],
 'N': ['##.....##', '###....##', '####...##', '##.#...##', '##.##..##', '##..#..##', '##..##.##', '##...#.##', '##...####', '##....###', '##....###', '##.....##', '##.....##'],
 'R': ['#######..', '########.', '##....###', '##.....##', '##.....##', '##....###', '########.', '#######..', '##...##..', '##....##.', '##....##.', '##.....##', '##.....##'],
 'U': ['##.....##'] * 10 + ['###...###', '.#######.', '..#####..'],
 'W': ['##........##', '##........##', '##........##', '##...##...##', '##...##...##', '##..####..##', '##..####..##', '##..#..#..##', '##.##..##.##', '####....####', '###......###', '###......###', '##........##'],
 'B': ['#######.', '########', '##....##', '##....##', '##...##.', '#######.', '########', '##....##', '##....##', '##....##', '##...###', '########', '#######.'],
 'L': ['##....'] * 11 + ['######'] * 2,
 'T': ['########'] * 2 + ['...##...'] * 11,
 'E': ['######', '######', '##....', '##....', '##....', '#####.', '#####.', '##....', '##....', '##....', '##....', '######', '######'],
}
# marks, right of the box: a + with 2 px strokes and 3 px arms (it reads as a plus), the A, U over W
MARK61 = {'+': [('...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'), 2],
          'A': [('..###..', '.#####.', '###.###', '##...##', '#######', '#######', '##...##', '##...##'), 2],
          'U': [('##..##',) * 6 + ('######', '.####.'), 2],
          'W': [('##....##',) * 3 + ('##.##.##',) * 3 + ('########', '.##..##.'), 12]}
def glyph_row(label, gap):
    glyphs = [G61[c] for c in label]
    return glyphs, sum(len(g[0]) for g in glyphs) + gap * (len(glyphs) - 1)
def base61(label):
    if label in ROMSET: return rom(ROMSET[label])
    gap = 1 if len(label) > 2 else 2
    glyphs, width = glyph_row(label, gap)
    a = [0] * 1024
    for y in range(2, 30):
        for x in range(2, 30): a[y*32+x] = 255
    x = 2 + (28 - width + 1) // 2
    for g in glyphs:
        for r, row in enumerate(g):
            for dx, c in enumerate(row):
                if c == '#': a[(9 + r)*32 + x + dx] = 0
        x += len(g[0]) + gap
    return a
def boxless61(label):
    glyphs, width = glyph_row(label, 2)
    a = [0] * (WIDE * 32)
    x = (WIDE - width) // 2
    for g in glyphs:
        for r, row in enumerate(g):
            for dx, c in enumerate(row):
                if c == '#': a[(9 + r)*WIDE + x + dx] = 255
        x += len(g[0]) + 2
    return a
def marks61(a, mark):
    names = ['U', 'W'] if mark == 'UW' else [mark]
    x0 = 31  # the box ends at 29: one column gap
    for n in names:
        rows, top = MARK61[n]
        for r, row in enumerate(rows):
            for dx, c in enumerate(row):
                if c == '#': a[(top + r)*WIDE + x0 + dx] = 255
    return a
# ---- 6.5: Segoe UI Bold, 8x supersampled, then snapped to the pixel grid
def text_mask(text, pt, sx, dx, dy, w=32, stroke=0):
    S, Wc = 8, 96
    cmd = ['convert', '-size', f'{Wc*S}x{32*S}', 'xc:black', '-font', FONT, '-pointsize', str(pt * S), '-fill', 'white', '-kerning', '0',
           *(['-stroke', 'white', '-strokewidth', str(stroke * S)] if stroke else []),
           '-gravity', 'center', '-annotate', '+0' + f'{dy*S:+.0f}', text,
           '-distort', 'ScaleRotateTranslate', f'{Wc*S/2},{16*S} {sx},1 0 {Wc*S/2 + dx*S},{16*S}',
           '-gravity', 'center', '-crop', f'{w*S}x{32*S}+0+0', '+repage', '-filter', 'box', '-resize', f'{w}x32!', '-depth', '8', 'gray:-']
    return [v / 255 for v in subprocess.run(cmd, capture_output=True, check=True).stdout]
def cols(m, w=32):
    used = [x for x in range(w) if any(m[y*w+x] > 0.15 for y in range(32))]
    return (used[0], used[-1]) if used else (0, w - 1)
def crisp(text, pt, sx, dx, dy, w, stroke):
    # sub-pixel nudges (an eighth of a pixel) to the place where the fewest pixels are half-covered,
    # then the edges sharpened; what anti-aliasing is left sits on the curves
    best = None
    for ox in (-0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375):
        for oy in (-0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375):
            m = text_mask(text, pt, sx, dx + ox, dy + oy, w, stroke)
            fuzz = sum(v * (1 - v) for v in m)
            if best is None or fuzz < best[0]: best = (fuzz, m)
    return [min(1.0, max(0.0, (v - 0.5) * 1.8 + 0.5)) if 0 < v < 1 else v for v in best[1]]
def fit(text, pt, sx, dx, dy, lo, hi, stroke=0):
    # condense until the letters span no more than columns lo..hi (measured on a 64 px render), centre them there
    while True:
        a, b = cols(text_mask(text, pt, sx, dx, dy, 64, stroke), 64)
        if b - a <= hi - lo or sx < 0.45: break
        sx -= 0.02
    shift = (lo + hi) / 2 - ((a + b) / 2 - 16)
    return crisp(text, pt, sx, dx + shift, dy, 32, stroke)
def base65(label, box):
    if label in ROMSET: return rom(ROMSET[label])
    m = fit(label, 24, 0.7, 0, -1.5, 6, 25)
    return [round(b * (1 - v) * 255) for b, v in zip(box, m)]
def boxless65(label):
    m = fit(label, 23, 0.75, 0, -1.5, 1, 30)
    return widen([round(v * 255) for v in m]) if False else [round(v * 255) for v in recentre(m)]
def recentre(m):
    # the 32 px render, centred on the 40 px canvas
    out = [0.0] * (WIDE * 32); off = (WIDE - 32) // 2
    for y in range(32):
        for x in range(32): out[y*WIDE + x + off] = m[y*32+x]
    return out
def mark65(a, mark):
    # rendered on the 32 px grid, then moved right of the box (it ends at 28: one column gap)
    def place(m, x_from):
        xs = [x for x in range(32) if any(m[y*32+x] > 0.05 for y in range(32))]
        if not xs: return
        shift = x_from - xs[0]
        for y in range(32):
            for x in xs:
                nx = x + shift
                if 0 <= nx < WIDE: a[y*WIDE+nx] = max(a[y*WIDE+nx], round(m[y*32+x] * 255))
    if mark == '+': place(fit('+', 16, 0.95, 0, -9, 4, 11, stroke=0.9), 30)
    elif mark == 'A': place(fit('A', 11.5, 1.45, 0, -7.5, 4, 11, stroke=1.0), 30)
    elif mark == 'UW':
        place(fit('U', 11.5, 1.2, 0, -8.5, 4, 11, stroke=1.0), 30)
        place(fit('W', 11.5, 0.95, 0, 1.5, 4, 11, stroke=1.0), 30)
    return a
box = None
if V65:
    c = rom(22216)[3*32+3] / 255
    box = [1.0 if 3 <= i % 32 <= 28 and 3 <= i // 32 <= 28 else 0.0 for i in range(1024)]
    for (x, y) in ((3, 3), (28, 3), (3, 28), (28, 28)): box[y*32+x] = c
for t, (label, mark) in TYPES.items():
    if mark == 'boxless':
        save(f'status-data-{t}-avail', boxless65(label) if V65 else boxless61(label), WIDE)
        continue
    a = base65(label, box) if V65 else base61(label)
    if not mark:
        save(f'status-data-{t}-avail', a, 32)
        continue
    a = widen(a)
    save(f'status-data-{t}-avail', mark65(a, mark) if V65 else marks61(a, mark), WIDE)
print('ok')
