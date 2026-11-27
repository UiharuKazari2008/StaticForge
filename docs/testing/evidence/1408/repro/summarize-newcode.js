'use strict';
// Grouped results of the old-vs-new runs.  node summarize-newcode.js > newcode-summary.txt
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'runs-newcode');
const G = new Map();
const names = { m8: '8 cores, cached', core1: 'one core', core1rev: 'one core, new first', off: 'OFFLINE', gate: 'new JS+CSS, NO preload', late: 'link up 600 ms after splash', fail: 'rows deleted + offline', wm65: '6.5' };
for (const f of fs.readdirSync(dir).sort()) {
    const j = require(path.join(dir, f));
    const tag = j.label.split('-')[0];
    if (/^warm/.test(tag)) continue;
    const k = `${names[tag]} | ${j.rate}x | ${j.variant}`;
    if (!G.has(k)) G.set(k, { order: [Object.keys(names).indexOf(tag), j.rate, j.variant === 'old' ? 0 : 1], runs: [] });
    G.get(k).runs.push(j);
}
const range = (v) => (v.length ? (Math.min(...v) === Math.max(...v) ? String(v[0]) : `${Math.min(...v)}..${Math.max(...v)}`) : '-');
const ev = (j, k, v) => j.ev.find((e) => e[1] === k && (v === undefined || e[2] === v));
let total = { newRuns: 0 };
console.log('(a) first splash frame has both pictures | (b) boots that painted an incomplete badge | (c) boots that painted the complete badge before the splash ended');
console.log('(d) requests per picture, page / resource entries / worker fetches; worker network requests; preload console warnings');
console.log('times: page ms. "shown" = the badge element unhidden; "shown after end" = that happened after data-wm-boot=done\n');
for (const [k, g] of [...G].sort((a, b) => a[1].order[0] - b[1].order[0] || a[1].order[1] - b[1].order[1] || a[1].order[2] - b[1].order[2])) {
    const r = g.runs;
    const painted = r.filter((j) => j.painted && j.wm === '6.1');
    const parts = [`${k}`.padEnd(52), `n=${r.length}`];
    if (painted.length) {
        parts.push(`(a) ${painted.filter((j) => j.painted.firstFrameEmblem && j.painted.firstFrameBadgeState === 'complete').length}/${painted.length}`);
        parts.push(`[emblem ${painted.filter((j) => j.painted.firstFrameEmblem).length}, badge ${['complete', 'absent', 'incomplete'].map((s) => `${s[0]}=${painted.filter((j) => j.painted.firstFrameBadgeState === s).length}`).join(' ')}]`);
        parts.push(`(b) ${painted.filter((j) => j.painted.badgeFrames.incomplete > 0).length}/${painted.length}`);
        parts.push(`(c) ${painted.filter((j) => j.painted.badgeFrames.complete > 0).length}/${painted.length}`);
    }
    const art = (j) => Object.keys(j.resources);
    parts.push(`(d) ${range(r.flatMap((j) => art(j).map((n) => j.pageNetwork.filter((p) => p.url === n).length)))}/${range(r.flatMap((j) => art(j).map((n) => j.resources[n].length)))}/${range(r.flatMap((j) => Object.values(j.swRowsPerArt)))}`);
    parts.push(`swNet ${range(r.map((j) => j.serviceWorkerNetwork.length))}`, `warn ${range(r.map((j) => j.consolePreload.length))}`);
    parts.push(`| shown with picture not in: ${r.filter((j) => j.ev.some((e) => e[1] === 'badge-shown' && /naturalWidth=0/.test(e[2]))).length}/${r.length}`);
    parts.push(`never shown ${r.filter((j) => !ev(j, 'badge-shown')).length}, shown after end ${r.filter((j) => ev(j, 'badge-shown') && ev(j, 'badge-shown')[0] > ev(j, 'data-wm-boot', 'done')[0]).length}`);
    parts.push(`| splash inserted ${range(r.map((j) => ev(j, 'inserted')[0]))}`);
    if (painted.length) parts.push(`first frame ${range(painted.map((j) => j.painted.firstSplashFrameAt))}`);
    console.log(parts.join('  '));
}
const pairs = (tag, rate) => {
    const out = [];
    for (const [, g] of G) for (const j of g.runs) {
        if (j.variant !== 'old' || !j.label.startsWith(`${tag}-old-r${rate}-`)) continue;
        const p = path.join(dir, `${j.label.replace('-old-', '-new-')}.json`);
        if (!fs.existsSync(p)) continue;
        const w = require(p);
        out.push({ insert: ev(w, 'inserted')[0] - ev(j, 'inserted')[0], firstFrame: w.painted && j.painted ? w.painted.firstSplashFrameAt - j.painted.firstSplashFrameAt : null, done: ev(w, 'data-wm-boot', 'done')[0] - ev(j, 'data-wm-boot', 'done')[0], load: Math.max(...w.hostLoad1).toFixed(1) + '/' + Math.max(...j.hostLoad1).toFixed(1), i: Number(j.label.split('-').pop()) });
    }
    return out.sort((a, b) => a.i - b.i);
};
console.log('\nnew minus old, per pair (ms; + = new later)');
for (const [tag, rate, what] of [['m8', 1, '8 cores 1x (old ran first)'], ['m8', 6, '8 cores 6x (old first)'], ['m8', 12, '8 cores 12x (old first)'], ['core1', 1, 'one core (old first)'], ['core1rev', 1, 'one core (new first)']]) {
    const p = pairs(tag, rate);
    console.log(`${what.padEnd(28)} splash inserted ${p.map((x) => x.insert).join(', ')}  | first frame ${p.map((x) => x.firstFrame).join(', ')}  | splash end ${p.map((x) => x.done).join(', ')}  | host load new/old ${p.map((x) => x.load).join(', ')}`);
}
