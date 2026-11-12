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
    # shelves
    W = 512; x = y = 0; shelf = 0; pos = {}
    for name, file, w, h, px in arts:
        if x + w > W: x = 0; y += shelf; shelf = 0
        pos[name] = (x, y); x += w + (w % 2); shelf = max(shelf, h + (h % 2))
    H = y + shelf
    a2 = bytearray(W * H * 4); a4 = bytearray(W * 2 * H * 2 * 4); a1 = bytearray((W // 2) * (H // 2) * 4)
    for name, file, w, h, px in arts:
        x, y = pos[name]
        blit(a2, W, px, w, h, x, y)
        p4 = os.path.join(d, f'{file}@4x.png')
        if os.path.exists(p4):
            w4, h4, px4 = rgba(p4)
            assert (w4, h4) == (w * 2, h * 2), (file, w4, h4)
        else: px4 = double(px, w, h)
        blit(a4, W * 2, px4, w * 2, h * 2, x * 2, y * 2)
        p1 = os.path.join(d, f'{file}.png')
        if os.path.exists(p1):
            w1, h1, px1 = rgba(p1)
            if (w1, h1) != (w // 2, h // 2): px1 = halve(px, w, h)
        else: px1 = halve(px, w, h)
        blit(a1, W // 2, px1, w // 2, h // 2, x // 2, y // 2)
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
        lines.append(f'{scope}.wm-status-icon[data-icon="{name}"] {{ background-position: calc({-x // 2} * {U}) calc({-y // 2} * {U}); }}')
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
