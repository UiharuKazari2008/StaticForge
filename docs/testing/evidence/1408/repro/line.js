'use strict';
// One line for one old-vs-new run.  node line.js <run.json>
const j = require(require('path').resolve(process.argv[2]));
const at = (k) => { const e = j.ev.find((x) => x[1] === k); return e ? e[0] : null; };
const p = j.painted;
const shown = j.ev.filter((e) => e[1] === 'badge-shown');
const art = Object.keys(j.resources);
const isNew = !!(j.version && j.version.pagePreloads.length);
console.log([j.label, `ran=${j.version.imgAttrs[0].includes('width=256') ? 'newJS' : 'oldJS'}${isNew ? '+preload' : ''}`, `var=${j.variantBefore.ok && j.variantAfter.ok ? 'ok' : 'BAD'}${j.variantBefore.reappliedBeforeThisRun ? '(reapplied)' : ''}`,
    `1st=${p.firstSplashFrameAt ? `${p.firstFrameEmblem ? 'emblem' : 'NO-emblem'},${p.firstFrameBadgeState}` : 'none'}`,
    `badgeFrames c/a/i=${p.badgeFrames.complete}/${p.badgeFrames.absent}/${p.badgeFrames.incomplete}`,
    `shown=${shown.length ? shown.map((e) => `${e[0]}[${e[2].replace('imgComplete=', 'c=').replace('naturalWidth=', 'w=')}]`).join('+') : 'never'}`, `done=${at('data-wm-boot') === null ? '?' : j.ev.find((e) => e[1] === 'data-wm-boot' && e[2] === 'done')[0]}`, `ins=${at('inserted')}`,
    `req/img=${art.map((n) => j.pageNetwork.filter((r) => r.url === n).length).join('/')}`, `entries=${art.map((n) => j.resources[n].length).join('/')}`, `swRows=${Object.values(j.swRowsPerArt).join('/')}`, `swNet=${j.serviceWorkerNetwork.length}`,
    `preloadWarn=${j.consolePreload.length}`].join(' '));
