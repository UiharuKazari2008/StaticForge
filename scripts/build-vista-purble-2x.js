#!/usr/bin/env node
/*
 * Purble Place's 2x sprite sheets, re-laid at exactly twice the 1x offsets (Yozora #609).
 *
 * The engine (public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js) draws a 2x frame
 * from 2 x the 1x SheetOffsetX / SheetOffsetY once the window is 1.5x or larger. PurblePlace.dll's
 * 2x pages (the X21..X24 quadrants scripts/build-vista-games.js joins) were packed on their own:
 * most frames sit at twice the 1x offset, but some are 1-2 px off and a few lie past the page's
 * edge (concentrationSheet12 is 2037 x 2035, comfycakesSheet4 1823 x 1631). This script finds every
 * frame of every sprite in its 2x page (the best match of the 2x art, box-filtered to 1x, against
 * the 1x frame within +-6 px of 2 x the offset) and copies it to 2 x the offset of a new
 * 2 x (1x size) page:
 *
 *   public/static_images/vista-games/purble/sheets2x/<sheet>@2x.webp
 *
 * purble.js loads these in place of sheets/<sheet>@2x.webp.
 *
 *   node scripts/build-vista-purble-2x.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'public', 'static_images', 'vista-games', 'purble');
const SEARCH = 6;

const child = (n, t) => (n && n.c ? n.c.find((k) => k.t === t) : null) || null;
const text = (n, t) => { const x = child(n, t); return x && x.v !== undefined ? String(x.v) : ''; };
const num = (n, t) => { const v = parseFloat(text(n, t)); return Number.isFinite(v) ? v : 0; };

async function raw(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
}

// every frame rect (1x, padding included) of every sprite drawn from `sheet`
function frames(data, sheet) {
    const out = [];
    const seen = new Set();
    Object.values(data.xml).forEach((node) => {
        if (!node || !node.c) return;
        const w = num(node, 'SourceWidth');
        const h = num(node, 'SourceHeight');
        if (!w || !h) return;
        node.c.filter((a) => a.t === 'Animation').forEach((a) => {
            const tex = text(a, 'Texture').replace(/^.*[\\/]/, '').replace(/\.sht$/i, '').toLowerCase();
            if (tex !== sheet) return;
            const pad = text(a, 'PreppedForFilter') === '1' ? 1 : 0;
            const count = Math.max(1, num(a, 'FrameCount'));
            const perRow = Math.max(1, num(a, 'FramesPerRow') || 1);
            const ox = num(a, 'SheetOffsetX');
            const oy = num(a, 'SheetOffsetY');
            for (let f = 0; f < count; f++) {
                const x = ox + (f % perRow) * (w + pad * 2);
                const y = oy + Math.floor(f / perRow) * (h + pad * 2);
                const key = [x, y, w + pad * 2, h + pad * 2].join(',');
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ x, y, w: w + pad * 2, h: h + pad * 2 });
            }
        });
    });
    return out;
}

// mean |2x box-filtered - 1x| over the rect (premultiplied by alpha), sampled
function error(one, two, r, dx, dy) {
    let sum = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(Math.min(r.w, r.h) / 24));
    for (let y = 0; y < r.h; y += step) {
        for (let x = 0; x < r.w; x += step) {
            const ax = r.x + x;
            const ay = r.y + y;
            if (ax >= one.w || ay >= one.h) continue;
            const i1 = (ay * one.w + ax) * 4;
            const bx = ax * 2 + dx;
            const by = ay * 2 + dy;
            let rr = 0;
            let gg = 0;
            let bb = 0;
            let aa = 0;
            for (let k = 0; k < 4; k++) {
                const px = bx + (k & 1);
                const py = by + (k >> 1);
                if (px < 0 || py < 0 || px >= two.w || py >= two.h) continue;
                const i2 = (py * two.w + px) * 4;
                const al = two.data[i2 + 3] / 255;
                rr += two.data[i2] * al;
                gg += two.data[i2 + 1] * al;
                bb += two.data[i2 + 2] * al;
                aa += two.data[i2 + 3];
            }
            const a1 = one.data[i1 + 3] / 255;
            sum += Math.abs(rr / 4 - one.data[i1] * a1) + Math.abs(gg / 4 - one.data[i1 + 1] * a1) + Math.abs(bb / 4 - one.data[i1 + 2] * a1) + Math.abs(aa / 4 - one.data[i1 + 3]);
            n += 4;
        }
    }
    return n ? sum / n : Infinity;
}

// bilinear 2x of a 1x frame into the page
function upscale(one, page, W, H, r) {
    for (let y = 0; y < r.h * 2; y++) {
        for (let x = 0; x < r.w * 2; x++) {
            const fx = Math.min(r.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
            const fy = Math.min(r.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
            const x0 = Math.floor(fx);
            const y0 = Math.floor(fy);
            const x1 = Math.min(r.w - 1, x0 + 1);
            const y1 = Math.min(r.h - 1, y0 + 1);
            const ax = fx - x0;
            const ay = fy - y0;
            const tx = r.x * 2 + x;
            const ty = r.y * 2 + y;
            if (tx >= W || ty >= H) continue;
            for (let c = 0; c < 4; c++) {
                const p = (xx, yy) => one.data[((r.y + yy) * one.w + r.x + xx) * 4 + c];
                const v = (p(x0, y0) * (1 - ax) + p(x1, y0) * ax) * (1 - ay) + (p(x0, y1) * (1 - ax) + p(x1, y1) * ax) * ay;
                page[(ty * W + tx) * 4 + c] = Math.round(v);
            }
        }
    }
}

async function main() {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
    const outDir = path.join(ROOT, 'sheets2x');
    fs.mkdirSync(outDir, { recursive: true });
    const report = {};
    for (const [key, dims] of Object.entries(data.sheets)) {
        if (dims.length < 4 || !/^SHEETS_/.test(key)) continue;
        const sheet = key.replace(/^SHEETS_/, '').replace(/\.SHT$/, '').toLowerCase();
        const oneFile = path.join(ROOT, 'sheets', sheet + '.webp');
        const twoFile = path.join(ROOT, 'sheets', sheet + '@2x.webp');
        if (!fs.existsSync(oneFile) || !fs.existsSync(twoFile)) continue;
        const one = await raw(oneFile);
        const two = await raw(twoFile);
        const W = one.w * 2;
        const H = one.h * 2;
        const page = Buffer.alloc(W * H * 4);
        let moved = 0;
        let upscaled = 0;
        const list = frames(data, sheet);
        list.forEach((r) => {
            let best = { e: error(one, two, r, 0, 0), dx: 0, dy: 0 };
            // a frame a few px thin (a border, a one-row bar slice) matches anywhere along itself
            if (best.e > 0.5 && Math.min(r.w, r.h) >= 8) {
                for (let dy = -SEARCH; dy <= SEARCH; dy++) {
                    for (let dx = -SEARCH; dx <= SEARCH; dx++) {
                        if (!dx && !dy) continue;
                        const e = error(one, two, r, dx, dy);
                        if (e < best.e - 0.05) best = { e, dx, dy };
                    }
                }
            }
            // a shift has to beat the frame where it is by a clear margin
            const e0 = error(one, two, r, 0, 0);
            if ((best.dx || best.dy) && best.e > e0 * 0.8) best = { e: e0, dx: 0, dy: 0 };
            // not found near 2 x its offset (comfycakesSheet4's box frames, past its 1823 x 1631
            // page): the 1x frame, scaled up
            if (best.e > 30 && sheet === 'comfycakessheet4') {
                upscaled += 1;
                upscale(one, page, W, H, r);
                return;
            }
            if (best.dx || best.dy) moved += 1;
            if (process.env.PURBLE_2X_DEBUG && best.e > 8) console.log('  ', sheet, r.x, r.y, r.w, r.h, best.e.toFixed(1), best.dx, best.dy);
            for (let y = 0; y < r.h * 2; y++) {
                const sy = r.y * 2 + y + best.dy;
                const ty = r.y * 2 + y;
                if (sy < 0 || sy >= two.h || ty >= H) continue;
                for (let x = 0; x < r.w * 2; x++) {
                    const sx = r.x * 2 + x + best.dx;
                    const tx = r.x * 2 + x;
                    if (sx < 0 || sx >= two.w || tx >= W) continue;
                    two.data.copy(page, (ty * W + tx) * 4, (sy * two.w + sx) * 4, (sy * two.w + sx) * 4 + 4);
                }
            }
        });
        await sharp(page, { raw: { width: W, height: H, channels: 4 } })
            .webp({ quality: 92, alphaQuality: 100, effort: 5, smartSubsample: true })
            .toFile(path.join(outDir, sheet + '@2x.webp'));
        report[sheet] = { frames: list.length, moved, upscaled };
        console.log(sheet.padEnd(36), list.length, 'frames,', moved, 'moved,', upscaled, 'from the 1x art');
    }
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
