#!/usr/bin/env node
/**
 * Build the Vista start menu art (Yozora #443) from Vista's own pixels, ripped from the Vista
 * Aero VM into scripts/assets/vista-start-parts/:
 *
 *   power-strip-{rest,hover,pressed}-120.png   explorer.exe bitmaps 7054 / 7056 / 7055: the
 *                                              120 DPI start panel button strip, six 70 x 30 cells
 *                                              (disconnect, shut down, shut down + updates, sleep,
 *                                              installing, lock), one strip per state
 *   arrow-glyph.png                            aero.msstyles IMAGE 713: the power menu arrow, 3 x 9 px
 *                                              states (rest, hover, pressed)
 *   user-frame.png                             authui.dll IMAGE 11201: the start menu account frame
 *                                              (Vista ships it at 96 DPI only and scales it: 64 -> 80 px here)
 *
 * The two main buttons can be set to other actions (Customize Start Menu, taskbarSettings.js
 * powerButton / lockButton): disconnect.png is cell 0 (Vista's amber disconnect, our Log off on
 * the power button); lock-logoff.png is the lock cell's face with cell 0's white X in place of the
 * padlock (Log off on the lock button).
 *
 * Each button becomes one sprite with its three states stacked (rest, hover, pressed), so CSS
 * moves background-position only. The arrow button Vista draws next to Lock is not in the strip.
 * The lock sprite already ends on the group's divider, so the arrow does not repeat that line.
 * Its right edge is the rounded end cap: a mirror of the leading cell's left cap (cells 0-4;
 * the lock cell itself closes square, which is why the arrow looked cut off). The cap's frame
 * (black stroke, highlight, transparent outside) is copied; its face stays the lock cell's.
 * The strip is one continuous group, so the sprites abut with no gap.
 *
 *   node scripts/build-vista-start-menu-art.js     # writes public/static_images/vista-start/
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const PARTS = path.join(__dirname, 'assets/vista-start-parts');
const OUT = path.join(ROOT, 'public/static_images/vista-start');

const CELL_W = 70;
const CELL_H = 30;
const CELLS = { shutdown: 1, lock: 5, disconnect: 0 };
const STATES = ['rest', 'hover', 'pressed'];
const ARROW_W = 28; // Vista's 22 px arrow button at 120 DPI
const CAP_W = 6; // leading-cell columns that form the rounded end cap (mirrored onto the arrow)

async function raw(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

function blank(width, height) {
    return { data: Buffer.alloc(width * height * 4), width, height };
}

function copyColumn(dst, dx, dy, src, sx, sy, h) {
    for (let y = 0; y < h; y++) {
        const si = ((sy + y) * src.width + sx) * 4;
        const di = ((dy + y) * dst.width + dx) * 4;
        src.data.copy(dst.data, di, si, si + 4);
    }
}

function over(dst, dx, dy, src, sx, sy, w, h) {
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const si = ((sy + y) * src.width + sx + x) * 4;
            const di = ((dy + y) * dst.width + dx + x) * 4;
            const a = src.data[si + 3] / 255;
            if (!a) continue;
            const da = dst.data[di + 3] / 255;
            const oa = a + da * (1 - a);
            for (let k = 0; k < 3; k++) {
                dst.data[di + k] = Math.round((src.data[si + k] * a + dst.data[di + k] * da * (1 - a)) / oa);
            }
            dst.data[di + 3] = Math.round(oa * 255);
        }
    }
}

async function save(img, name) {
    await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(path.join(OUT, name));
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const strips = {};
    for (const state of STATES) strips[state] = await raw(path.join(PARTS, `power-strip-${state}-120.png`));
    const glyph = await raw(path.join(PARTS, 'arrow-glyph.png'));

    // power and lock buttons: the cell from each state's strip
    for (const [name, cell] of Object.entries(CELLS)) {
        const sprite = blank(CELL_W, CELL_H * STATES.length);
        STATES.forEach((state, row) => {
            for (let x = 0; x < CELL_W; x++) copyColumn(sprite, x, row * CELL_H, strips[state], cell * CELL_W + x, 0, CELL_H);
        });
        await save(sprite, `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.png`);
    }

    // arrow button: Vista lights it with the dark blue glow on hover (the lock's pressed cell)
    // and the bright blue when pressed. The rounded end cap is the leading cell's left cap,
    // mirrored; only its frame is kept, so a gold cell does not tint the silver arrow.
    const arrowFrom = { rest: 'rest', hover: 'pressed', pressed: 'hover' };
    const arrow = blank(ARROW_W, CELL_H * STATES.length);
    const lock = CELLS.lock * CELL_W;
    const middle = lock + 6; // a glyph-free column of the lock cell
    const capFrame = (src, i) => {
        const r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];
        if (a < 100) return true;
        return Math.max(r, g, b) - Math.min(r, g, b) <= 18;
    };
    STATES.forEach((state, row) => {
        const strip = strips[arrowFrom[state]];
        for (let y = 0; y < CELL_H; y++) {
            for (let x = 0; x < ARROW_W; x++) {
                let sx = middle;
                if (x >= ARROW_W - CAP_W) {
                    const capX = ARROW_W - 1 - x; // outer edge is column 0 of the leading cell
                    if (capFrame(strip.data, (y * strip.width + capX) * 4)) sx = capX;
                }
                copyColumn(arrow, x, row * CELL_H + y, strip, sx, y, 1);
            }
        }
        const gh = glyph.height / 3;
        over(arrow, Math.round((ARROW_W - glyph.width) / 2), row * CELL_H + Math.round((CELL_H - gh) / 2), glyph, 0, row * gh, glyph.width, gh);
    });
    await save(arrow, 'arrow.png');

    // Log off on the lock button: the lock cell's face, its padlock painted out with a glyph-free
    // column, then cell 0's white X laid over it (alpha = how far a pixel rises over that cell's face)
    const logoff = blank(CELL_W, CELL_H * STATES.length);
    STATES.forEach((state, row) => {
        const strip = strips[state];
        for (let x = 0; x < CELL_W; x++) {
            const sx = x >= 6 && x < CELL_W - 6 ? lock + 6 : lock + x;
            copyColumn(logoff, x, row * CELL_H, strip, sx, 0, CELL_H);
        }
        for (let y = 0; y < CELL_H; y++) {
            const bi = (y * strip.width + 6) * 4;
            const bg = Math.min(strip.data[bi], strip.data[bi + 1], strip.data[bi + 2]);
            for (let x = 8; x < CELL_W - 8; x++) {
                const si = (y * strip.width + x) * 4;
                const lo = Math.min(strip.data[si], strip.data[si + 1], strip.data[si + 2]);
                const a = Math.max(0, Math.min(1, (lo - bg - 12) / Math.max(1, 255 - bg - 12)));
                if (!a) continue;
                const di = ((row * CELL_H + y) * CELL_W + x) * 4;
                // white over the (translucent) face, alpha included
                const da = logoff.data[di + 3] / 255;
                const oa = a + da * (1 - a);
                for (let k = 0; k < 3; k++) logoff.data[di + k] = Math.round((255 * a + logoff.data[di + k] * da * (1 - a)) / oa);
                logoff.data[di + 3] = Math.round(oa * 255);
            }
        }
    });
    await save(logoff, 'lock-logoff.png');

    // the rest are used as they are
    const copies = {
        'usertile-kitten.png': 'usertile-kitten.png',
        'search-glyph.png': 'search-glyph.png',
        'programs-arrow-a.png': 'programs-arrow.png',
        'back-arrow-a.png': 'back-arrow.png',
        'folder-20.png': 'folder-20.png',
        'folder-40.png': 'folder-40.png'
    };
    for (const [from, to] of Object.entries(copies)) fs.copyFileSync(path.join(PARTS, from), path.join(OUT, to));
    // the account frame at 120 DPI (the menu's scale): 64 px x 1.25, the picture opening 48 -> 60 px
    await sharp(path.join(PARTS, 'user-frame.png')).resize(80, 80, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'user-frame.png'));
    console.log(`wrote ${path.relative(ROOT, OUT)}: shutdown, lock, disconnect, lock-logoff, arrow sprites + ${Object.keys(copies).length} parts + the 120 DPI account frame`);
}

main().catch((err) => {
    console.error(`build-vista-start-menu-art: ${err.message}`);
    process.exit(1);
});
