/**
 * A Windows Mobile 6.5 Today panel icon (ti-x-*-lg.png) as the ROM draws its own (measured Nov 21 2026 on every ROM
 * panel icon of the 86 x 113 size, ti-2008 ... ti-2701 @2x): the art stands on a floor at row 85 (per 2x), at most 76
 * wide from x 5 (5 ... 80) and 77 high; tall art reaches higher, wide art sits on the same floor. The reflection is the
 * art's own bottom rows mirrored, starting on the floor row itself (no gap) at about 78 % and fading to nothing at the
 * bottom edge. Yukimi, Nov 21 2026: "your reflections are wrong ... the reflection is from the bottom, just look at the
 * official music icons and phone, check all our custom items".
 *
 *   panelIcon(artPng, k) -> PNG buffer, 86k x 113k (k: 0.5 for 1x, 1 for @2x, 2 for @4x)
 *   reflectExisting(panelPng, k) -> the same panel rebuilt from the art above its old reflection
 */
'use strict';

const sharp = require('sharp');

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const GEOM = { W: 86, H: 113, left: 5, box: 76, maxH: 77, floor: 85, start: 0.78 };

async function panelIcon(artPng, k) {
    const W = Math.round(GEOM.W * k);
    const H = Math.round(GEOM.H * k);
    const floor = Math.round(GEOM.floor * k);
    const trimmed = await sharp(artPng).ensureAlpha().trim({ threshold: 4 }).png().toBuffer().catch(() => artPng);
    const art = await sharp(trimmed).resize(Math.round(GEOM.box * k), Math.round(GEOM.maxH * k), { fit: 'inside', kernel: 'lanczos3' })
        .png().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = art.info;
    const left = Math.round(GEOM.left * k + (GEOM.box * k - w) / 2);
    const top = floor - h;
    return compose(art.data, w, h, left, top, W, H, floor);
}

/** The art + its mirror on a clear W x H canvas, the art's bottom on the floor row. */
async function compose(artData, w, h, left, top, W, H, floor) {
    const rows = Math.max(1, Math.min(h, H - floor));
    // flip first, then take the top rows of the flipped art (= the art's bottom, mirrored); two steps on purpose:
    // in one sharp pipeline the extract runs before the flip and mirrors the art's top instead
    const flippedAll = await sharp(artData).flip().png().toBuffer();
    const flipped = await sharp(flippedAll).extract({ left: 0, top: 0, width: w, height: rows }).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < rows; y++) {
        const f = GEOM.start * (1 - y / rows);
        for (let x = 0; x < w; x++) { const i = (y * w + x) * 4 + 3; flipped[i] = Math.round(flipped[i] * f); }
    }
    const mirror = await sharp(flipped, { raw: { width: w, height: rows, channels: 4 } }).png().toBuffer();
    return sharp({ create: { width: W, height: H, channels: 4, background: CLEAR } })
        .composite([{ input: artData, left, top }, { input: mirror, left, top: floor }])
        .png({ compressionLevel: 9, effort: 8 })
        .toBuffer();
}

/**
 * An existing panel icon redrawn: its art is the rows down to the last fully solid row (a reflection never is), cut
 * from its own canvas and set on the floor again with a correct mirror.
 */
async function reflectExisting(panelPng, k) {
    const { data, info } = await sharp(panelPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rowMax = [];
    for (let y = 0; y < info.height; y++) {
        let m = 0;
        for (let x = 0; x < info.width; x++) m = Math.max(m, data[(y * info.width + x) * 4 + 3]);
        rowMax.push(m);
    }
    let bottom = -1;
    for (let y = info.height - 1; y >= 0; y--) if (rowMax[y] >= 240) { bottom = y; break; }
    const top = rowMax.findIndex((m) => m > 8);
    if (bottom < 0 || top < 0 || bottom <= top) return null;
    const art = await sharp(panelPng).extract({ left: 0, top, width: info.width, height: bottom - top + 1 }).png().toBuffer();
    // keep its own columns (the art is placed as drawn), refit only when it overflows the ROM's box
    const W = info.width;
    const H = info.height;
    const floor = Math.round(GEOM.floor * k);
    const trimmed = await sharp(art).trim({ threshold: 4 }).png().toBuffer({ resolveWithObject: true });
    let { data: a, info: ai } = trimmed;
    const maxW = Math.round(GEOM.box * k);
    const maxH = Math.round(GEOM.maxH * k);
    if (ai.width > maxW || ai.height > maxH) {
        const r = await sharp(a).resize(maxW, maxH, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer({ resolveWithObject: true });
        a = r.data; ai = r.info;
    }
    const left = Math.round(GEOM.left * k + (maxW - ai.width) / 2);
    return compose(a, ai.width, ai.height, left, floor - ai.height, W, H, floor);
}

module.exports = { panelIcon, reflectExisting, GEOM };
