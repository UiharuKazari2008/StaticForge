#!/usr/bin/env python3
# Usage: python3 scripts/generate-wm-data-badges-extra.py public/static_images/wm61|wm65
# The small data-type badges added for Settings > Connections > Cellular (#771), in each version's
# style, and their connected icons (badge + the ROM's left / right arrows):
#   uw        UWB (full lettering; the asset key stays 'uw')
#   lte       LTE in place of 4G            lte-plus  LTE with the + outside the box
#   5g-uw     5G with a stacked U / W outside the box (mmWave apart from 5G+)
#   nr-uw     NR with the stacked U / W     (NR UW in place of UWB)
# 6.1: the box and 12-row glyphs of scripts/generate-wm-data-icons.py (1 px left / 2 px other
# borders, letters cut out); 6.5: the 17-row rounded box of the ROM's 3G (status-data-3g@2x) and
# the compact 9-row glyphs of its NR / UWB badges (2 px strokes). 5G and NR boxes are the repo's own
# badges; the + is taken from the 4G+ badge. The stacked U / W are white, outside the box, as the
# NR-A's A. Where the marks would meet 6.1's arrows (they sit right of the box there) the canvas
# widens and the arrows move right.
# Then: generate-wm-data-sync-frames.py, generate-wm-data-anim-frames.py, build-wm-sprite-strips.sh.
import struct, zlib, subprocess, sys, os
WM = sys.argv[1]
V65 = WM.rstrip('/').endswith('wm65')
def rgba(name):
    p = os.path.join(WM, name)
    w, h = map(int, subprocess.run(['identify', '-format', '%w %h', p], capture_output=True, check=True, text=True).stdout.split()[:2])
    px = bytearray(subprocess.run(['convert', p, '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout)
    return w, h, [[px[(y*w+x)*4+3] for x in range(w)] for y in range(h)]
def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[(y * w) * 4:(y * w + w) * 4]) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
def save(name, a):
    h, w = len(a), len(a[0])
    px = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            if a[y][x]: px[(y*w+x)*4:(y*w+x)*4+4] = bytes([255, 255, 255, a[y][x]])
    p = os.path.join(WM, name)
    png(f'{p}@2x.png', w, h, px)
    png(f'{p}@4x.png', w * 2, h * 2, bytearray(b''.join(bytes(px[((y // 2) * w + x // 2) * 4:((y // 2) * w + x // 2) * 4 + 4]) for y in range(h * 2) for x in range(w * 2))))
    w1 = w // 2; p1 = bytearray(w1 * 16 * 4)
    for y in range(16):
        for x in range(w1):
            q = [(2*y+dy, 2*x+dx) for dy in (0, 1) for dx in (0, 1)]
            s = sum(a[yy][xx] for yy, xx in q)
            if s: p1[(y*w1+x)*4:(y*w1+x)*4+4] = bytes([255, 255, 255, s // 4])
    png(f'{p}.png', w1, 16, p1)
def blank(w): return [[0] * w for _ in range(32)]
def box_cols(a):
    # the box: columns lit on its top row
    xs = [x for x in range(len(a[0])) if a[0 if not V65 else 1][x] > 127]
    return xs[0], xs[-1]
# ---- 6.1: generate-wm-data-icons.py's box and glyphs ('1' = letter hole), rows 0..11 at y 2
G61 = {
 'L': ['110000']*10 + ['111111']*2,
 'T': ['11111111']*2 + ['00011000']*10,
 'E': ['111111']*2 + ['110000']*3 + ['111110']*2 + ['110000']*3 + ['111111']*2,
 'U': ['110011']*10 + ['111111', '011110'],
 'W': ['11000011']*4 + ['11011011']*6 + ['11111111', '01100110'],
 'B': ['111110','111111','110011','110011','111111','111110','111111','110011','110011','110011','111111','111110'],
}
SUP61_U = ['##..##', '##..##', '##..##', '##..##', '##..##', '######', '.####.']
SUP61_W = ['##....##', '##....##', '##.##.##', '##.##.##', '########', '###..###', '##....##']
def label61(text):
    w = 1 + sum(len(G61[c][0]) for c in text) + (len(text) - 1) + 2
    a = blank(40)
    for y in range(16):
        for x in range(w): a[y][x] = 255
    x0 = 1
    for c in text:
        for r, row in enumerate(G61[c]):
            for dx, b in enumerate(row):
                if b == '1': a[2 + r][x0 + dx] = 0
        x0 += len(G61[c][0]) + 1
    return a, w
# ---- 6.5: the ROM 3G box and compact glyphs ('.' = letter hole), rows 4..12
G65 = {
 'U': ['..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '......', '#....#'],
 'W': ['..###..', '..###..', '..###..', '..###..', '..#.#..', '..#.#..', '..#.#..', '.......', '#..#..#'],
 'B': ['.....#', '......', '..##..', '..##..', '.....#', '..##..', '..##..', '......', '.....#'],
 'L': ['..###', '..###', '..###', '..###', '..###', '..###', '..###', '.....', '.....'],
 'T': ['......', '......', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##'],
 'E': ['.....', '.....', '..###', '..###', '....#', '..###', '..###', '.....', '.....'],
}
SUP65_U = ['#..#', '#..#', '#..#', '#..#', '.##.']
SUP65_W = ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.']
def label65(text):
    _, _, box = rgba('status-data-3g@2x.png')   # 17 x 17 rounded box, letters at rows 4..12, cols 2..14
    for y in range(4, 13):
        for x in range(2, 15): box[y][x] = 255
    w = sum(len(G65[c][0]) for c in text) + len(text) - 1 + 4
    a = blank(40)
    for y in range(32):
        for x in range(w):
            sx = x if x < 9 else (16 - (w - 1 - x) if x >= w - 8 else 8)
            a[y][x] = box[y][sx]
    x0 = 2
    for c in text:
        for r, row in enumerate(G65[c]):
            for dx, ch in enumerate(row):
                a[4 + r][x0 + dx] = 255 if ch == '#' else 0
        x0 += len(G65[c][0]) + 1
    return a, w
def from_badge(name):
    w, h, a = rgba(f'status-data-{name}@2x.png')
    x0, x1 = box_cols(a)
    out = blank(40)
    for y in range(min(32, h)):
        for x in range(x1 + 1): out[y][x] = a[y][x]
    return out, x1 + 1
def plus_mark():
    w, h, a = rgba('status-data-4g-plus@2x.png')
    x0, x1 = box_cols(a)
    return [(y, x - x1 - 1, a[y][x]) for y in range(min(18, h)) for x in range(x1 + 1, w) if a[y][x]]
def put(a, glyph, x, y):
    for r, row in enumerate(glyph):
        for dx, ch in enumerate(row):
            if ch == '#': a[y + r][x + dx] = 255
def finish(name, a, used):
    # canvas: 32, or wider when the art (or, on 6.1, the arrows moved clear of the marks) needs it
    W = max(32, used)
    W += W % 2
    a = [row[:W] + [0] * max(0, W - len(row)) for row in a]
    save(f'status-data-{name}', a)
    return W
# the connected icon's arrows: the ROM's (status-data-g-active minus status-data-g)
_, _, ga = rgba('status-data-g-active@2x.png'); _, _, gb = rgba('status-data-g@2x.png')
ARROWS = [(y, x, ga[y][x]) for y in range(32) for x in range(32) if ga[y][x] and ga[y][x] != gb[y][x]]
ARROW_X0 = min(x for y, x, v in ARROWS if y < 22)
def active(name, extra=0):
    w, h, a = rgba(f'status-data-{name}@2x.png')
    for y, x, v in ARROWS:
        xx = x + (w - 32)
        a[y][xx] = max(a[y][xx], v)
    save(f'status-data-{name}-active', a)
made = {}
if V65:
    a, w = label65('UWB'); made['uw'] = finish('uw', a, w)
    a, w = label65('LTE'); made['lte'] = finish('lte', a, w)
    a, w = label65('LTE')
    for y, dx, v in plus_mark(): a[y][w + dx] = v
    made['lte-plus'] = finish('lte-plus', a, w + 8)
    for t, base in (('5g-uw', '5g'), ('nr-uw', 'nr')):
        a, w = from_badge(base)
        put(a, SUP65_U, w + 1, 1); put(a, SUP65_W, w + 1, 8)
        made[t] = finish(t, a, w + 7)
else:
    a, w = label61('UWB'); made['uw'] = finish('uw', a, 32 + max(0, w - 17))
    a, w = label61('LTE'); made['lte'] = finish('lte', a, 32 + max(0, w - 17))
    a, w = label61('LTE')
    for y, dx, v in plus_mark(): a[y][w + dx] = v
    made['lte-plus'] = finish('lte-plus', a, 32 + max(0, w - 17))
    for t, base in (('5g-uw', '5g'), ('nr-uw', 'nr')):
        a, w = from_badge(base)
        a = [row + [0] * 8 for row in a]
        put(a, SUP61_U, w + 1, 0); put(a, SUP61_W, w + 1, 8)
        # the right arrow starts at ARROW_X0 on a 32 px canvas: move it clear of the W (2 px gap)
        made[t] = finish(t, a, 32 + max(0, (w + 1 + len(SUP61_W[0]) + 2) - ARROW_X0))
for t in made: active(t)
print(made)
