'use strict';
// One table row per run in runs/*.json (times are page ms since navigation start).  node summarize.js > summary.txt
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'runs');
const NAMES = ['boot-melaton.png', 'cafe-ready-dark.png'];
const rows = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f)));
    const at = (k, n) => { const e = j.ev.find((x) => x[1] === k && x[2].startsWith(n || '')); return e ? e[0] : '-'; };
    const res = NAMES.map((n) => (j.resources[n] || [])[0] || {});
    const p = j.painted || {};
    const swHit = j.serviceWorkerTrace.artRows.map((r) => (/ (hit|miss)=(\d+)/.exec(r.row) || []).slice(1).join('')).join(',');
    const swH = j.serviceWorkerTrace.artRows.map((r) => (/h=(\d+)/.exec(r.row) || [])[1]).join(',');
    rows.push({
        run: j.label, rate: j.rate, ins: at('inserted'),
        'reqStart E/B': res.map((r) => r.startTime ?? '-').join('/'),
        'respEnd E/B': res.map((r) => r.responseEnd ?? '-').join('/'),
        'load E/B': NAMES.map((n) => at('load', n)).join('/'),
        '1stFrame': p.firstSplashFrameAt ?? '-', '1stFrameArt E/B': p.firstSplashFrameAt ? `${p.firstFrameEmblem ? 'y' : 'NO'}/${p.firstFrameBadge ? 'y' : 'NO'}` : '-',
        fullArt: p.firstSplashFrameAt ? (p.firstFullArtFrameAt ?? 'never') : '-', splashPainted: at('data-wm-splash-painted'), done: at('data-wm-boot', 'done'),
        'SW h ms': swH, 'SW': swHit, 'entries E/B': NAMES.map((n) => (j.resources[n] || []).length).join('/'),
        'xfer E/B': res.map((r) => r.transferSize ?? '-').join('/'), 'workerStart E/B': res.map((r) => r.workerStart ?? '-').join('/'),
        'reqs before/in flight (E)': res[0].requestsStartedBefore !== undefined ? `${res[0].requestsStartedBefore}/${res[0].requestsInFlightAtStart}` : '-'
    });
}
const order = (r) => [r.run.replace(/-(plain|preload)-/, '-').replace(/-\d+$/, ''), r.rate, r.run];
rows.sort((a, b) => a.rate - b.rate || String(order(a)).localeCompare(String(order(b))));
const keys = Object.keys(rows[0]);
const width = keys.map((k) => Math.max(k.length, ...rows.map((r) => String(r[k]).length)));
for (const line of [keys, ...rows.map((r) => keys.map((k) => r[k]))]) console.log(line.map((v, i) => String(v).padEnd(width[i])).join('  ').trimEnd());
