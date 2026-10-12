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
 *
 * Each button becomes one sprite with its three states stacked (rest, hover, pressed), so CSS
 * moves background-position only. The arrow button Vista draws next to Lock is not in the strip;
 * it is the lock cell's own edges around its glyph-free middle, with the arrow glyph centred.
 * The strip is one continuous group (each cell opens with a light line and a black divider, only
 * the last cell closes), so the sprites abut with no gap.
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
const CELLS = { shutdown: 1, lock: 5 };
const STATES = ['rest', 'hover', 'pressed'];
const ARROW_W = 28; // Vista's 22 px arrow button at 120 DPI
const ARROW_EDGE = 3; // lock cell columns kept on each side of the arrow button

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
    // and the bright blue when pressed
    const arrowFrom = { rest: 'rest', hover: 'pressed', pressed: 'hover' };
    const arrow = blank(ARROW_W, CELL_H * STATES.length);
    const lock = CELLS.lock * CELL_W;
    const middle = lock + 6; // a glyph-free column of the lock cell
    STATES.forEach((state, row) => {
        const strip = strips[arrowFrom[state]];
        for (let x = 0; x < ARROW_W; x++) {
            let sx = middle;
            if (x < ARROW_EDGE) sx = lock + x;
            else if (x >= ARROW_W - ARROW_EDGE) sx = lock + CELL_W - (ARROW_W - x);
            copyColumn(arrow, x, row * CELL_H, strip, sx, 0, CELL_H);
        }
        const gh = glyph.height / 3;
        over(arrow, Math.round((ARROW_W - glyph.width) / 2), row * CELL_H + Math.round((CELL_H - gh) / 2), glyph, 0, row * gh, glyph.width, gh);
    });
    await save(arrow, 'arrow.png');

    // the rest are used as they are
    const copies = {
        'user-frame.png': 'user-frame.png',
        'usertile-kitten.png': 'usertile-kitten.png',
        'search-glyph.png': 'search-glyph.png',
        'programs-arrow-a.png': 'programs-arrow.png',
        'back-arrow-a.png': 'back-arrow.png',
        'folder-20.png': 'folder-20.png',
        'folder-40.png': 'folder-40.png'
    };
    for (const [from, to] of Object.entries(copies)) fs.copyFileSync(path.join(PARTS, from), path.join(OUT, to));
    console.log(`wrote ${path.relative(ROOT, OUT)}: shutdown, lock, arrow sprites + ${Object.keys(copies).length} parts`);
}

main().catch((err) => {
    console.error(`build-vista-start-menu-art: ${err.message}`);
    process.exit(1);
});
