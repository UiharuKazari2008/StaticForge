'use strict';
// The version proof and the new-run facts of one run.  node show.js <run.json> ...
for (const f of process.argv.slice(2)) {
    const j = require(require('path').resolve(f));
    console.log('==', j.label, 'variant', j.variant, 'before ok', j.variantBefore && j.variantBefore.ok, 'reapplied', j.variantBefore && j.variantBefore.reappliedBeforeThisRun, 'after ok', j.variantAfter && j.variantAfter.ok);
    console.log(' ran:', JSON.stringify(j.version), '\n assets:', JSON.stringify((j.assets || []).map((a) => a.replace(/(sha=[0-9a-f]{16})[0-9a-f]+/, '$1'))), '\n sheet rules:', JSON.stringify(j.sheetRules));
    console.log(' events:', j.ev.filter((e) => !/DOMContentLoaded/.test(e[1])).map((e) => `${e[0]} ${e[1]} ${e[2].slice(0, 90)}`).join('\n         '));
    console.log(' resources:', JSON.stringify(Object.fromEntries(Object.entries(j.resources).map(([k, v]) => [k, v.map((e) => [e.initiatorType, e.startTime, e.responseEnd, e.transferSize])]))));
    console.log(' page requests:', JSON.stringify(j.pageNetwork.map((p) => [p.url, p.type, p.priority, p.initiator, p.fromServiceWorker, p.status, p.failed || ''])), 'sw trace rows per picture', JSON.stringify(j.swRowsPerArt), 'sw network', JSON.stringify(j.serviceWorkerNetwork.map((x) => x.url)));
    console.log(' console preload:', JSON.stringify(j.consolePreload), '| naming art:', JSON.stringify(j.consoleNamingArt), '| rows seen', j.consoleRowsSeen, '| waited past load', j.waitedPastLoadMs, '| bogus requests', j.bogusRequests, '| ackDropped', j.ackDropped);
    console.log(' box:', JSON.stringify(j.box), '\n styles:', JSON.stringify(j.styles));
}
