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
# ---- sharper big copies, nothing moved (Yukimi, Nov 17: "still blurry ... nothing to do with changing their
# literal display size"): cells, positions and sizes stay exactly the art's. Where an icon's 4x is only its 2x
# doubled, the 4x comes from a light clean-up of its art instead (point-enlarged, a small soften and threshold:
# corners and straight runs stay sharp, only the diagonals' staircase goes - not the smudged first try); an 8x
# atlas is made the same way, and the page picks the atlas by the icon's real device size (wmShell
# syncIconUnit -> data-wm-icon-art), so a phone only ever scales them down. 1x and 2x stay the ROM's pixels.
def im(px, w, h, *ops):
    t = os.path.join('/tmp', f'claude-atlas-{os.getpid()}.rgba')
    open(t, 'wb').write(px)
    # transparent outside the cell: softening and resampling must not wrap one edge of a glyph round to the other
    out = subprocess.run(['convert', '-size', f'{w}x{h}', '-depth', '8', f'rgba:{t}', '-virtual-pixel', 'transparent', *ops, '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout
    os.remove(t)
    return out
def clean_up(px, w, h, factor, radius):
    """px (w x h) point-enlarged by factor, then a light soften-and-threshold of its alpha."""
    return im(px, w, h, '-filter', 'point', '-resize', f'{factor * 100}%', '-channel', 'A', '-blur', f'0x{radius}', '-level', '45%,55%', '+channel')
def big_copies(px2, px4, w, h):
    """(4x, 8x) for an icon: a real 4x art is kept and its 8x cleaned up from it; a doubled one is redone from the 2x."""
    doubled = px4 is None or px4 == double(px2, w, h)
    m8 = clean_up(px2, w, h, 4, 0.8) if doubled else clean_up(px4, w * 2, h * 2, 2, 0.5)
    c4 = im(m8, w * 4, h * 4, '-filter', 'Lanczos', '-resize', '50%') if doubled else px4
    return c4, m8

# ---- the battery at its larger size (Yukimi, Nov 17: "looks smaller than earlier today"; "there is no width
# restriction"): the battery family enlarged 1.28x (this afternoon's size, inside the bar's padding), as wide as
# its shape needs, in its own cell; every other icon stays as drawn. From the light clean-up master, cut with a
# margin so no edge is clipped.
BIG_FAMILIES = ()   # none: the battery keeps its drawn size (Yukimi: "they're too big, that's why you can't maintain the rule")
BIG_SCALE = 1.28   # the art enlarged 1.28x: this afternoon's battery (16 -> 20.5 units wide, 9.5 -> 12.2 tall)
def alpha_box(px, w, h, cut=20):
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
def enlarge(arts):
    """{name: (w2, px1, px2, px4, px8)} for the icons of BIG_FAMILIES: one scale per family (its union)."""
    out = {}
    for fam in BIG_FAMILIES:
        mem = [(n, w, h, px) for n, f, w, h, px in arts if n.split('-')[0] == fam]
        if not mem: continue
        masters = {n: clean_up(px, w, h, 4, 0.8) for n, w, h, px in mem}
        boxes = [alpha_box(masters[n], w * 4, h * 4) for n, w, h, px in mem]
        boxes = [b for b in boxes if b]
        W8, H8 = mem[0][1] * 4, mem[0][2] * 4
        m = 4
        x0 = max(0, min(b[0] for b in boxes) - m); y0 = max(0, min(b[1] for b in boxes) - m)
        x1 = min(W8, max(b[2] for b in boxes) + m); y1 = min(H8, max(b[3] for b in boxes) + m)
        bw, bh = x1 - x0, y1 - y0
        k = BIG_SCALE
        gw8, gh8 = round(bw * k), round(bh * k)
        w2 = ((gw8 // 4 + 4 + 1) // 2) * 2          # whole 2x pixels, half a unit spare each side
        for n, w, h, px in mem:
            # one scale and width for the family, but each glyph centred on its own height (centring the family's
            # union put the plain battery low in its cell, off the other icons' centre line)
            ob = alpha_box(masters[n], W8, H8)
            oy0, oy1 = max(0, ob[1] - m), min(H8, ob[3] + m)
            gh_n = round((oy1 - oy0) * k)
            cell8 = im(masters[n], W8, H8, '-crop', f'{bw}x{oy1 - oy0}+{x0}+{oy0}', '+repage', '-filter', 'Lanczos', '-resize', f'{gw8}x{gh_n}!',
                       '-background', 'none', '-gravity', 'center', '-extent', f'{w2 * 4}x128')
            out[n] = (w2, im(cell8, w2 * 4, 128, '-filter', 'Lanczos', '-resize', f'{w2 // 2}x16!'),
                      im(cell8, w2 * 4, 128, '-filter', 'Lanczos', '-resize', '25%'),
                      im(cell8, w2 * 4, 128, '-filter', 'Lanczos', '-resize', '50%'), cell8)
    return out

# ---- the programs' icons at one optical height (Yukimi, Nov 17: "we had optical heights that we wanted to
# maintain ... system icons are special"): mail, texts, Messenger, prints, the Car, ActiveSync, weather, rain,
# Lapis, Continuity and Nightshade are atlas cells (app-*), each glyph 15 units tall inside the bar's padding and
# as wide as its shape; the system icons keep their ROM shapes (the battery enlarged above). The Director and
# Update stay single pictures (their animations swap them). Light clean-up master, cut with a margin.
APP_ICONS = [('app-mail', 'status-mail'), ('app-sms', 'status-sms'), ('app-messenger', 'status-messenger'), ('app-prints', 'status-prints'),
             ('app-weather-alert', 'status-weather-alert'), ('app-rain-alarm', 'status-rain-alarm'), ('app-traffic', 'status-traffic'),
             ('app-lapis', 'status-lapis'), ('app-continuity', 'status-continuity'), ('app-activesync', 'status-activesync'),
             ('app-nightshade', 'status-nightshade')]
APP_H8 = 120   # 15 units at 8x
def app_cells(ver):
    """[(name, file, w2, px2)] and {name: (w2, px1, px2, px4, px8)} for the programs' icons (6.5 takes its own art where it has it)."""
    arts, big = [], {}
    for name, file in APP_ICONS:
        src = None
        for d in (os.path.join(IMG, ver), os.path.join(IMG, 'wm61')):
            if os.path.exists(os.path.join(d, f'{file}@2x.png')): src = d; break
        if not src: continue
        w, h, px = rgba(os.path.join(src, f'{file}@2x.png'))
        # a transparent border first, so the margin round the glyph exists even where the art fills its cell
        B = 8
        m8 = im(clean_up(px, w, h, 4, 0.8), w * 4, h * 4, '-bordercolor', 'none', '-border', str(B))
        b = alpha_box(m8, w * 4 + 2 * B, h * 4 + 2 * B)
        if not b: continue
        m = 4
        x0, y0, x1, y1 = b[0] - m, b[1] - m, b[2] + m, b[3] + m
        bw, bh = x1 - x0, y1 - y0
        k = (APP_H8 + 2 * m) / bh
        gw8, gh8 = round(bw * k), round(bh * k)
        w2 = max(32, ((gw8 // 4 + 4 + 1) // 2) * 2)
        cell8 = im(m8, w * 4 + 2 * B, h * 4 + 2 * B, '-crop', f'{bw}x{bh}+{x0}+{y0}', '+repage', '-filter', 'Lanczos', '-resize', f'{gw8}x{gh8}!',
                   '-background', 'none', '-gravity', 'center', '-extent', f'{w2 * 4}x128')
        c2 = im(cell8, w2 * 4, 128, '-filter', 'Lanczos', '-resize', '25%')
        big[name] = (w2, im(cell8, w2 * 4, 128, '-filter', 'Lanczos', '-resize', f'{w2 // 2}x16!'), c2,
                     im(cell8, w2 * 4, 128, '-filter', 'Lanczos', '-resize', '50%'), cell8)
        arts.append((name, file, w2, 32, c2))
    return arts, big

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
        if (name, file) not in icons: icons.append((name, file))
    d = os.path.join(IMG, ver)
    arts = []
    for name, file in icons:
        if not os.path.exists(os.path.join(d, f'{file}@2x.png')):
            print(ver, 'no art, rule dropped:', name)  # (6.1's data-active never had a file)
            continue
        w, h, px = rgba(os.path.join(d, f'{file}@2x.png'))
        arts.append((name, file, w, h, px))
    arts = [a for a in arts if not a[0].startswith('app-')]
    BIG = enlarge(arts)
    arts = [(n, f, BIG[n][0] if n in BIG else w, h, BIG[n][2] if n in BIG else px) for n, f, w, h, px in arts]
    # the programs' icons stay their own pictures at their drawn size (app_cells is kept for reference, unused:
    # enlarged, they pushed an icon left of the Fold's camera, breaking 5 icons + X / ok to its right)
    # shelves
    W = 512; x = y = 0; shelf = 0; pos = {}
    for name, file, w, h, px in arts:
        if x + w > W: x = 0; y += shelf; shelf = 0
        pos[name] = (x, y); x += w + (w % 2); shelf = max(shelf, h + (h % 2))
    H = y + shelf
    a2 = bytearray(W * H * 4); a4 = bytearray(W * 2 * H * 2 * 4); a1 = bytearray((W // 2) * (H // 2) * 4); a8 = bytearray(W * 4 * H * 4 * 4)
    for name, file, w, h, px in arts:
        x, y = pos[name]
        blit(a2, W, px, w, h, x, y)
        p4 = os.path.join(d, f'{file}@4x.png')
        if name in BIG:
            _, big1, _, px4, px8 = BIG[name]
        elif os.path.exists(p4):
            w4, h4, px4 = rgba(p4)
            assert (w4, h4) == (w * 2, h * 2), (file, w4, h4)
            px4, px8 = big_copies(px, px4, w, h)
        else:
            px4, px8 = big_copies(px, None, w, h)
        blit(a4, W * 2, px4, w * 2, h * 2, x * 2, y * 2)
        blit(a8, W * 4, px8, w * 4, h * 4, x * 4, y * 4)
        p1 = os.path.join(d, f'{file}.png')
        if name in BIG:
            px1 = BIG[name][1]
        elif os.path.exists(p1):
            w1, h1, px1 = rgba(p1)
            if (w1, h1) != (w // 2, h // 2): px1 = halve(px, w, h)
        else: px1 = halve(px, w, h)
        blit(a1, W // 2, px1, w // 2, h // 2, x // 2, y // 2)
    png(os.path.join(d, 'status-atlas@2x.png'), W, H, a2)
    png(os.path.join(d, 'status-atlas@4x.png'), W * 2, H * 2, a4)
    png(os.path.join(d, 'status-atlas.png'), W // 2, H // 2, a1)
    png(os.path.join(d, 'status-atlas@8x.png'), W * 4, H * 4, a8)
    src = f'/static_images/{ver}/status-atlas'
    lines = [BEGIN,
             f'/* {len(arts)} icons, one image per density ({W} x {H} px at 2x); the per-icon art stays as the source */']
    sets = f"image-set(url('{src}.png') 1x, url('{src}@2x.png') 2x, url('{src}@4x.png') 4x)" if ver == 'wm61' \
        else f"image-set(url('{src}@2x.png') 2x, url('{src}@4x.png') 4x)"
    lines.append(f'{scope}.wm-status-icon[data-icon] {{ background-image: {sets}; background-size: calc({W // 2} * {U}) calc({H // 2} * {U}); background-repeat: no-repeat; }}')
    # the atlas for the icon's real device size (wmShell syncIconUnit sets data-wm-icon-art): only ever scaled down
    pick = (scope or 'html ').replace('html', 'html:not(.wm-art-1x)[data-wm-icon-art="{a}"]', 1)
    for art, f in (('2', '@2x'), ('4', '@4x'), ('8', '@8x')):
        lines.append(f"{pick.format(a=art)}.wm-status-icon[data-icon] {{ background-image: url('{src}{f}.png'); }}")
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
