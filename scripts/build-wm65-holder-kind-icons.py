#!/usr/bin/env python3
"""
The notification holder's pictures per notification KIND (StaticForge #1056, Yukimi Nov 22 2026): in 6.5's "..." holder and
6.5.1's drawer, several notices of one app showed the same app icon. Each kind gets its own large colour picture
(public/scripts/tasks/status-order.js holderKinds), written as public/static_images/wm65/holder-<kind>.png / @2x / @4x
(32 / 64 / 128 px, as the holder's other pictures).

ROM art first: the Titanium (6.5 Today) panel icons from the ROM's CHome resources (~/.cache/wm65/rsrc/chome, dumped per
memory wm65-emulator-harness: 86 or 64 px squares with the panel's reflection under them, cut off here):
  10_2701 missed call, 10_IDB_WELCOMECENTER_CALL call, 10_2207 Outlook meeting request, 10_2500 alarm clock,
  10_2506 package with an error (install failed), 10_2508 package (download / progress), 10_2007 text bubbles,
  10_2008 e-mail, 10_2503 key, 10_2051 clock.
Where no ROM picture says the kind, the ROM's own pieces are combined: the program's Start icon with a message box badge
(wm61/msgbox-error / -warning / -info, the ROM's) for "failed" / "needs attention", or the kind's ROM picture with the
program's Start icon as a small badge (which app it is from, as the issue asks).

@4x: the ROM square upscaled 4x with 4x-UltraSharp on the Ruiko GPU worker (modules/localUpscaleWorker.js, as #1026's
drawer icons), fitted to 128; @2x / 1x: premultiplied area (box) resizes of the @4x. --no-upscale: plain resize.
Run: ~/.cache/claude-run/venv/bin/python scripts/build-wm65-holder-kind-icons.py [--no-upscale]
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(REPO, 'public/static_images')
OUT = os.environ.get('HOLDER_OUT') or os.path.join(IMG, 'wm65')
CHOME = os.path.expanduser(os.environ.get('WM65_CHOME') or '~/.cache/wm65/rsrc/chome')

# kind -> (ROM Titanium icon id) or a composite: ('badge', base, badge)
#   base / badge: 'rom:<id>' (a Titanium icon) or '<dir>/<name>' (our @4x file)
JOBS = {
    'call-missed': 'rom:10_2701',
    'call': 'rom:10_IDB_WELCOMECENTER_CALL',
    'meeting': 'rom:10_2207',
    'alarm': 'rom:10_2500',
    'update-failed': 'rom:10_2506',
    'progress': 'rom:10_2508',
    'message': 'rom:10_2007',
    'email': 'rom:10_2008',
    'voicemail': ('badge', 'rom:10_IDB_WELCOMECENTER_CALL', 'rom:10_2008'),
    'mail-error': ('badge', 'wm65/start-msg', 'wm61/msgbox-error'),
    'sms-error': ('badge', 'wm65/start-sms', 'wm61/msgbox-error'),
    'print-error': ('badge', 'wm65/start-photos', 'wm61/msgbox-error'),
    'emotion-error': ('badge', 'wm61/app-emotion-lg', 'wm61/msgbox-error'),
    'api-key': ('badge', 'wm61/app-accounts-lg', 'wm61/msgbox-warning'),
    'lapis-health': ('badge', 'wm65/start-lapis', 'wm61/msgbox-warning'),
    'lapis-failed': ('badge', 'wm65/start-lapis', 'wm61/msgbox-error'),
    'lapis-fuel': ('badge', 'wm65/start-lapis', 'wm61/msgbox-info'),
    'lapis-unlocked': ('badge', 'rom:10_2503', 'wm65/start-lapis'),
    'lapis-run-left': ('badge', 'rom:10_2051', 'wm65/start-lapis'),
    'lapis-service': ('badge', 'wm65/start-tasks', 'wm65/start-lapis'),
    # the Car (the status bar's car glyph: a car key in range, a remote start, a commute running late). Yukimi, Nov 23
    # 2026: "that one needs to be converted from being the traffic icon to a car icon" - it showed Traffic's road and
    # traffic light. The car's own picture (lapis/car.webp, generate-wm-lapis-art.js), fitted to the square
    'car': ('fit', 'lapis/car.webp'),
    # weather (Yukimi, Nov 22 2026: "we need a icon for rain detect and for severe and regular weather alert"): the
    # Titanium weather panel's own rain and storm pictures (ROM, wm65/ti-wx-*), the alerts badged as the message boxes are
    'rain-alarm': ('badge', 'wm65/ti-wx-rain', 'wm61/app-weather-lg'),
    'weather-alert': ('badge', 'wm61/app-weather-lg', 'wm61/msgbox-warning'),
    'weather-severe': ('badge', 'wm65/ti-wx-storm', 'wm61/msgbox-error'),
}
S4 = 128          # the @4x side
BADGE = 64        # the badge's side at @4x (half the picture), in the bottom right corner
UPSCALE = '--no-upscale' not in sys.argv


def load(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(float) / 255


def premul_resize(a, w, h):
    """area resize with premultiplied alpha (no dark fringes)"""
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4]
    chans = []
    for c in range(4):
        ch = Image.fromarray((pm[..., c] * 255 + 0.5).clip(0, 255).astype(np.uint8), 'L').resize((w, h), Image.LANCZOS if w > pm.shape[1] else Image.BOX)
        chans.append(np.asarray(ch).astype(float) / 255)
    out = np.dstack(chans)
    al = out[..., 3:4]
    out[..., :3] = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    return np.clip(out, 0, 1)


def rom_square(name):
    """a Titanium panel icon without its reflection: the top square, rows from where the reflection starts cleared"""
    a = load(os.path.join(CHOME, name + '.png'))
    h, w = a.shape[:2]
    rows = a[..., 3].max(axis=1)
    cut = w
    # the reflection: under the icon's solid base the rows fall below ~0.78 alpha and fade out
    for y in range(int(w * 0.6), min(h, w + 2)):
        if rows[y] < 0.78:
            cut = y
            break
    sq = np.zeros((w, w, 4))
    sq[:min(cut, w)] = a[:min(cut, w)]
    return sq


def upscale4(a, out_size):
    """4x-UltraSharp on the Ruiko worker (RGB and alpha apart, as build-wm65-flower-icons.py), then fitted"""
    if not UPSCALE:
        return premul_resize(a, out_size, out_size)
    with tempfile.TemporaryDirectory() as t:
        src = os.path.join(t, 's.png')
        Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(src)
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


_cache = {}


def at4(ref, size=S4):
    """a source at @4x: a ROM icon (upscaled) or our own @4x file, fitted to size"""
    key = (ref, size)
    if key in _cache:
        return _cache[key]
    if ref.startswith('rom:'):
        base = _cache.get((ref, 'up'))
        if base is None:
            base = upscale4(rom_square(ref[4:]), S4)
            _cache[(ref, 'up')] = base
        a = base if size == S4 else premul_resize(base, size, size)
    else:
        a = premul_resize(load(os.path.join(IMG, ref + '@4x.png')), size, size)
    _cache[key] = a
    return a


def over(dst, src, x, y):
    """src over dst at (x, y), straight alpha"""
    h, w = src.shape[:2]
    d = dst[y:y + h, x:x + w]
    sa = src[..., 3:4]
    da = d[..., 3:4]
    oa = sa + da * (1 - sa)
    oc = np.where(oa > 1e-4, (src[..., :3] * sa + d[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-4), 0)
    dst[y:y + h, x:x + w] = np.dstack([oc, oa])


def shadow(a, blur=3, alpha=0.45, dx=1, dy=2):
    """a soft drop shadow of a badge (so it reads on the picture under it)"""
    im = Image.fromarray((a[..., 3] * 255).astype(np.uint8), 'L')
    from PIL import ImageFilter
    sh = np.asarray(im.filter(ImageFilter.GaussianBlur(blur))).astype(float) / 255 * alpha
    out = np.zeros_like(a)
    out[..., 3] = np.roll(np.roll(sh, dy, axis=0), dx, axis=1)
    return out


def save(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(path, optimize=True)


def fit_picture(ref, side=S4, room=0.94):
    """one of our own pictures (any size), its empty margin cut off, fitted to the square and centred"""
    a = load(os.path.join(IMG, ref))
    ys, xs = np.where(a[..., 3] > 0.02)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = a.shape[:2]
    k = side * room / max(w, h)
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    canvas = np.zeros((side, side, 4))
    over(canvas, premul_resize(a, nw, nh), (side - nw) // 2, (side - nh) // 2)
    return canvas


def build(kind, job):
    if isinstance(job, tuple) and job[0] == 'fit':
        a4 = fit_picture(job[1])
    elif isinstance(job, tuple):
        _, base, badge = job
        a = at4(base).copy()
        b = at4(badge, BADGE)
        canvas = np.zeros((S4 + 8, S4 + 8, 4))
        over(canvas, a, 0, 0)
        x = y = S4 - BADGE
        over(canvas, shadow(b), x, y)
        over(canvas, b, x, y)
        a4 = canvas[:S4, :S4]
    else:
        a4 = at4(job)
    save(a4, os.path.join(OUT, f'holder-{kind}@4x.png'))
    save(premul_resize(a4, 64, 64), os.path.join(OUT, f'holder-{kind}@2x.png'))
    save(premul_resize(a4, 32, 32), os.path.join(OUT, f'holder-{kind}.png'))
    print(kind, 'ok')


if __name__ == '__main__':
    only = [k for k in sys.argv[1:] if not k.startswith('--')]
    for k, j in JOBS.items():
        if not only or k in only:
            build(k, j)
