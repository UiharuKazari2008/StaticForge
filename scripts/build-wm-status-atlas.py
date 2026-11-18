#!/usr/bin/env python3
# Usage: python3 scripts/build-wm-status-atlas.py
# Melaton Mobile's title-bar status icons as one sprite sheet per version and density
# (public/static_images/wm61|wm65/status-atlas.png / @2x / @4x), so the title bar is one image to
# fetch and decode instead of one per icon (Yukimi, Nov 12 2026, #773). The icon list comes from the
# CSS itself: every `.wm-status-icon[data-icon="X"] { background-image: ... }` rule between the
# markers in wm-shell.css (6.1) and wm65.css (6.5); the rules are rewritten to one atlas image rule
# plus a background-position per icon. Rerun after any status art changes (the generators of the data
# badges, frames and large badges first).
#   Packing: shelves 512 px wide at 2x, every offset even (whole units at every scale); 4x = the
#   icon's own @4x (point-doubled @2x where it has none), 1x = its own 1x (box-halved @2x where none).
#   Positions are in --wm-icon-unit (16 units = 32 px at 2x), so the art stays on the pixel grid.
import re, os, struct, zlib, subprocess
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
IMG = os.path.join(ROOT, 'public', 'static_images')
BEGIN = '/* ---- status atlas (scripts/build-wm-status-atlas.py: generated, do not edit) ---- */'
END = '/* ---- end of status atlas ---- */'
U = 'var(--wm-icon-unit, var(--wm-px))'
def rgba(path):
    w, h = map(int, subprocess.run(['identify', '-format', '%w %h', path], capture_output=True, check=True, text=True).stdout.split()[:2])
    return w, h, subprocess.run(['convert', path, '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout
def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[(y * w) * 4:(y * w + w) * 4]) for y in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
def blit(dst, dw, src, sw, sh, x, y):
    for r in range(sh):
        dst[((y + r) * dw + x) * 4:((y + r) * dw + x + sw) * 4] = src[r * sw * 4:(r + 1) * sw * 4]
def double(px, w, h):
    return bytes(b''.join(bytes(px[((y // 2) * w + x // 2) * 4:((y // 2) * w + x // 2) * 4 + 4]) for y in range(h * 2) for x in range(w * 2)))
def halve(px, w, h):
    out = bytearray((w // 2) * (h // 2) * 4)
    for y in range(h // 2):
        for x in range(w // 2):
            q = [((2*y+dy) * w + 2*x+dx) * 4 for dy in (0, 1) for dx in (0, 1)]
            a = sum(px[i + 3] for i in q)
            if a: out[(y * (w // 2) + x) * 4:(y * (w // 2) + x) * 4 + 4] = bytes([sum(px[i + c] * px[i + 3] for i in q) // a for c in range(3)] + [a // 4])
    return bytes(out)
# ---- one glyph height (Yukimi, Nov 17 2026, "too small and unevenly sized" -> option 1): every glyph is cut
# to its bounds and scaled to 16 units tall (the whole cell: the emulator bar's 5-unit padding above and below),
# its cell as wide as its shape needs (at most 24 units) and 16 units high, so the bar keeps its padding and
# wide icons (mail, prints, the car, the data badges) grow to the antenna's height. A family whose state is
# how much of the cell it fills (signal bars, battery levels, data, wifi, volume) shares one cut and scale.
# Scaling keeps the 1-bit art sharp where it can: ROM art already near the height is only cut and centred,
# Melaton's 16 px pixel art goes up by a whole factor from its 1x copy, anything else is resampled.
# "..." (notify-many) keeps its cell (bottom-aligned on purpose).
KEEP = {'notify-many'}
GROUPS = ('data', 'signal', 'battery', 'wifi', 'volume')
VARIANT = re.compile(r'-(?:\d+|none|off|on|alert|full|empty|low|charging|active|avail|unknown)$')
GLYPH4 = 64    # 16 units at 4x: the whole cell, the bar's 5-unit padding above and below (Yukimi: bigger)
CAPW4 = 96     # 24 units at 4x
# the status icons of programs (wmShell STATUS_APP_ICONS), so they size like the rest and the app draws them
# from the atlas (the Director and Update stay single pictures: their animations replace the picture)
EXTRA = [('app-mail', 'status-mail'), ('app-sms', 'status-sms'), ('app-messenger', 'status-messenger'), ('app-prints', 'status-prints'),
         ('app-weather-alert', 'status-weather-alert'), ('app-rain-alarm', 'status-rain-alarm'), ('app-traffic', 'status-traffic'),
         ('app-lapis', 'status-lapis'), ('app-continuity', 'status-continuity'), ('app-activesync', 'status-activesync'),
         ('app-nightshade', 'status-nightshade')]
def family(name):
    head = name.split('-')[0]
    if head in GROUPS: return head
    f = name
    while VARIANT.search(f): f = VARIANT.sub('', f)
    return f
def alpha_box(px, w, h, cut=40):
    x0 = y0 = 10 ** 9; x1 = y1 = -1
    for y in range(h):
        row = px[y * w * 4:(y + 1) * w * 4]
        for x in range(w):
            if row[x * 4 + 3] > cut:
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
    return (x0, y0, x1 + 1, y1 + 1) if x1 >= 0 else None
def im(px, w, h, *ops):
    t = os.path.join('/tmp', f'claude-atlas-{os.getpid()}.rgba')
    open(t, 'wb').write(px)
    out = subprocess.run(['convert', '-size', f'{w}x{h}', '-depth', '8', f'rgba:{t}', *ops, '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout
    os.remove(t)
    return out
def sources(dirs, file):
    for d in dirs:
        p2 = os.path.join(d, f'{file}@2x.png')
        if not os.path.exists(p2): continue
        w, h, px2 = rgba(p2)
        p4 = os.path.join(d, f'{file}@4x.png')
        px4 = None
        if os.path.exists(p4):
            w4, h4, q = rgba(p4)
            if (w4, h4) == (w * 2, h * 2): px4 = q
        if px4 is None: px4 = double(px2, w, h)
        p1 = os.path.join(d, f'{file}.png')
        px1 = None
        if os.path.exists(p1):
            w1, h1, q = rgba(p1)
            if (w1, h1) == (w // 2, h // 2): px1 = q
        return w, h, px1, px2, px4
    return None
def master(px2, w, h):
    """The glyph at 8x (4x its 2x art) with smooth edges: point-enlarged, softened and thresholded again, so the
    pixel staircases become clean diagonals and curves and straight runs stay straight (no visible art pixels
    at any phone density - Yukimi, Nov 17: "low res, you can see the pixels up close")."""
    return im(px2, w, h, '-filter', 'point', '-resize', '400%', '-channel', 'A', '-blur', '0x2.2', '-level', '42%,58%', '+channel')
def fit(entries):
    """entries: [(name, file, w2, h2, px1, px2, px4)] -> [(name, file, cw2, 32, px1, px2, px4)]: each glyph from
    its smooth 8x master, cut to its family's bounds, 16 units tall (32 px at 2x), as wide as its shape (at most
    24 units), every density downscaled from the master (never an enlarged art pixel)."""
    masters = {e[0]: master(e[5], e[2], e[3]) for e in entries}
    boxes = {}
    for e in entries:
        if e[0] in KEEP: continue
        b = alpha_box(masters[e[0]], e[2] * 4, e[3] * 4, 127)
        if b: boxes[e[0]] = b
    fam = {}
    for n, b in boxes.items(): fam.setdefault(family(n), []).append(b)
    plan = {}
    for f, bs in fam.items():
        bw = max(b[2] - b[0] for b in bs); bh = max(b[3] - b[1] for b in bs)
        plan[f] = min(GLYPH4 * 2 / bh, CAPW4 * 2 / bw)
    out = []
    for name, file, w, h, px1, px2, px4 in entries:
        W8, H8 = w * 4, h * 4
        if name not in boxes:
            # kept as drawn ("..."): its master downscaled to each density
            m = masters[name]
            c4 = im(m, W8, H8, '-filter', 'Lanczos', '-resize', '50%')
            out.append((name, file, w, h, im(m, W8, H8, '-filter', 'Lanczos', '-resize', '12.5%'), im(m, W8, H8, '-filter', 'Lanczos', '-resize', '25%'), c4)); continue
        f = family(name); k = plan[f]
        mem = [b for n2, b in boxes.items() if family(n2) == f]
        x0 = max(0, min(b[0] for b in mem)); y0 = max(0, min(b[1] for b in mem))
        x1 = min(W8, max(b[2] for b in mem)); y1 = min(H8, max(b[3] for b in mem))
        bw, bh = x1 - x0, y1 - y0
        # the cell at 8x: the glyph scaled to the family's size, centred; then each density from it
        gw8, gh8 = max(1, round(bw * k)), max(1, round(bh * k))
        cw2 = max(32 if w == 32 else 0, ((gw8 // 4 + 8 + 3) // 4) * 2)
        cw2 = min(cw2, CAPW4 // 2 + 4)
        cell8 = im(masters[name], W8, H8, '-crop', f'{bw}x{bh}+{x0}+{y0}', '+repage', '-filter', 'Lanczos', '-resize', f'{gw8}x{gh8}!',
                   '-background', 'none', '-gravity', 'center', '-extent', f'{cw2 * 4}x128')
        c4 = im(cell8, cw2 * 4, 128, '-filter', 'Lanczos', '-resize', '50%')
        c2 = im(cell8, cw2 * 4, 128, '-filter', 'Lanczos', '-resize', '25%')
        c1 = im(cell8, cw2 * 4, 128, '-filter', 'Lanczos', '-resize', f'{cw2 // 2}x16!')
        out.append((name, file, cw2, 32, c1, c2, c4))
    return out

def build(ver, css_path, rule_re, scope, has_1x_rules):
    css = open(css_path).read()
    if BEGIN in css:
        a = css.index(BEGIN); b = css.index(END) + len(END)
        body = css[a:b]
    else:
        body = css
    icons = []
    for m in re.finditer(rule_re, body, re.M):
        name, file = m.group(1), m.group(2)
        if (name, file) not in icons and not name.startswith('app-'): icons.append((name, file))
    d = os.path.join(IMG, ver)
    entries = []
    for name, file in icons:
        src = sources([d], file)
        if not src:
            print(ver, 'no art, rule dropped:', name)  # (6.1's data-active never had a file)
            continue
        entries.append((name, file) + src)
    for name, file in EXTRA:
        src = sources([d, os.path.join(IMG, 'wm61')], file)
        if src: entries.append((name, file) + src)
    entries = fit(entries)
    arts = [(n, f, w, h, px2) for n, f, w, h, px1, px2, px4 in entries]
    # shelves
    W = 512; x = y = 0; shelf = 0; pos = {}
    for name, file, w, h, px in arts:
        if x + w > W: x = 0; y += shelf; shelf = 0
        pos[name] = (x, y); x += w + (w % 2); shelf = max(shelf, h + (h % 2))
    H = y + shelf
    a2 = bytearray(W * H * 4); a4 = bytearray(W * 2 * H * 2 * 4); a1 = bytearray((W // 2) * (H // 2) * 4)
    for name, file, w, h, px1, px2, px4 in entries:
        x, y = pos[name]
        blit(a2, W, px2, w, h, x, y)
        blit(a4, W * 2, px4, w * 2, h * 2, x * 2, y * 2)
        blit(a1, W // 2, px1 if px1 is not None else halve(px2, w, h), w // 2, h // 2, x // 2, y // 2)
    png(os.path.join(d, 'status-atlas@2x.png'), W, H, a2)
    png(os.path.join(d, 'status-atlas@4x.png'), W * 2, H * 2, a4)
    png(os.path.join(d, 'status-atlas.png'), W // 2, H // 2, a1)
    src = f'/static_images/{ver}/status-atlas'
    lines = [BEGIN,
             f'/* {len(arts)} icons, one image per density ({W} x {H} px at 2x); the per-icon art stays as the source */']
    sets = f"image-set(url('{src}.png') 1x, url('{src}@2x.png') 2x, url('{src}@4x.png') 4x)" if ver == 'wm61' \
        else f"image-set(url('{src}@2x.png') 2x, url('{src}@4x.png') 4x)"
    lines.append(f'{scope}.wm-status-icon[data-icon] {{ background-image: {sets}; background-size: calc({W // 2} * {U}) calc({H // 2} * {U}); background-repeat: no-repeat; }}')
    if has_1x_rules:
        lines.append(f"html.wm-art-1x{scope.replace('html', '', 1)}.wm-status-icon[data-icon] {{ background-image: url('{src}.png'); }}")
    for name, file, w, h, px in arts:
        x, y = pos[name]
        wd = f' width: calc({w // 2} * {U});' if w != 32 else ''
        lines.append(f'{scope}.wm-status-icon[data-icon="{name}"] {{ background-position: calc({-x // 2} * {U}) calc({-y // 2} * {U});{wd} }}')
    lines.append(END)
    block = '\n'.join(lines)
    if BEGIN in css:
        css = css[:css.index(BEGIN)] + block + css[css.index(END) + len(END):]
    else:
        # first run: the per-icon rules (and 6.5's 1x copies) give way to the atlas block
        out = []; placed = False
        for line in css.split('\n'):
            if re.match(rule_re, line) or (has_1x_rules and re.match(r'^html\.wm-art-1x\.ui-mobile\[data-wm-version="6\.5"\] \.wm-status-icon\[data-icon="[^"]+"\] \{ background-image: url\(', line)):
                if not placed: out.append(block); placed = True
                continue
            out.append(line)
        css = '\n'.join(out)
        # keep the source list for reruns: the original rules go in a comment-free sidecar
    open(css_path, 'w').write(css)
    # the icon list for reruns (the rules are gone from the CSS once the atlas is in)
    open(os.path.join(d, 'status-atlas.json'), 'w').write(__import__('json').dumps({'size2x': [W, H], 'icons': {n: {'file': f, 'x': pos[n][0], 'y': pos[n][1], 'w': w, 'h': h} for n, f, w, h, _ in arts}}, indent=1) + '\n')
    print(ver, len(arts), 'icons', W, 'x', H)
import json
def rules_from_json(ver):
    p = os.path.join(IMG, ver, 'status-atlas.json')
    return json.load(open(p))['icons'] if os.path.exists(p) else None
R61 = r'^\.wm-status-icon\[data-icon="([^"]+)"\] \{ background-image: image-set\(url\(\'/static_images/wm61/([^@\']+?)(?:\.png|@2x\.png)\'\)'
R65 = r'^html\.ui-mobile\[data-wm-version="6\.5"\] \.wm-status-icon\[data-icon="([^"]+)"\] \{ background-image: image-set\(url\(\'/static_images/wm65/([^@\']+?)@2x\.png\'\)'
for ver, css, rr, scope, one in (('wm61', 'public/css/wm-shell.css', R61, '', False), ('wm65', 'public/css/wm65.css', R65, 'html.ui-mobile[data-wm-version="6.5"] ', True)):
    path = os.path.join(ROOT, css)
    if BEGIN in open(path).read():
        # rerun: rebuild the rule text from the sidecar list so the same regex finds the icons
        icons = rules_from_json(ver)
        tmp = '\n'.join((f".wm-status-icon[data-icon=\"{n}\"] {{ background-image: image-set(url('/static_images/wm61/{i['file']}.png') 1x" if ver == 'wm61'
                         else f"html.ui-mobile[data-wm-version=\"6.5\"] .wm-status-icon[data-icon=\"{n}\"] {{ background-image: image-set(url('/static_images/wm65/{i['file']}@2x.png') 2x") for n, i in icons.items())
        txt = open(path).read()
        a = txt.index(BEGIN); b = txt.index(END) + len(END)
        open(path, 'w').write(txt[:a] + BEGIN + '\n' + tmp + '\n' + END + txt[b:])
    build(ver, path, rr, scope, one)
