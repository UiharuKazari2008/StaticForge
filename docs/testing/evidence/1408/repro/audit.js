'use strict';
// Audit of every old-vs-new run (6.1): did the version under test really run, and was any frame between the
// splash's insertion and its end left out of the classification?   node audit.js <framesRoot>
const fs = require('fs');
const path = require('path');
const sharp = require('/home/kanmi/staticforge/node_modules/sharp');
const manifest = require('./newcode-build.json');
const F = process.argv[2];
(async () => {
    const problems = [];
    const left = [];
    let n = 0;
    for (const f of fs.readdirSync(path.join(__dirname, 'runs-newcode')).sort()) {
        const j = require(`./runs-newcode/${f}`);
        n++;
        const set = j.variant === 'old' ? 'old' : 'new';
        const wantShas = Object.values(manifest.files).map((e) => e[set]);
        const gotShas = (j.assets || []).map((a) => (/sha=([0-9a-f]+)/.exec(a) || [])[1]);
        const bad = [];
        if (!(gotShas.length === 3 && gotShas.every((s) => wantShas.includes(s)))) bad.push('asset sha');
        const attrs = j.version.imgAttrs.every((a) => /width=\d+ height=\d+/.test(a));
        const noAttrs = j.version.imgAttrs.every((a) => a.includes('width=null height=null'));
        if (set === 'old' ? !noAttrs : !attrs) bad.push('img attrs');
        const wantLinks = j.variant === 'new' ? (j.miniport === 'none' ? 1 : 2) : 0;
        if (j.version.pagePreloads.length !== wantLinks) bad.push(`preload links ${j.version.pagePreloads.length}`);
        if (j.sheetRules.badgeImgRule.aspectRatio !== (set === 'old' ? '' : '704 / 298')) bad.push('css rule');
        if (!(j.variantBefore.ok && j.variantAfter.ok)) bad.push('cache rows');
        if (j.waitedPastLoadMs < 8000) bad.push(`waited only ${j.waitedPastLoadMs}`);
        if (j.ackDropped) bad.push(`acks dropped ${j.ackDropped}`);
        if (bad.length) problems.push(`${j.label}: ${bad.join(', ')}`);
        if (j.painted && j.wm === '6.1') {
            const dir = path.join(F, j.label);
            const ins = j.ev.find((e) => e[1] === 'inserted')[0];
            const done = j.ev.find((e) => e[1] === 'data-wm-boot' && e[2] === 'done')[0];
            const judged = new Set(j.painted.frames.map((x) => x[0]));
            const first = j.painted.firstSplashFrameAt;
            for (const g of fs.readdirSync(dir)) {
                const t = Number(/-(-?\d+)ms\.png$/.exec(g)[1]);
                if (t >= ins && t < done && !judged.has(t)) left.push({ run: j.label, variant: j.variant, t, beforeFirstSplashFrame: first === null || t < first, file: path.join(dir, g) });
            }
        }
    }
    console.log(`runs audited: ${n}; runs with a problem in version proof / cache rows / wait: ${problems.length}`);
    problems.forEach((p) => console.log('  ' + p));
    console.log(`frames between insertion and end not judged as splash frames: ${left.length} (before the first splash frame: ${left.filter((x) => x.beforeFirstSplashFrame).length}, after it: ${left.filter((x) => !x.beforeFirstSplashFrame).length})`);
    left.filter((x) => !x.beforeFirstSplashFrame).slice(0, 12).forEach((x) => console.log('  after:', x.run, x.t, x.file));
    left.filter((x) => x.beforeFirstSplashFrame).slice(0, 6).forEach((x) => console.log('  before:', x.run, x.t, x.file));
})();
