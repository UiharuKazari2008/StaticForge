#!/usr/bin/env python3
"""
WM 6.5 Start icons that carry the Windows flag, rebuilt with the Melaton logo (Yozora #805,
copyrights-not-1to1.mdc). Two stages, so the logo can be redone without touching the art:

  base     a clean copy of each icon WITHOUT any logo, from the ROM art: the area under the flag is
           filled so the icon's own art continues there (its gradient, shading and edges), as if the
           flag had never been drawn. Writes public/static_images/wm65/<name>-base{,@2x,@4x}.png.
  compose  <name>-base + the Melaton logo, sized and placed where the flag sat -> <name>{,@2x,@4x}.png

  python3 scripts/build-wm65-flower-icons.py base [--rom ~/.cache/wm65/dump] [--no-upscale]
  python3 scripts/build-wm65-flower-icons.py compose

Icons (geometry in the 90 px @2x grid of the ROM's Start_Icon_*.png):
  start-settingss  Start_Icon_SettingsS, the System folder: folder + colour flag. The folder is the one
                   SettingsC / SettingsP / SettingsS share (each with its own badge); where all three
                   badges cover it, each row of the folder's front is one colour (a vertical gradient),
                   its right end is the left end mirrored and the gear is its own left half mirrored.
  start-buttons    Start_Icon_Buttons: a black glass orb with a white flag (-> white flower).
  start-update     Melaton Update = the device's Windows Update icon: autoupdatecpl.cpl icon group 101
                   (64 px, 8-bit + mask; the device stretches it into the 90 px cell). The globe's edge
                   is drawn as a true circle (the ROM mask is 1-bit).
  Orb and globe: under the flag, the outer ring is interpolated round the circle from the art on
  either side; inside it, a smooth (Laplace) fill from that ring.

@4x of a base: the @2x base (64 px source for start-update) upscaled 4x with 4x-UltraSharp on the
Ruiko GPU worker (modules/localUpscaleWorker.js, as every other @4x of this set) and fitted; with
--no-upscale, Lanczos. 1x: the @2x halved (Lanczos), as ~/.cache/wm65/art/build.sh does.
Logo: public/static_images/melaton/melaton-glass.png (the colour flower, Vista flag colours) or the
white flower (melaton-white.png, shaded like the ROM's white flag) with a soft drop shadow.
Needs numpy + Pillow (e.g. ~/.cache/claude-run/venv/bin/python) and node for the upscale.
"""
import json, os, struct, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageFilter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WM65 = os.environ.get('WM65_OUT') or os.path.join(REPO, 'public/static_images/wm65')
MEL = os.path.join(REPO, 'public/static_images/melaton')

# where the flag sat (x0, y0, x1, y1 in the 90 px grid; measured on the ROM art) and the logo used
LOGO = {
    'start-settingss': {'box': (42.5, 41.0, 86.5, 80.0), 'logo': 'colour', 'shadow': (0.5, 1.0, 0.8, 0.50)},
    'start-buttons': {'box': (18.5, 25.0, 44.5, 43.5), 'logo': 'white', 'shadow': (0.0, 0.5, 0.5, 0.45)},
    'start-update': {'box': (6.0, 0.0, 66.0, 61.0), 'logo': 'colour', 'shadow': (1.0, 1.5, 1.2, 0.45)},
}


# ---------------------------------------------------------------- image helpers

def load(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(float) / 255


def save(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(path, optimize=True)
    print('  wrote', path)


def premul_resize(a, w, h):
    """Lanczos resize in premultiplied alpha (no dark or light fringes at the edges)"""
    p = a.copy(); p[..., :3] *= p[..., 3:4]
    ch = [np.asarray(Image.fromarray(p[..., i].astype(np.float32), 'F').resize((w, h), Image.LANCZOS)) for i in range(4)]
    o = np.clip(np.dstack(ch), 0, 1)
    al = o[..., 3:4]
    o[..., :3] = np.where(al > 1e-4, o[..., :3] / np.maximum(al, 1e-4), 0)
    return np.clip(o, 0, 1)


def over(dst, src):
    sa = src[..., 3:4]; da = dst[..., 3:4]
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.dstack([rgb, oa])


def blur(x, r):
    """Gaussian blur, sigma r (separable, edges clamped)"""
    if r <= 0:
        return x
    k = int(np.ceil(3 * r)); t = np.arange(-k, k + 1); g = np.exp(-t ** 2 / (2 * r * r)); g /= g.sum()
    p = np.pad(x, k, mode='edge')
    p = sum(g[i] * p[i:i + x.shape[0], :] for i in range(2 * k + 1))
    return sum(g[i] * p[:, i:i + x.shape[1]] for i in range(2 * k + 1))


def dilate(m, r):
    return np.asarray(Image.fromarray((m * 255).astype(np.uint8), 'L').filter(ImageFilter.MaxFilter(2 * r + 1))) > 127


def fill_holes(m):
    """m with every region it encloses filled in (flood from the border through ~m)"""
    out = np.zeros_like(m); out[0, :] = ~m[0, :]; out[-1, :] = ~m[-1, :]; out[:, 0] = ~m[:, 0]; out[:, -1] = ~m[:, -1]
    while True:
        g = (out | np.roll(out, 1, 0) | np.roll(out, -1, 0) | np.roll(out, 1, 1) | np.roll(out, -1, 1)) & ~m
        if (g == out).all():
            return ~out
        out = g


def laplace_fill(rgb, hole, iters=4000, fixed=None):
    """the smooth continuation of the rim into hole (Jacobi iterations, boundary = the known pixels)"""
    cur = rgb.copy()
    cur[hole] = rgb[~hole].mean(0) if (~hole).any() else 0
    if fixed is not None:
        fmask, fval = fixed
        cur[fmask] = fval
    for _ in range(iters):
        nb = (np.roll(cur, 1, 0) + np.roll(cur, -1, 0) + np.roll(cur, 1, 1) + np.roll(cur, -1, 1)) / 4
        cur = np.where(hole[..., None], nb, rgb)
        if fixed is not None:
            cur[fmask] = fval
    return cur


def ring_fill(img, hole, cx, cy, r0, r1, skip=None):
    """hole pixels with r0 <= r < r1 from the known art at the same radius, interpolated round the circle"""
    out = img.copy()
    n = img.shape[0]
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    rr = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    for y, x in zip(*np.nonzero(hole & (rr >= r0) & (rr < r1))):
        band = (np.abs(rr - rr[y, x]) < 0.75) & ~hole & (True if skip is None else ~skip)
        if band.sum() < 2:
            continue
        d = (th[band] - th[y, x] + np.pi) % (2 * np.pi) - np.pi
        cand = img[band]
        pos, neg = d > 0, d < 0
        if not pos.any() or not neg.any():
            continue
        ip = np.argmin(np.where(pos, d, 9)); ineg = np.argmax(np.where(neg, d, -9))
        dp, dn = d[ip], -d[ineg]
        out[y, x] = (cand[ip] * dn + cand[ineg] * dp) / (dp + dn)
    return out


def circle_fit(mask, rounds=6):
    """least-squares circle through mask's pixels, dropping those more than 1 px off it (art that
    sticks out of the circle, such as a continent over the globe's edge)"""
    ys, xs = np.nonzero(mask)
    xs = xs + 0.5; ys = ys + 0.5
    for _ in range(rounds):
        A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
        c = np.linalg.lstsq(A, xs ** 2 + ys ** 2, rcond=None)[0]
        R = float(np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2))
        res = np.abs(np.hypot(xs - c[0], ys - c[1]) - R)
        keep = res < max(1.0, np.quantile(res, 0.7))
        if keep.all():
            break
        xs, ys = xs[keep], ys[keep]
    return float(c[0]), float(c[1]), R


def edge_pixels(alpha):
    o = alpha > 0.5
    return o & ~(np.roll(o, 1, 0) & np.roll(o, -1, 0) & np.roll(o, 1, 1) & np.roll(o, -1, 1))


# ---------------------------------------------------------------- bases

def base_settingss(rom):
    C = load(os.path.join(rom, 'win/Start_Icon_SettingsC.png'))
    P = load(os.path.join(rom, 'win/Start_Icon_SettingsP.png'))
    S = load(os.path.join(rom, 'win/Start_Icon_SettingsS.png'))
    n = S.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    # the blue badges of C and P with the white glyphs inside them and their drop shadow
    def badge(a):
        m = (a[..., 2] > a[..., 0] + 0.05) & (a[..., 3] > 0.3) & (xx > 36) & (yy > 34)
        return dilate(fill_holes(dilate(m, 1)), 2)
    bC, bP = badge(C), badge(P)
    ref = np.where(~bC[..., None], C, P)
    refok = ~(bC & bP)
    # C or P shows the bare folder wherever their badges do not both cover it; under both, S has
    # its flag over nearly all of it: that whole area is filled
    hole = ~refok & (xx > 36) & (yy > 34)
    base = np.where(refok[..., None], ref, S)
    # the folder's outline: its left end per row and the axis it is mirrored about (rows where both
    # ends are bare)
    def left_end(y):
        xs_ = np.nonzero(base[y, :, 3] > 0.5)[0]
        return xs_.min() if len(xs_) else None
    axes = []
    for y in range(28, 42):
        xs_ = np.nonzero((base[y, :, 3] > 0.5))[0]
        if len(xs_) and not hole[y, xs_.max()]:
            axes.append((xs_.min() + xs_.max()) / 2.0)
    axis = float(np.median(axes))
    # each row's colour, from the bare front left of the gear
    rowcol = np.zeros((n, 4))
    for y in range(n):
        sel = (~hole[y]) & (xx[y] >= 11) & (xx[y] <= 22)
        if sel.any():
            rowcol[y] = np.median(base[y][sel], axis=0)
    # the gear: pixels darker than their row in the front, left of the badges
    gear = (~hole) & (base[..., 3] > 0.9) & (yy >= 30) & (yy <= 74) & (xx > 14) & (xx < 60) \
        & ((rowcol[:, None, :3].mean(-1) - base[..., :3].mean(-1)) > 0.06)
    gear = dilate(gear, 0) if False else gear
    gys, gxs = np.nonzero(gear)
    gtop, gbot, gleft = int(gys.min()), int(gys.max()) + 1, int(gxs.min())
    grad = (gbot - gtop) / 2.0
    gcx, gcy = gleft + grad, gtop + grad
    # the gear's own colour per row (its body is flat), for the centre the mirrors cannot reach
    gearcol = rowcol.copy()
    for y in range(n):
        sel = gear[y] & (np.abs(xx[y] - gcx) < grad - 3)
        if sel.sum() >= 2:
            gearcol[y] = np.median(base[y][sel], axis=0)
    out = base.copy()
    for y, x in zip(*np.nonzero(hole)):
        xl = left_end(y)
        xr = 2 * axis - xl if xl is not None else n
        if (x - gcx) ** 2 + (y - gcy) ** 2 <= (grad + 1.0) ** 2:
            # the gear: its left half mirrored, else turned half round, else the row
            xm = int(np.floor(2 * gcx - x - 0.5))
            # the mirror, the column next to it (the axis column mirrors onto itself), half a turn
            for xi, yi in ((xm, y), (xm - 1, y), (xm, int(np.floor(2 * gcy - y - 0.5)))):
                if 0 <= xi < n and 0 <= yi < n and not hole[yi, xi]:
                    out[y, x] = base[yi, xi]; break
            else:
                out[y, x] = gearcol[y] if (x - gcx) ** 2 + (y - gcy) ** 2 <= (grad - 4) ** 2 else rowcol[y]
        elif x >= xr - 6:
            # the outline's right end and what lies beyond it: the left end mirrored
            xi = int(np.floor(2 * axis - x - 0.5 + 0.5))
            out[y, x] = base[y, xi] if 0 <= xi < n and not hole[y, xi] else (0, 0, 0, 0) if xi < 0 else rowcol[y]
        else:
            out[y, x] = rowcol[y]
    return out, {'axis': axis, 'gear': (float(gcx), float(gcy), float(grad)), 'filled': int(hole.sum())}


def base_buttons(rom):
    A = load(os.path.join(rom, 'win/Start_Icon_Buttons.png'))
    n = A.shape[0]
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    rgb = A[..., :3]
    lum = rgb.mean(-1)
    # the orb: the dark disc top left (its flag fills in), the cards in front of / behind it
    dark = fill_holes((rgb.max(-1) < 0.35) & (A[..., 3] > 0.9) & (yy < 52) & (xx < 60))
    ys, xs = np.nonzero(dark)
    cx, cy = (xs.min() + xs.max() + 1) / 2.0, (ys.min() + ys.max() + 1) / 2.0
    R = max(xs.max() + 1 - xs.min(), ys.max() + 1 - ys.min()) / 2.0
    rr = np.hypot(xx - cx, yy - cy)
    card = ((rgb[..., 2] > rgb[..., 0] + 0.12) | (rgb[..., 0] > rgb[..., 2] + 0.2)) & (A[..., 3] > 0.3)
    card = dilate(card, 1) & (yy > cy + 0.3 * R) | (rr > R)
    flag = (lum > 0.28) & ((rgb.max(-1) - rgb.min(-1)) < 0.12) & (rr < 0.82 * R) & ~card
    flag = fill_holes(dilate(flag, 1))
    r_in = float(rr[flag].max()) + 1.0
    # the dark lines between the flag's panes are the orb itself: they stay as the fill's boundary
    gap = (lum < 0.16) & (rr < r_in) & ~card
    gap &= ~dilate((lum > 0.30) & (rr < r_in), 1)
    hole = (rr < r_in) & ~card & ~gap
    out = A.copy()
    # the rim ring left round the flag is the boundary; the orb's centre is its darkest tone
    ring = (rr >= r_in) & (rr < r_in + 1.5) & ~card
    lr = A[..., :3][ring].mean(-1)
    centre = A[..., :3][ring][np.argmin(lr)]
    fill = laplace_fill(A[..., :3], hole | card & (rr < R))
    out[..., :3] = np.where(hole[..., None], fill, out[..., :3])
    out[..., :3] = np.where((card & (rr < R))[..., None], A[..., :3], out[..., :3])
    out[..., 3] = A[..., 3]
    return out, {'orb': (float(cx), float(cy), float(R)), 'flag_r': r_in}


def rom_icon64(rom):
    """autoupdatecpl.cpl RT_ICON 5: 64 x 64, 8-bit with an AND mask"""
    d = open(os.path.join(rom, 'res/autoupdatecpl.cpl/3_5.bin'), 'rb').read()
    hs, w, h2, _pl, _bpp = struct.unpack('<IiiHH', d[:16]); h = h2 // 2
    pal = np.frombuffer(d[hs:hs + 1024], np.uint8).reshape(256, 4)
    row = (w * 8 + 31) // 32 * 4; mrow = (w + 31) // 32 * 4; off = hs + 1024
    idx = np.frombuffer(d[off:off + row * h], np.uint8).reshape(h, row)[::-1, :w]
    mb = np.unpackbits(np.frombuffer(d[off + row * h:off + row * h + mrow * h], np.uint8).reshape(h, mrow), axis=1)[::-1, :w]
    rgb = pal[idx][..., [2, 1, 0]].astype(float) / 255
    return np.dstack([rgb, (mb == 0).astype(float)])


def base_update(rom):
    A = rom_icon64(rom)
    n = A.shape[0]
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    rgb = A[..., :3]
    lum = rgb.mean(-1)
    warm = rgb[..., 0] > rgb[..., 2] + 0.12                                    # red / orange / yellow panes
    green_pane = (rgb[..., 1] > rgb[..., 2] + 0.04) & (yy < 0.45 * n) & (xx < 0.75 * n)
    light_pane = (rgb[..., 2] > 0.6) & (rgb[..., 0] > 0.25) & (xx < 0.45 * n) & (yy < 0.62 * n)
    flag = (warm | green_pane | light_pane) & (A[..., 3] > 0.5) & (xx < 0.72 * n) & (yy < 0.70 * n)
    flag = fill_holes(dilate(flag, 2)) & (A[..., 3] > 0.5)
    # the globe: a circle through its own outline away from the flag
    edge = edge_pixels(A[..., 3]) & ~dilate(flag, 3)
    cx, cy, R = circle_fit(edge)
    rr = np.hypot(xx - cx, yy - cy)
    # the flag's shadow on the globe (dark pixels next to it) goes too
    shade = (lum < 0.22) & dilate(flag, 3) & (rr < R + 1)
    hole = (flag | shade) & (rr < R + 1.5)
    hole = dilate(hole, 1) & (rr < R + 1.5)
    hole |= (rr < R + 1.5) & (A[..., 3] < 0.5)   # the disc where the ROM's 1-bit mask left it out
    inside = rr < R - 0.5
    out = A.copy()
    # smooth fill from the globe's own art, then the limb: each radius as dark as the bare globe is there
    # only the ocean is the fill's boundary: land next to the hole is freed for the fill, then kept
    land = (rgb[..., 1] > rgb[..., 2] + 0.02) & dilate(hole, 5) & ~hole
    fillm = hole | ~inside | land
    fill = laplace_fill(rgb, fillm, iters=3000)
    # the limb: the bare ocean's brightness by radius (a smooth fit), taken on only toward the edge
    ocean = inside & ~hole & (A[..., 3] > 0.5) & (rgb[..., 2] > rgb[..., 1] + 0.05)
    t = rr / R
    coef = np.polyfit(t[ocean], lum[ocean], 3)
    want = np.polyval(coef, np.clip(t, 0, 1.05))
    have = np.maximum(blur(fill.mean(-1), 1.0), 1e-3)
    w = np.clip((t - 0.65) / 0.25, 0, 1); w = w * w * (3 - 2 * w)
    k = 1 + (np.clip(want / have, 0.6, 1.4) - 1) * w
    fill = np.clip(fill * k[..., None], 0, 1)
    out[..., :3] = np.where(hole[..., None], fill, rgb)
    # a true circle (4x4 supersampled coverage) for the edge the ROM drew with a 1-bit mask
    sub = (np.arange(4) + 0.5) / 4
    cov = np.zeros((n, n))
    for sy in sub:
        for sx in sub:
            cov += np.hypot(xx - 0.5 + sx - cx, yy - 0.5 + sy - cy) <= R
    out[..., 3] = cov / 16
    return out, {'globe': (float(cx), float(cy), float(R)), 'filled': int(hole.sum())}


def upscale4(a2, out_size):
    """the @4x of a base: 4x-UltraSharp on the Ruiko worker (RGB and alpha apart), then fitted"""
    with tempfile.TemporaryDirectory() as t:
        src = os.path.join(t, 's.png'); save_quiet(a2, src)
        rgb, al = os.path.join(t, 'rgb.png'), os.path.join(t, 'a.png')
        subprocess.run(['convert', src, '-background', 'none', '(', '+clone', '-channel', 'A', '-morphology', 'Dilate', 'Disk:2', '+channel', ')', '-delete', '0', '-alpha', 'off', rgb], check=True)
        subprocess.run(['convert', src, '-alpha', 'extract', '-colorspace', 'sRGB', '-type', 'TrueColor', al], check=True)
        js = ("const fs=require('fs');process.chdir(%s);const s=JSON.parse(fs.readFileSync('secure.config.json','utf8'));"
              "const gr={getSecureConfig:({path:p})=>p.split('.').reduce((o,k)=>(o==null?o:o[k]),s)};"
              "const w=require('./modules/localUpscaleWorker.js');(async()=>{for(const p of process.argv.slice(1)){"
              "const b=await w.upscaleBufferWithLocalWorker(gr,fs.readFileSync(p),{scale:4,model:'4x-UltraSharp'});"
              "fs.writeFileSync(p+'.up.png',Buffer.isBuffer(b)?b:(b.buffer||b.imageBuffer||b.data));}process.exit(0)})()"
              ".catch(e=>{console.error(e.message);process.exit(1)})") % json.dumps(REPO)
        subprocess.run(['node', '-e', js, rgb, al], check=True, timeout=300)
        u_rgb = np.asarray(Image.open(rgb + '.up.png').convert('RGB')).astype(float) / 255
        u_a = np.asarray(Image.open(al + '.up.png').convert('L')).astype(float) / 255
        return premul_resize(np.dstack([u_rgb, u_a]), out_size, out_size)


def save_quiet(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(path)


def stage_base(rom, upscale):
    jobs = {'start-settingss': base_settingss, 'start-buttons': base_buttons, 'start-update': base_update}
    for name, fn in jobs.items():
        print(name)
        a, info = fn(rom)
        print('  measured', info)
        a2 = a if a.shape[0] == 90 else premul_resize(a, 90, 90)  # the 64 px icon, stretched as the device does
        save(a2, os.path.join(WM65, f'{name}-base@2x.png'))
        save(premul_resize(a2, 45, 45), os.path.join(WM65, f'{name}-base.png'))
        a4 = upscale4(a, 180) if upscale else premul_resize(a, 180, 180)
        save(a4, os.path.join(WM65, f'{name}-base@4x.png'))


# ---------------------------------------------------------------- compose

def logo(kind, size):
    """the logo at size x size px, its petals filling the square"""
    if kind == 'white':
        w = load(os.path.join(MEL, 'melaton-white.png'))
        n = w.shape[0]
        t = np.linspace(0, 1, n)[:, None] * np.ones((1, n))
        tone = (1.0 - 0.28 * t)[..., None] * np.ones(3)   # the ROM's white flag: white top, light grey foot
        m = np.dstack([tone, w[..., 3]])
    else:
        m = load(os.path.join(MEL, 'melaton-glass.png'))
    ys, xs = np.nonzero(m[..., 3] > 0.5)
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    side = max(m.shape[:2])
    sq = np.zeros((side, side, 4)); oy = (side - m.shape[0]) // 2; ox = (side - m.shape[1]) // 2
    sq[oy:oy + m.shape[0], ox:ox + m.shape[1]] = m
    return premul_resize(sq, size, size)


def stage_compose():
    for name, cfg in LOGO.items():
        print(name)
        for suf, k in (('', 0.5), ('@2x', 1.0), ('@4x', 2.0)):
            b = load(os.path.join(WM65, f'{name}-base{suf}.png'))
            n = b.shape[0]
            x0, y0, x1, y1 = [v * k for v in cfg['box']]
            side = max(x1 - x0, y1 - y0)
            # whole pixels for the logo's box, centred on the flag's centre (sub-pixel placement blurs it)
            size = max(4, int(round(side)))
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            lx, ly = int(round(cx - size / 2)), int(round(cy - size / 2))
            L = logo(cfg['logo'], size)
            layer = np.zeros((n, n, 4))
            sx0, sy0 = max(0, -lx), max(0, -ly)
            ex, ey = min(size, n - lx), min(size, n - ly)
            layer[ly + sy0:ly + ey, lx + sx0:lx + ex] = L[sy0:ey, sx0:ex]
            dx, dy, sig, op = cfg['shadow']
            sh = np.roll(np.roll(layer[..., 3], int(round(dy * k * 2)), 0), int(round(dx * k * 2)), 1)
            shadow = np.dstack([np.zeros((n, n, 3)), blur(sh, sig * k * 2) * op])
            out = over(over(b, shadow), layer)
            if cfg['logo'] == 'white':
                out[..., 3] = b[..., 3]   # inside the orb only
            save(out, os.path.join(WM65, f'{name}{suf}.png'))


if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or args[0] not in ('base', 'compose'):
        print(__doc__); sys.exit(2)
    rom = os.path.expanduser('~/.cache/wm65/dump')
    if '--rom' in args:
        rom = os.path.expanduser(args[args.index('--rom') + 1])
    if args[0] == 'base':
        stage_base(rom, '--no-upscale' not in args)
    else:
        stage_compose()
