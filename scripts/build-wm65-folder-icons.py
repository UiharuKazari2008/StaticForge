#!/usr/bin/env python3
"""
Melaton Mobile folder icons (Yozora #805 follow-up), built from the clean 6.5 Settings folder art.

  python3 scripts/build-wm65-folder-icons.py        (run build-wm65-flower-icons.py base first)

Writes to public/static_images/wm65 (WM65_OUT overrides):
  start-folder{,@2x,@4x}             the plain 6.5 folder: start-settingss-base (SettingsC's folder,
                                     its gear rebuilt) with the gear taken out; each row of the front
                                     is one colour (a vertical gradient), so the gear's disc takes
                                     its row's colour. The base of every folder below, and the icon
                                     of folders the user makes.
  start-folder-<name>{,@2x,@4x}      the plain folder with the folder's 3D emblem object standing in
                                     front of it where the ROM's badges sit (no badge body, no square),
                                     casting a soft shadow (masters: scripts/art/wm65-folder-emblems):
                                       dreamscape  the Dreamscape Enso (static_images/logo_icon.png)
                                       android     the Android robot's head
                                       work        an office building (the 6.1 Work folder's emblem)
  and to public/static_images/wm61 (WM61_OUT overrides):
  app-folder{,@2x,@4x}, app-folder-lg{,@2x,@4x}
                                     6.1's own plain folder: shellres.192.dll icon 8208 (32 and 64 px
                                     frames; the 128 px is the 64 px upscaled 2x, Lanczos)

@2x is built from the ROM's 90 px art, @4x from the @4x files of the same art, 1x is the @2x halved.
Needs numpy + Pillow (e.g. ~/.cache/claude-run/venv/bin/python).
"""
import importlib.util, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('flower', os.path.join(HERE, 'build-wm65-flower-icons.py'))
F = importlib.util.module_from_spec(spec); spec.loader.exec_module(F)
load, save, premul_resize, over, blur, dilate, fill_holes, laplace_fill = (
    F.load, F.save, F.premul_resize, F.over, F.blur, F.dilate, F.fill_holes, F.laplace_fill)

REPO = F.REPO
WM65 = os.path.join(REPO, 'public/static_images/wm65')
OUT65 = os.environ.get('WM65_OUT') or WM65
OUT61 = os.environ.get('WM61_OUT') or os.path.join(REPO, 'public/static_images/wm61')
ROM = os.path.expanduser('~/.cache/wm65/dump')
ROM61 = os.path.expanduser('~/.cache/wm61/work/grp2/shellres.192.dll')

# the gear on SettingsC's folder (90 px grid, measured by build-wm65-flower-icons.py: centre and radius)
GEAR = (43.0, 53.0, 16.0)


def rowcolour(a, k):
    """each row's front colour, from the plain front left of the gear (columns 11..22 at @2x)"""
    n = a.shape[0]
    x0, x1 = int(round(11 * k)), int(round(22 * k))
    out = np.zeros((n, 4))
    for y in range(n):
        seg = a[y, x0:x1]
        seg = seg[seg[:, 3] > 0.99]
        out[y] = np.median(seg, axis=0) if len(seg) else a[y, x0]
    return out


def gearless(a, k):
    """the folder with its gear taken out: the gear's disc in each row's own front colour"""
    n = a.shape[0]
    gx, gy, gr = (v * k for v in GEAR)
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    r = np.hypot(xx - gx, yy - gy)
    edge = gr + 2.5 * k
    w = np.clip((edge + 0.5 * k - r) / k, 0, 1)        # 1 inside the disc, a k-px soft rim
    rc = rowcolour(a, k)[:, None, :]
    out = a * (1 - w[..., None]) + rc * w[..., None]
    out[..., 3] = a[..., 3]
    return out


def badge_mask(a):
    m = (a[..., 2] > a[..., 0] + 0.05) & (a[..., 3] > 0.3)
    n = a.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    m &= (xx > 0.4 * n) & (yy > 0.38 * n)
    return fill_holes(m)


def blank_badge(P, core, glyph=None):
    """SettingsP's badge without its person: the glyph (white / grey, and its light edge) filled
    from the blue round it (glyph: the mask found at @2x, for the @4x copy)"""
    rgb = P[..., :3]
    lum, sat = rgb.mean(-1), (rgb.max(-1) - rgb.min(-1)) / np.maximum(rgb.max(-1), 1e-3)
    if glyph is None:
        glyph = core & (lum > 0.70) & (sat < 0.22)
        glyph = dilate(fill_holes(glyph), 1) & core
    inner = core & ~dilate(~core, 2)                  # keep the badge's own rim lines
    hole = glyph & inner
    fill = laplace_fill(rgb, hole | ~core, iters=3000)
    out = P.copy()
    out[..., :3] = np.where(hole[..., None], fill, rgb)
    return out, glyph


def glyph_master(name, size=512):
    """the emblem's shape, white on transparent, filling a size x size square (alpha only)"""
    if name == 'dreamscape':
        a = load(os.path.join(REPO, 'public/static_images/logo_icon.png'))
        m = a[..., 3] * (a[..., :3].mean(-1) > 0.5)
        ys, xs = np.nonzero(m > 0.5)
        m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        im = Image.fromarray((m * 255).astype(np.uint8), 'L')
        side = max(im.size)
        sq = Image.new('L', (side, side), 0); sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
        return np.asarray(sq.resize((size, size), Image.LANCZOS)).astype(float) / 255
    S = 4 * size
    im = Image.new('L', (S, S), 0); d = ImageDraw.Draw(im)
    u = S / 512.0
    if name == 'android':
        # the robot's head: a half disc, two antennas, two eyes
        cx, base, R = 256 * u, 380 * u, 205 * u
        d.pieslice([cx - R, base - R, cx + R, base + R], 180, 360, fill=255)
        for sgn in (-1, 1):
            x0, y0 = cx + sgn * 105 * u, base - 165 * u
            x1, y1 = cx + sgn * 160 * u, base - 265 * u
            d.line([x0, y0, x1, y1], fill=255, width=int(26 * u))
            d.ellipse([x1 - 13 * u, y1 - 13 * u, x1 + 13 * u, y1 + 13 * u], fill=255)
            ex, ey, er = cx + sgn * 92 * u, base - 92 * u, 26 * u
            d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=0)
    elif name == 'work':
        # an office building: a tower and a lower wing, rows of windows, a door
        d.rectangle([128 * u, 40 * u, 318 * u, 472 * u], fill=255)
        d.rectangle([318 * u, 196 * u, 404 * u, 472 * u], fill=255)
        for row in range(7):
            y = (78 + row * 52) * u
            for col in range(3):
                x = (150 + col * 56) * u
                d.rectangle([x, y, x + 34 * u, y + 30 * u], fill=0)
        for row in range(4):
            y = (230 + row * 52) * u
            d.rectangle([340 * u, y, 382 * u, y + 30 * u], fill=0)
        d.rectangle([200 * u, 410 * u, 246 * u, 472 * u], fill=0)
    m = np.asarray(im.resize((size, size), Image.LANCZOS)).astype(float) / 255
    ys, xs = np.nonzero(m > 0.5)
    m = m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    im = Image.fromarray((m * 255).astype(np.uint8), 'L')
    side = max(im.size)
    sq = Image.new('L', (side, side), 0); sq.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
    return np.asarray(sq.resize((size, size), Image.LANCZOS)).astype(float) / 255


def glyph_layer(name, n, box, top, bottom, glow, k):
    """the emblem fitted in box (x0, y0, x1, y1), shaded top -> bottom, with a light edge"""
    x0, y0, x1, y1 = box
    side = max(4, int(round(min(x1 - x0, y1 - y0))))
    m = glyph_master(name)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8), 'L').resize((side, side), Image.LANCZOS)).astype(float) / 255
    lx = int(round((x0 + x1) / 2 - side / 2)); ly = int(round((y0 + y1) / 2 - side / 2))
    alpha = np.zeros((n, n)); alpha[ly:ly + side, lx:lx + side] = m
    t = np.clip((np.arange(n)[:, None] - ly) / max(1, side - 1), 0, 1) * np.ones((1, n))
    rgb = top[None, None, :] * (1 - t[..., None]) + bottom[None, None, :] * t[..., None]
    g = np.clip(blur(alpha, 0.6 * k) * 1.6, 0, 1) * 0.45
    halo = np.dstack([np.ones((n, n, 3)) * glow, g])
    return over(halo, np.dstack([rgb, alpha]))


# The folders' emblems are 3D objects standing in front of the folder (Yukimi, Nov 13: "3d objects",
# no squares, not flat): glossy renders made once with GPT Image 2.5 (TokenRouter; the ROM's SettingsC /
# SettingsP as style references, the Dreamscape logo as the ring's shape), kept as 512 px masters in
# scripts/art/wm65-folder-emblems/<name>.png (trimmed, centred in a square, transparent).
EMBLEMS = os.path.join(HERE, 'art', 'wm65-folder-emblems')
EMBLEM = {'dreamscape': None, 'android': None, 'work': None}


def emblem_layer(name, n, box, k):
    x0, y0, x1, y1 = box
    side = max(4, int(round(min(x1 - x0, y1 - y0))))
    src = load(os.path.join(EMBLEMS, f'{name}.png'))
    m = premul_resize(src, side, side)
    lx = int(round((x0 + x1) / 2 - side / 2)); ly = int(round(y1 - side))
    lay = np.zeros((n, n, 4))
    sx0, sy0 = max(0, -lx), max(0, -ly)
    ex, ey = min(side, n - lx), min(side, n - ly)
    lay[ly + sy0:ly + ey, lx + sx0:lx + ex] = m[sy0:ey, sx0:ex]
    return lay


def folders():
    for suf, k in (('@2x', 1.0), ('@4x', 2.0)):
        gb = load(os.path.join(WM65, f'start-settingss-base{suf}.png'))
        gl = gearless(gb, k)
        save(gl, os.path.join(OUT65, f'start-folder{suf}.png'))
        if k == 1.0:
            save(premul_resize(gl, 45, 45), os.path.join(OUT65, 'start-folder.png'))
        # where the ROM puts a folder's badge: SettingsP's badge, aligned to SettingsC (1 px right at @2x)
        P = load(os.path.join(ROM, 'win/Start_Icon_SettingsP.png')) if k == 1.0 else load(os.path.join(WM65, 'start-settingsp@4x.png'))
        P = np.roll(P, -int(round(k)), 1)
        core = badge_mask(P)
        n_ = P.shape[0]
        bys, bxs = np.nonzero(core)
        bcx, bcy = (bxs.min() + bxs.max() + 1) / 2, (bys.min() + bys.max() + 1) / 2
        # in front of the folder as the badges stand: as big as a badge and a bit more, resting on the
        # badge's bottom line, overhanging the folder's edges (Yukimi: 3D items in front of the folder)
        h = (bys.max() + 1 - bys.min()) * 1.25
        bottom_y = min(n_ - 1, bys.max() + 2 * k)
        box = (bcx - h / 2, bottom_y - h, bcx + h / 2, bottom_y)
        print(f'  {suf}: emblem box centre {bcx},{bcy} side {h:.1f}')
        n = gl.shape[0]
        for name in EMBLEM:
            lay = emblem_layer(name, n, box, k)
            # its shadow falls on the folder and past it, as the badges' do (not clipped to the folder)
            sh = np.roll(np.roll(lay[..., 3], int(round(1.5 * k)), 0), int(round(0.8 * k)), 1)
            shadow = np.dstack([np.zeros((n, n, 3)), blur(sh, 1.6 * k) * 0.55])
            out = over(over(gl, shadow), lay)
            out[..., 3] = np.maximum(gl[..., 3], lay[..., 3])
            save(out, os.path.join(OUT65, f'start-folder-{name}{suf}.png'))
            if k == 1.0:
                save(premul_resize(out, 45, 45), os.path.join(OUT65, f'start-folder-{name}.png'))


def folder61():
    a32 = load(os.path.join(ROM61, 'ico_8208_0_32x32.png'))
    a64 = load(os.path.join(ROM61, 'ico_8208_1_64x64.png'))
    a128 = premul_resize(a64, 128, 128)
    for name, arr in (('app-folder.png', premul_resize(a32, 16, 16)), ('app-folder@2x.png', a32), ('app-folder@4x.png', a64),
                      ('app-folder-lg.png', a32), ('app-folder-lg@2x.png', a64), ('app-folder-lg@4x.png', a128)):
        save(arr, os.path.join(OUT61, name))


if __name__ == '__main__':
    os.makedirs(OUT65, exist_ok=True); os.makedirs(OUT61, exist_ok=True)
    print('6.5 folders'); folders()
    print('6.1 folder'); folder61()
