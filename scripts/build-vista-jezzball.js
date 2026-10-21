#!/usr/bin/env node
/**
 * Build JezzBall's web assets (Win 3.x JezzBall in the Vista games folder) from the game's own
 * files and the Vista VM's captures, kept in ~/.cache/vista-vm/jezzball:
 *
 *   orig/JEZZBALL.EXE, WEP4UTIL.DLL, *.WAV     the Entertainment Pack 4 files (NE executables)
 *   fonts/vgasys.fon, sserife.fon              Vista's raster System and MS Sans Serif fonts
 *   ref/active.png, maxbtns.png, gameover.png  VM shots the caption-button glyphs are cut from
 *   ref/caption16.png, hsentry.png             the 16 px caption icons as Vista draws them
 *   ref/question32.png                         user32.dll's question icon (the Game Over box)
 *   notes/demo_script.json                     the demo's recorded clicks (JEZZBALL seg2:0048)
 *
 * Output: public/static_images/vista-games/jezzball/
 *   sheet.png        JEZZ-NEW, the 288 x 24 sprite sheet (16-colour DIB, as Vista's DDB holds it)
 *   wep-logo.png     WEP4UTIL bitmap 666 (the About box's Entertainment Pack logo, RLE4)
 *   trophy.png       WEP4UTIL bitmap 555 (Hall of Fame)
 *   icon32.png       JEZZBALL icon 1 (32 x 32, AND mask -> alpha)
 *   caption16.png    the icon as Vista's caption draws it at 16 x 16
 *   wep16.png / wep16-invert.png   WEP4UTIL's caption icon: its opaque pixels, and the pixels the
 *                    mono icon XORs (drawn with mix-blend-mode: difference)
 *   question32.png   the message box icon
 *   glyphs.png       caption-button glyphs, 13 x 11 each: minimize, maximize, restore, close,
 *                    close disabled (gray with its white emboss)
 *   bounce.wav, jezzdead.wav
 *   jezzball.json    { fonts: { system, sserif24 }, demo }; a font is the FNT metrics plus
 *                    `bits`, its glyph atlas as base64 1-bit rows (MSB first)
 *
 *   node scripts/build-vista-jezzball.js [--src ~/.cache/vista-vm/jezzball]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public/static_images/vista-games/jezzball');
const args = process.argv.slice(2);
const srcArg = args.indexOf('--src');
const SRC = srcArg >= 0 ? args[srcArg + 1] : path.join(os.homedir(), '.cache/vista-vm/jezzball');

// ---- NE resources --------------------------------------------------------------------------
const RT = { 1: 'CURSOR', 2: 'BITMAP', 3: 'ICON', 4: 'MENU', 5: 'DIALOG', 6: 'STRING', 8: 'FONT', 14: 'GROUP_ICON' };

function neResources(file) {
    const d = fs.readFileSync(file);
    const ne = d.readUInt32LE(0x3c);
    if (d.toString('latin1', ne, ne + 2) !== 'NE') throw new Error(file + ': not an NE file');
    const base = ne + d.readUInt16LE(ne + 0x24);
    const shift = d.readUInt16LE(base);
    const pstr = (o) => d.toString('latin1', o + 1, o + 1 + d[o]);
    const out = [];
    let o = base + 2;
    for (;;) {
        const tid = d.readUInt16LE(o);
        if (!tid) break;
        const count = d.readUInt16LE(o + 2);
        o += 8;
        const type = tid & 0x8000 ? RT[tid & 0x7fff] || String(tid & 0x7fff) : pstr(base + tid);
        for (let i = 0; i < count; i++, o += 12) {
            const off = d.readUInt16LE(o) << shift;
            const len = d.readUInt16LE(o + 2) << shift;
            const rid = d.readUInt16LE(o + 6);
            out.push({ type, id: rid & 0x8000 ? rid & 0x7fff : pstr(base + rid), data: d.subarray(off, off + len) });
        }
    }
    return out;
}

const resource = (list, type, id) => {
    const r = list.find((x) => x.type === type && String(x.id) === String(id));
    if (!r) throw new Error('missing ' + type + ' ' + id);
    return r.data;
};

// ---- DIBs ----------------------------------------------------------------------------------
// BITMAPINFOHEADER DIB (1/4 bpp, BI_RGB or BI_RLE4) -> RGBA rows top-down
function decodeDib(d, heightOverride) {
    const hs = d.readUInt32LE(0);
    const w = d.readInt32LE(4);
    const h = heightOverride || d.readInt32LE(8);
    const bpp = d.readUInt16LE(14);
    const comp = d.readUInt32LE(16);
    const ncol = d.readUInt32LE(32) || (1 << bpp);
    const pal = [];
    for (let i = 0; i < ncol; i++) pal.push([d[hs + i * 4 + 2], d[hs + i * 4 + 1], d[hs + i * 4]]);
    const bits = hs + ncol * 4;
    const idx = new Uint8Array(w * h); // bottom-up indices
    if (comp === 2) {
        // RLE4
        let x = 0;
        let y = 0;
        let o = bits;
        for (;;) {
            const n = d[o++];
            const c = d[o++];
            if (n) {
                for (let i = 0; i < n; i++) idx[y * w + x++] = i & 1 ? c & 15 : c >> 4;
            } else if (c === 0) {
                x = 0;
                y++;
            } else if (c === 1) {
                break;
            } else if (c === 2) {
                x += d[o++];
                y += d[o++];
            } else {
                for (let i = 0; i < c; i++) {
                    const b = d[o + (i >> 1)];
                    idx[y * w + x++] = i & 1 ? b & 15 : b >> 4;
                }
                o += ((c + 3) >> 2) << 1;
            }
        }
    } else {
        const row = ((w * bpp + 31) >> 5) << 2;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const b = d[bits + y * row + ((x * bpp) >> 3)];
                idx[y * w + x] = bpp === 4 ? (x & 1 ? b & 15 : b >> 4) : (b >> (7 - (x & 7))) & 1;
            }
        }
    }
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = pal[idx[(h - 1 - y) * w + x]];
            const o = (y * w + x) * 4;
            rgba[o] = c[0];
            rgba[o + 1] = c[1];
            rgba[o + 2] = c[2];
            rgba[o + 3] = 255;
        }
    }
    return { w, h, rgba, bits: bits + (((w * bpp + 31) >> 5) << 2) * h };
}

// ICON: XOR DIB (height doubled) then the 1-bit AND mask
function decodeIcon(d) {
    const h = d.readInt32LE(8) / 2;
    const img = decodeDib(d, h);
    const andRow = ((img.w + 31) >> 5) << 2;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < img.w; x++) {
            const m = (d[img.bits + (h - 1 - y) * andRow + (x >> 3)] >> (7 - (x & 7))) & 1;
            if (m) img.rgba[(y * img.w + x) * 4 + 3] = 0;
        }
    }
    return img;
}

const writePng = (file, w, h, rgba) => sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(OUT, file));

async function readRgba(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { w: info.width, h: info.height, data };
}

// ---- raster fonts (Win16 FNT 2.0 / 3.0 inside a .FON) --------------------------------------
function fntFonts(file) {
    return neResources(file).filter((r) => r.type === 'FONT').map(({ data: d }) => {
        const ver = d.readUInt16LE(0);
        const meta = {
            points: d.readUInt16LE(68),
            ascent: d.readUInt16LE(74),
            internalLeading: d.readUInt16LE(76),
            externalLeading: d.readUInt16LE(78),
            weight: d.readUInt16LE(83),
            height: d.readUInt16LE(88),
            first: d[95],
            last: d[96]
        };
        meta.default = meta.first + d[97];
        meta.face = d.toString('latin1', d.readUInt32LE(105), d.indexOf(0, d.readUInt32LE(105)));
        const table = ver < 0x300 ? 118 : 148;
        const glyphs = [];
        let atlasW = 0;
        for (let c = meta.first; c <= meta.last; c++) {
            const i = c - meta.first;
            const w = d.readUInt16LE(table + i * (ver < 0x300 ? 4 : 6));
            const off = ver < 0x300 ? d.readUInt16LE(table + i * 4 + 2) : d.readUInt32LE(table + i * 6 + 2);
            glyphs.push({ c, w, off, x: atlasW });
            atlasW += w;
        }
        const rowBytes = (atlasW + 7) >> 3;
        const bits = Buffer.alloc(rowBytes * meta.height);
        glyphs.forEach((g) => {
            for (let y = 0; y < meta.height; y++) {
                for (let x = 0; x < g.w; x++) {
                    const b = d[g.off + (x >> 3) * meta.height + y];
                    if ((b >> (7 - (x & 7))) & 1) {
                        const ax = g.x + x;
                        bits[y * rowBytes + (ax >> 3)] |= 0x80 >> (ax & 7);
                    }
                }
            }
        });
        meta.atlasW = atlasW;
        meta.glyphs = {};
        glyphs.forEach((g) => { meta.glyphs[g.c] = [g.x, g.w]; });
        meta.bits = bits.toString('base64');
        return meta;
    });
}

// ---- caption glyphs ------------------------------------------------------------------------
// The 13 x 11 face inside a 17 x 15 caption button (2 px of bevel each side): black pixels
// become the glyph; for the disabled close box, gray (160) and white (255) both stay
function cutGlyph(img, bx, by, disabled) {
    const out = Buffer.alloc(13 * 11 * 4);
    for (let y = 0; y < 11; y++) {
        for (let x = 0; x < 13; x++) {
            const o = ((by + 2 + y) * img.w + bx + 2 + x) * 4;
            const r = img.data[o];
            const g = img.data[o + 1];
            const b = img.data[o + 2];
            const p = (y * 13 + x) * 4;
            const ink = disabled ? ((r === 160 && g === 160 && b === 160) || (r === 255 && g === 255 && b === 255)) : (r === 0 && g === 0 && b === 0);
            if (ink) {
                out[p] = r;
                out[p + 1] = g;
                out[p + 2] = b;
                out[p + 3] = 255;
            }
        }
    }
    return out;
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const exe = neResources(path.join(SRC, 'orig/JEZZBALL.EXE'));
    const dll = neResources(path.join(SRC, 'orig/WEP4UTIL.DLL'));

    const sheet = decodeDib(resource(exe, 'BITMAP', 'JEZZ-NEW'));
    await writePng('sheet.png', sheet.w, sheet.h, sheet.rgba);
    const logo = decodeDib(resource(dll, 'BITMAP', 666));
    await writePng('wep-logo.png', logo.w, logo.h, logo.rgba);
    const trophy = decodeDib(resource(dll, 'BITMAP', 555));
    await writePng('trophy.png', trophy.w, trophy.h, trophy.rgba);
    const icon = decodeIcon(resource(exe, 'ICON', 1));
    await writePng('icon32.png', icon.w, icon.h, icon.rgba);

    // the caption icons, cut from the VM's own drawing
    fs.copyFileSync(path.join(SRC, 'ref/caption16.png'), path.join(OUT, 'caption16.png'));
    fs.copyFileSync(path.join(SRC, 'ref/question32.png'), path.join(OUT, 'question32.png'));
    const hs = await readRgba(path.join(SRC, 'ref/hsentry.png'));
    const caption = [153, 180, 209];
    const opaque = Buffer.alloc(16 * 16 * 4);
    const invert = Buffer.alloc(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const o = ((2 + y) * hs.w + 3 + x) * 4;
            const px = [hs.data[o], hs.data[o + 1], hs.data[o + 2]];
            const p = (y * 16 + x) * 4;
            if (px.every((v, i) => v === caption[i])) continue;
            if (px.every((v, i) => v === 255 - caption[i])) {
                invert.fill(255, p, p + 4);
            } else {
                opaque[p] = px[0];
                opaque[p + 1] = px[1];
                opaque[p + 2] = px[2];
                opaque[p + 3] = 255;
            }
        }
    }
    await writePng('wep16.png', 16, 16, opaque);
    await writePng('wep16-invert.png', 16, 16, invert);

    // caption buttons: active.png is the 512 x 378 window (buttons at x 449 / 466 / 485, y 10);
    // maxbtns.png is the maximized caption's right end (restore at 42, 2); gameover.png the
    // message box (disabled close at 266, 5)
    const active = await readRgba(path.join(SRC, 'ref/active.png'));
    const maxed = await readRgba(path.join(SRC, 'ref/maxbtns.png'));
    const box = await readRgba(path.join(SRC, 'ref/gameover.png'));
    const strip = Buffer.alloc(13 * 5 * 11 * 4);
    [cutGlyph(active, 449, 10), cutGlyph(active, 466, 10), cutGlyph(maxed, 42, 2), cutGlyph(active, 485, 10), cutGlyph(box, 266, 5, true)]
        .forEach((g, n) => {
            for (let y = 0; y < 11; y++) g.copy(strip, (y * 65 + n * 13) * 4, y * 13 * 4, (y + 1) * 13 * 4);
        });
    await writePng('glyphs.png', 65, 11, strip);

    for (const f of ['BOUNCE.WAV', 'JEZZDEAD.WAV']) fs.copyFileSync(path.join(SRC, 'orig', f), path.join(OUT, f.toLowerCase()));

    const system = fntFonts(path.join(SRC, 'fonts/vgasys.fon'))[0];
    const sserif24 = fntFonts(path.join(SRC, 'fonts/sserife.fon')).find((f) => f.height === 24);
    const demo = JSON.parse(fs.readFileSync(path.join(SRC, 'notes/demo_script.json'), 'utf8'));
    fs.writeFileSync(path.join(OUT, 'jezzball.json'), JSON.stringify({ fonts: { system, sserif24 }, demo }));
    console.log('wrote', fs.readdirSync(OUT).join(', '));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
