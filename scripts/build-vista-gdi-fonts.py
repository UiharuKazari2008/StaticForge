#!/usr/bin/env python3
"""Vista's Segoe UI, Tahoma and Microsoft Sans Serif with GDI's advance widths at every pixel size (public/css/vista-fonts.css).

Vista lays out dialog text with GDI, which advances each glyph by its HINTED width at the font's pixel size: a
whole number of pixels, different from the outline's own width (Tahoma 8 pt "Always use the selected program to
open this kind of file" is 271 px on the Vista VM, 275.8 px in Chrome; long MS Shell Dlg statics ran up to 21 px
wider and wrapped a word early). Chrome on every platform (the Fold's WebView too) places glyphs at the outline's
linear widths, and kerns with the font's legacy 'kern' table, which GDI never applies.

This adds an 'opsz' axis (6..70 px, default 70) whose deltas turn each glyph's advance at size N px into GDI's
width at N px (GetCharWidthI on the VM for lfHeight -N, every glyph index; ClearType and plain antialiasing give
the same widths), and drops the 'kern' table. Outlines, hinting and the other tables are unchanged. The deltas
go in twice, as the two renderers read them: HVAR (FreeType: Android, Linux) and the advance phantom point in
gvar (DirectWrite: Chrome on Windows ignores HVAR). Chrome sets 'opsz' to the CSS font size by itself
(font-optical-sizing: auto), so 11 px Tahoma advances as GDI's Tahoma 8 pt and 12 px Segoe UI as Segoe UI 9 pt at
any device pixel ratio; between whole sizes the widths blend, from 70 px up they are the outline's.

Input:  public/protected/fonts/vista/<face>.woff2 (scripts/build-vista-webfonts.sh) and the VM's widths in
        ~/.cache/vista-vm/gdi-advances/<face>.txt, one line per size "<px> <tmHeight> <tmAscent> <w0>,<w1>,..."
        (C:\\agent\\gdiadv.exe "<face>" <weight> <italic 0|1> 0 6 69 <out>; source ~/.cache/vista-vm/tools/gdiadv.cs).
Output: public/protected/fonts/vista/<face>-gdi<N>.woff2. A kept font is never fetched again (sw.js
        handleProtectedFont), so a rebuild must take the next N and vista-fonts.css must name it.

Usage: ~/.cache/vista-vm/fonttools-venv/bin/python -I scripts/build-vista-gdi-fonts.py [N] [outdir] [face ...]
"""
import math
import os
import sys

from fontTools.otlLib.builder import buildStatTable
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables import otTables as ot
from fontTools.ttLib.tables._f_v_a_r import Axis
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib import builder as vbuilder
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.varLib.varStore import OnlineVarStoreBuilder, VarStoreInstancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'public', 'protected', 'fonts', 'vista')
ADV = os.path.join(os.path.expanduser('~'), '.cache', 'vista-vm', 'gdi-advances')
FACES = ['segoeui', 'segoeuib', 'segoeuii', 'segoeuiz', 'tahoma', 'tahomabd', 'micross']
# The axis: sizes LO..HI-1 px carry GDI's widths, HI (the default) the outline's. A 64 px span puts every whole
# size on an exact F2Dot14 coordinate, so a renderer's rounding cannot scale a size's deltas.
LO, HI = 6, 70
MASTERS = list(range(LO, HI))


def norm(px):
    return (px - HI) / (HI - LO)


def region(px):
    start = -1.0 if px == LO else norm(px - 1)
    end = 0.0 if px == HI - 1 else norm(px + 1)
    return {'opsz': (start, norm(px), end)}


def read_widths(path, glyph_count):
    sizes = {}
    with open(path) as fh:
        for line in fh:
            px, _tm_height, _tm_ascent, widths = line.split()
            row = [int(w) for w in widths.split(',')]
            if len(row) != glyph_count:
                raise SystemExit(f'{path}: {len(row)} widths for {glyph_count} glyphs')
            sizes[int(px)] = row
    missing = [px for px in MASTERS if px not in sizes]
    if missing:
        raise SystemExit(f'{path}: no widths for {missing}')
    return sizes


def build(face, gen, outdir):
    font = TTFont(os.path.join(FONTS, f'{face}.woff2'))
    font.flavor = None
    order = font.getGlyphOrder()
    upm = font['head'].unitsPerEm
    hmtx = font['hmtx']
    glyf = font['glyf']
    sizes = read_widths(os.path.join(ADV, f'{face}.txt'), len(order))
    # deltas[name][i]: font units that make the advance at MASTERS[i] px GDI's whole-pixel width, rounded down: a
    # run never comes out a hair wider than GDI's, so a static sized to its text on the VM ("Short", "Current
    # default:") does not wrap its last word
    deltas = {name: [math.floor(sizes[px][gi] * upm / px) - hmtx[name][0] for px in MASTERS] for gi, name in enumerate(order)}

    if 'kern' in font:
        del font['kern']

    axis = Axis()
    axis.axisTag = 'opsz'
    axis.minValue, axis.defaultValue, axis.maxValue = float(LO), float(HI), float(HI)
    axis.flags = 0
    axis.axisNameID = font['name'].addMultilingualName({'en': 'Optical size'}, mac=False)
    fvar = newTable('fvar')
    fvar.axes = [axis]
    fvar.instances = []
    font['fvar'] = fvar
    buildStatTable(font, [dict(tag='opsz', name='Optical size', values=[])])

    store = OnlineVarStoreBuilder(['opsz'])
    store.setSupports([region(px) for px in MASTERS])
    adv_map = {name: store.storeDeltas(deltas[name]) for name in order}
    var_store = store.finish()
    remap = var_store.optimize()
    hvar = newTable('HVAR')
    hvar.table = ot.HVAR()
    hvar.table.Version = 0x00010000
    hvar.table.VarStore = var_store
    hvar.table.AdvWidthMap = vbuilder.buildVarIdxMap([remap[adv_map[name]] for name in order], order)
    hvar.table.LsbMap = None
    hvar.table.RsbMap = None
    font['HVAR'] = hvar

    # gvar: the same deltas on each glyph's advance phantom point (point count + 1; composites count components)
    gvar = newTable('gvar')
    gvar.version = 1
    gvar.reserved = 0
    gvar.variations = {}
    for name in order:
        coords, _controls = glyf._getCoordinatesAndControls(name, hmtx.metrics)
        count = len(coords)  # outline points (or components) + the 4 phantom points
        tuples = []
        for px, delta in zip(MASTERS, deltas[name]):
            if delta:
                points = [None] * count
                points[count - 3] = (delta, 0)
                tuples.append(TupleVariation(region(px), points))
        gvar.variations[name] = tuples
    font['gvar'] = gvar

    out = os.path.join(outdir, f'{face}-gdi{gen}.woff2')
    font.flavor = 'woff2'
    font.save(out)
    check(out, sizes, upm)
    return out


def check(path, sizes, upm):
    """At each size both the HVAR advance and the gvar instance are GDI's width, less under a font unit."""
    font = TTFont(path)
    order = font.getGlyphOrder()
    hvar = font['HVAR'].table
    for px in (6, 8, 11, 12, 13, 16, 24, HI - 1):
        ok = lambda v, gdi: gdi - px / upm - 0.001 <= v <= gdi + 0.001
        varst = VarStoreInstancer(hvar.VarStore, font['fvar'].axes, {'opsz': norm(px)})
        inst = instantiateVariableFont(TTFont(path), {'opsz': px}) if px in (11, 12, 16) else None
        for i, g in enumerate(order):
            adv = font['hmtx'][g][0] + varst[hvar.AdvWidthMap.mapping[g]]
            if not ok(adv * px / upm, sizes[px][i]):
                raise SystemExit(f'{path}: HVAR {g} at {px} px is {adv * px / upm:.3f}, GDI {sizes[px][i]}')
            if inst is not None and not ok(inst['hmtx'][g][0] * px / upm, sizes[px][i]):
                raise SystemExit(f'{path}: gvar {g} at {px} px is {inst["hmtx"][g][0] * px / upm:.3f}, GDI {sizes[px][i]}')


def main():
    gen = int(sys.argv[1]) if len(sys.argv) > 1 else 2  # the files vista-fonts.css names now
    outdir = sys.argv[2] if len(sys.argv) > 2 else FONTS
    for face in sys.argv[3:] or FACES:
        out = build(face, gen, outdir)
        print(f'{out}  {os.path.getsize(out)} bytes')


if __name__ == '__main__':
    main()
