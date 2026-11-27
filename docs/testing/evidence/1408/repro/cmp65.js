'use strict';
// 6.5: for each run, its first painted splash frame and the last one before the splash ended; then old vs new:
// pixel difference inside the emblem's and the badge's rectangles (and the whole screen) on those frames.
const fs = require('fs');
const path = require('path');
const sharp = require('/home/kanmi/staticforge/node_modules/sharp');
const F = process.env.F;
const raw = (src, rect) => { let s = sharp(src); if (rect) s = s.extract({ left: rect[0], top: rect[1], width: rect[2], height: rect[3] }); return s.removeAlpha().raw().toBuffer(); };
const stats = (a, b) => { let sum = 0, max = 0, over = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; if (d > 8) over++; } return { mean: +(sum / a.length).toFixed(2), max, pctOver8: +(100 * over / a.length).toFixed(2) }; };
(async () => {
    const out = {};
    for (const n of ['old-r1-1', 'new-r1-1', 'old-r1-2', 'new-r1-2']) {
        const j = require(`./runs-newcode/wm65-${n}.json`);
        const done = j.ev.find((e) => e[1] === 'data-wm-boot' && e[2] === 'done')[0];
        const ins = j.ev.find((e) => e[1] === 'inserted')[0];
        const dir = path.join(F, `wm65-${n}`);
        const all = fs.readdirSync(dir).map((f) => ({ f: path.join(dir, f), t: Number(/-(-?\d+)ms\.png$/.exec(f)[1]) })).sort((a, b) => a.t - b.t);
        const up = [];
        for (const x of all) if (x.t >= ins && x.t < done && (await sharp(x.f).metadata()).height === 915) up.push(x);
        // 6.5's splash is orange: a frame of it has far more red than blue in a corner of the empty field
        const splash = [];
        for (const x of up) { const p = await raw(x.f, [4, 500, 40, 40]); let r = 0, b = 0; for (let i = 0; i < p.length; i += 3) { r += p[i]; b += p[i + 2]; } if (r > 2 * b + 1000) splash.push(x); }
        out[n] = { ins, done, frames: splash.length, first: splash[0], last: splash[splash.length - 1], box: j.box };
    }
    const res = {};
    for (const i of ['1', '2']) {
        const o = out[`old-r1-${i}`], w = out[`new-r1-${i}`];
        for (const which of ['first', 'last']) {
            const box = w.box;
            res[`pair ${i}, ${which} splash frame`] = {
                oldAtMs: o[which].t, newAtMs: w[which].t,
                emblem: stats(await raw(o[which].f, box.emblem), await raw(w[which].f, box.emblem)),
                badge: stats(await raw(o[which].f, box.cafe), await raw(w[which].f, box.cafe))
            };
        }
    }
    res['new first vs new last (pair 1)'] = { emblem: stats(await raw(out['new-r1-1'].first.f, out['new-r1-1'].box.emblem), await raw(out['new-r1-1'].last.f, out['new-r1-1'].box.emblem)), badge: stats(await raw(out['new-r1-1'].first.f, out['new-r1-1'].box.cafe), await raw(out['new-r1-1'].last.f, out['new-r1-1'].box.cafe)) };
    console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { splashFrames: v.frames, first: v.first.t, last: v.last.t, done: v.done }]))));
    for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(v));
    // the sheet
    const W = 412, specs = [[out['old-r1-1'].first, '6.5 old: first splash frame'], [out['new-r1-1'].first, '6.5 new: first splash frame'], [out['old-r1-1'].last, '6.5 old: last splash frame'], [out['new-r1-1'].last, '6.5 new: last splash frame']];
    const comps = [];
    for (let i = 0; i < specs.length; i++) {
        comps.push({ input: await sharp(specs[i][0].f).toBuffer(), left: i * (W + 12), top: 44 });
        comps.push({ input: Buffer.from(`<svg width="412" height="44"><rect width="100%" height="100%" fill="#222"/><text x="8" y="18" font-family="sans-serif" font-size="14" fill="#fff">${specs[i][1]}</text><text x="8" y="37" font-family="sans-serif" font-size="13" fill="#bbb">painted frame at ${specs[i][0].t} ms</text></svg>`), left: i * (W + 12), top: 0 });
    }
    await sharp({ create: { width: 4 * (W + 12) - 12, height: 959, channels: 3, background: '#fff' } }).composite(comps).png({ compressionLevel: 9, palette: true }).toFile('newcode-wm65-old-vs-new.png');
})();
