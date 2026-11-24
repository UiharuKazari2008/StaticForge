#!/usr/bin/env node
/* Visual comparison for UI art (#1135).
   Usage: node scripts/compare-images.js <a.png> <b.png> <out.png> [--tolerance N] [--shift N]
   Writes out.png: A dimmed, every differing pixel red. Prints JSON: differing pixel count, percent,
   bounding box, and (--shift N) the best whole-pixel offset of B against A within +-N px, which
   tells an alignment error (small offset, big drop) from a colour error (no offset helps).
   Exit 0 when identical within tolerance, 1 when different, 2 on usage error. */
'use strict';
const sharp = require('sharp');

async function load(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
}
function diff(a, b, tol, dx = 0, dy = 0, out) {
    const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h);
    let count = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const ai = y < a.h && x < a.w ? (y * a.w + x) * 4 : -1;
        const bx = x + dx, by = y + dy;
        const bi = by >= 0 && by < b.h && bx >= 0 && bx < b.w ? (by * b.w + bx) * 4 : -1;
        let bad;
        if (ai < 0 || bi < 0) bad = true;
        else {
            const aa = a.data[ai + 3], ba = b.data[bi + 3];
            bad = Math.abs(aa - ba) > tol;
            if (!bad && (aa > 0 || ba > 0)) for (let c = 0; c < 3 && !bad; c++) bad = Math.abs(a.data[ai + c] - b.data[bi + c]) > tol;
        }
        if (bad) { count++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
        if (out) {
            const o = (y * w + x) * 4;
            if (bad) { out[o] = 255; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255; }
            else if (ai >= 0) {
                const al = a.data[ai + 3] / 255;
                for (let c = 0; c < 3; c++) out[o + c] = Math.round(255 - (255 - a.data[ai + c]) * al * 0.35);
                out[o + 3] = 255;
            } else { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; }
        }
    }
    return { count, w, h, box: count ? [x0, y0, x1, y1] : null };
}
(async () => {
    const args = process.argv.slice(2), pos = [];
    let tol = 0, shift = 0;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tolerance') tol = +args[++i];
        else if (args[i] === '--shift') shift = +args[++i];
        else pos.push(args[i]);
    }
    if (pos.length !== 3 || !(tol >= 0) || !(shift >= 0)) { console.error('usage: compare-images.js <a> <b> <out.png> [--tolerance N] [--shift N]'); process.exit(2); }
    const [a, b] = [await load(pos[0]), await load(pos[1])];
    const w = Math.max(a.w, b.w), h = Math.max(a.h, b.h), out = Buffer.alloc(w * h * 4);
    const r = diff(a, b, tol, 0, 0, out);
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(pos[2]);
    const res = { sizeA: [a.w, a.h], sizeB: [b.w, b.h], differing: r.count, percent: +(100 * r.count / (w * h)).toFixed(3), box: r.box };
    if (shift && r.count) {
        let best = { dx: 0, dy: 0, count: r.count };
        for (let dy = -shift; dy <= shift; dy++) for (let dx = -shift; dx <= shift; dx++) {
            const c = diff(a, b, tol, dx, dy).count;
            if (c < best.count) best = { dx, dy, count: c };
        }
        res.bestOffset = best;
        res.cause = best.count < r.count * 0.5 ? 'alignment' : 'colour or shape';
    }
    console.log(JSON.stringify(res));
    process.exit(r.count ? 1 : 0);
})();
