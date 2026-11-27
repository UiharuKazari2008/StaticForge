#!/usr/bin/env python3
"""Rips the console's 'Terminal' raster fonts off the Vista VM into pixel-exact woff2 web fonts (Yozora #1342 part 4).

A fresh Vista cmd.exe uses Raster Fonts 8x12 (face 'Terminal'). Those are Windows 3.x bitmap fonts in .fon files
(NE executables whose RT_FONT resources are FNT 2.0 bitmap fonts), OEM character set = code page 437. This reads
the .fon files, takes the ten sizes the console's Font tab lists (4x6, 6x8, 8x8, 16x8, 5x12, 7x12, 8x12, 16x12,
12x16, 10x18) and turns each into a TrueType font whose glyphs are the bitmap's black pixels as square outlines:
one pixel = SCALE font units, the em square = the cell height, the advance = the cell width. Drawn at
font-size = <cell height> px with line-height = <cell height> px (and letter-spacing 0, text at whole-pixel
positions) every pixel lands exactly on a screen pixel, so a row of text is the console's own bitmap.

Where each size lives (C:\\Windows\\Fonts, found by reading every *.fon on the VM; the OS's own table for the
console is HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Console\\RasterFonts + dosapp.fon):
    dosapp.fon   4x6  6x8  5x12  7x12  12x16  10x18      (the VGA text sizes at 96 dpi)
    vgaoem.fon   8x12                                      (the default size)
    cga80woa.fon 8x8       cga40woa.fon 16x8       ega40woa.fon 16x12   (the double-wide ones)
8x12 also exists in ega80woa.fon (96x72 dpi, 3 glyphs differ); --src812 picks which one the console draws.

Glyph map: byte -> Unicode through code page 437 (Python's cp437 codec for 0x20-0x7E and 0x80-0xFF); 0x01-0x1F
and 0x7F are the console's graphic glyphs (U+263A smiley ... U+25BC, U+2302), the ones a console draws for those
bytes. A few best-fit aliases (U+00A0 as space, Greek mu/beta/Omega) are added. Nothing is hand-typed bitmap data:
every glyph comes from the .fon.

The glyph art is the OS vendor's (.fon files carry "Copyright (C) Microsoft Corp 1991"): like the Consolas and
Lucida Console woff2 beside them (scripts/build-vista-webfonts.sh) the output lives under public/protected/fonts/vista
(signed-in sessions only, never in the install pack), and the family names are neutral ("Melaton Terminal 8x12").

Usage:
    ~/.cache/vista-vm/fonttools-venv/bin/python -I scripts/build-vista-raster-fonts.py [--fon-dir DIR] [--out DIR]
        [--sizes 8x12,10x18,...] [--src812 vgaoem|ega80woa] [--info]
    --fon-dir  directory holding the .fon files; when a file is missing it is fetched from the VM with
               ~/.config/vista-vm/vm.sh get 'C:\\Windows\\Fonts\\<file>' (default ~/.cache/vista-vm/cmd1342/raster/fon)
    --out      default public/protected/fonts/vista (files melaton-terminal-<W>x<H>.woff2)
    --sizes    default: all ten
    --info     only list every FNT in the files (size, character set, glyph range) and write nothing
fontTools and brotli come from the venv scripts/build-vista-webfonts.sh makes under ~/.cache/vista-vm/fonttools-venv.
"""
import argparse
import os
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCALE = 64          # font units per screen pixel; em = cell height * SCALE (a TrueType em must be >= 16 units)
CHARSET_OEM = 255

# size (cell width x height) -> .fon file; "8x12" is overridden by --src812
SOURCES = {
    '4x6': 'dosapp.fon', '6x8': 'dosapp.fon', '5x12': 'dosapp.fon', '7x12': 'dosapp.fon',
    '12x16': 'dosapp.fon', '10x18': 'dosapp.fon',
    '8x12': 'vgaoem.fon', '8x8': 'cga80woa.fon', '16x8': 'cga40woa.fon', '16x12': 'ega40woa.fon',
}
ALL_SIZES = ['4x6', '6x8', '8x8', '16x8', '5x12', '7x12', '8x12', '16x12', '12x16', '10x18']

# cp437 graphic glyphs of bytes 0x01-0x1F (0x7F is U+2302)
LOW_GRAPHICS = '\u263a\u263b\u2665\u2666\u2663\u2660\u2022\u25d8\u25cb\u25d9\u2642\u2640\u266a\u266b\u263c' \
               '\u25ba\u25c4\u2195\u203c\u00b6\u00a7\u25ac\u21a8\u2191\u2193\u2192\u2190\u221f\u2194\u25b2\u25bc'
# best-fit aliases a console accepts for the same byte: code point -> byte
ALIASES = {0x00a0: 0x20, 0x03b2: 0xe1, 0x03bc: 0xe6, 0x2126: 0xea}


def fnt_resources(path):
    """The RT_FONT (0x8008) resources of an NE .fon file."""
    d = open(path, 'rb').read()
    ne = struct.unpack_from('<I', d, 0x3c)[0]
    if d[ne:ne + 2] != b'NE':
        raise ValueError(path + ': not an NE executable')
    rt = ne + struct.unpack_from('<H', d, ne + 0x24)[0]
    shift = struct.unpack_from('<H', d, rt)[0]
    pos, out = rt + 2, []
    while True:
        rtype = struct.unpack_from('<H', d, pos)[0]
        if rtype == 0:
            break
        count = struct.unpack_from('<H', d, pos + 2)[0]
        pos += 8
        for _ in range(count):
            off, length = struct.unpack_from('<HH', d, pos)
            pos += 12
            if rtype == 0x8008:
                out.append(d[off << shift:(off << shift) + (length << shift)])
    return out


def parse_fnt(f):
    """Header fields and the glyph bitmaps {byte: [row ints, MSB = leftmost pixel]} of a FNT 2.0 bitmap font."""
    version = struct.unpack_from('<H', f, 0)[0]
    if version != 0x0200:
        raise ValueError('FNT version 0x%04x (only 2.0 is used by the console fonts)' % version)
    u16 = lambda o: struct.unpack_from('<H', f, o)[0]
    h = {'pts': u16(68), 'vres': u16(70), 'hres': u16(72), 'asc': u16(74), 'charset': f[85], 'pw': u16(86),
         'ph': u16(88), 'first': f[95], 'last': f[96], 'default': f[97]}
    face = struct.unpack_from('<I', f, 105)[0]
    h['face'] = f[face:f.index(b'\0', face)].decode('latin1')
    h['copyright'] = f[6:66].split(b'\0')[0].decode('latin1')
    ph, glyphs = h['ph'], {}
    for i in range(h['last'] - h['first'] + 1):
        width, off = struct.unpack_from('<HH', f, 118 + 4 * i)
        nb = (width + 7) // 8
        rows = [0] * ph
        for c in range(nb):                       # column-major: byte column c, then every row
            for r in range(ph):
                rows[r] |= f[off + c * ph + r] << (8 * (nb - 1 - c))
        glyphs[h['first'] + i] = (width, [row >> (nb * 8 - width) for row in rows])
    return h, glyphs


def find_font(path, pw, ph, charset=CHARSET_OEM):
    found = []
    for raw in fnt_resources(path):
        h, g = parse_fnt(raw)
        if h['pw'] == pw and h['ph'] == ph and h['charset'] == charset:
            found.append((h, g))
    if len(found) != 1:
        raise SystemExit('%s: expected exactly one %dx%d OEM face, found %d' % (path, pw, ph, len(found)))
    return found[0]


def rectangles(rows, width):
    """Black pixels as (x0, y0, x1, y1) rectangles: per-row runs, equal runs of neighbouring rows joined."""
    done, open_runs = [], {}
    for y, bits in enumerate(rows + [0]):
        runs, x = [], 0
        while x < width:
            if bits >> (width - 1 - x) & 1:
                x0 = x
                while x < width and bits >> (width - 1 - x) & 1:
                    x += 1
                runs.append((x0, x))
            else:
                x += 1
        nxt = {}
        for run in runs:
            nxt[run] = open_runs.pop(run, y)
        for run, y0 in open_runs.items():
            done.append((run[0], y0, run[1], y))
        open_runs = nxt
    return done


def byte_to_unicode(b):
    if b == 0:
        return None
    if b <= 0x1f:
        return ord(LOW_GRAPHICS[b - 1])
    if b == 0x7f:
        return 0x2302
    return ord(bytes([b]).decode('cp437'))


def build_font(size, header, glyphs, out_path):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    pw, ph, asc = header['pw'], header['ph'], header['asc']
    em, adv = ph * SCALE, pw * SCALE
    order = ['.notdef'] + ['c%02x' % b for b in range(256)]
    cmap, built = {}, {}
    for b in range(256):
        width, rows = glyphs.get(b, (pw, [0] * ph))
        pen = TTGlyphPen(None)
        for x0, y0, x1, y1 in rectangles(rows, width or pw):
            # row y spans font y (asc - y - 1) .. (asc - y) pixels above the baseline; clockwise = outer contour
            left, right = x0 * SCALE, x1 * SCALE
            top, bottom = (asc - y0) * SCALE, (asc - y1) * SCALE
            pen.moveTo((left, bottom))
            pen.lineTo((left, top))
            pen.lineTo((right, top))
            pen.lineTo((right, bottom))
            pen.closePath()
        built['c%02x' % b] = pen.glyph()
        u = byte_to_unicode(b)
        if u is not None:
            cmap[u] = 'c%02x' % b
    for code, b in ALIASES.items():
        cmap.setdefault(code, 'c%02x' % b)
    cmap[0x20] = 'c20'
    built['.notdef'] = TTGlyphPen(None).glyph()
    fb = FontBuilder(em, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(built)
    fb.setupHorizontalMetrics({n: (adv, built[n].xMin if built[n].numberOfContours else 0) for n in order})
    fb.setupHorizontalHeader(ascent=asc * SCALE, descent=-(ph - asc) * SCALE, lineGap=0)
    name = 'Melaton Terminal %s' % size
    fb.setupNameTable({'familyName': name, 'styleName': 'Regular',
                       'copyright': 'Console raster glyph art from the Vista VM (%s, %s %dx%d)' % (
                           header['_file'], header['face'], pw, ph),
                       'description': 'Pixel-exact outlines of the console raster font: 1 px = %d units, em = %d px' % (SCALE, ph)})
    fb.setupOS2(sTypoAscender=asc * SCALE, sTypoDescender=-(ph - asc) * SCALE, sTypoLineGap=0,
                usWinAscent=asc * SCALE, usWinDescent=(ph - asc) * SCALE, fsType=0, fsSelection=0x40 | 0x80, version=4,
                xAvgCharWidth=adv, achVendID='MLTN')
    fb.setupPost(isFixedPitch=1, underlinePosition=-SCALE, underlineThickness=SCALE)
    fb.font['head'].flags |= 0x0001 | 0x0002     # baseline at y=0, lsb at x=0
    fb.font['head'].created = fb.font['head'].modified = 0xDB0B0000   # fixed, so a rebuild is byte-identical
    fb.font.flavor = 'woff2'
    fb.save(out_path)
    return len(cmap)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--fon-dir', default=os.path.expanduser('~/.cache/vista-vm/cmd1342/raster/fon'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'public', 'protected', 'fonts', 'vista'))
    ap.add_argument('--sizes', default=','.join(ALL_SIZES))
    ap.add_argument('--src812', default='vgaoem', choices=['vgaoem', 'ega80woa'])
    ap.add_argument('--info', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.fon_dir, exist_ok=True)
    SOURCES['8x12'] = args.src812 + '.fon'

    def local(fon):
        path = os.path.join(args.fon_dir, fon)
        if not os.path.exists(path):
            subprocess.run([os.path.expanduser('~/.config/vista-vm/vm.sh'), 'get', 'C:\\Windows\\Fonts\\' + fon, path],
                           check=True, stdout=subprocess.DEVNULL)
        return path

    if args.info:
        for fon in sorted(set(SOURCES.values()) | {'ega80woa.fon'}):
            for raw in fnt_resources(local(fon)):
                h, g = parse_fnt(raw)
                print('%-12s %-9s %2dx%-2d asc %-2d dpi %dx%d charset %d chars %d-%d' % (
                    fon, h['face'], h['pw'], h['ph'], h['asc'], h['hres'], h['vres'], h['charset'], h['first'], h['last']))
        return
    os.makedirs(args.out, exist_ok=True)
    for size in args.sizes.split(','):
        pw, ph = (int(v) for v in size.split('x'))
        fon = SOURCES[size]
        header, glyphs = find_font(local(fon), pw, ph)
        header['_file'] = fon
        out = os.path.join(args.out, 'melaton-terminal-%s.woff2' % size)
        mapped = build_font(size, header, glyphs, out)
        print('%s  %s %dx%d asc %d  %d code points  %d bytes' % (os.path.basename(out), fon, pw, ph, header['asc'],
                                                               mapped, os.path.getsize(out)))


if __name__ == '__main__':
    main()
