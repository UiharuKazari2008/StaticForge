'use strict';
/**
 * loadFaults mtime cache: identity, missing file, parse error, no cache poison, reread on mtime change.
 * Credit: grok.menma
 */
process.env.QUICKCAST_SUPERVISE = '0';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avosd-faults-'));
const faultPath = path.join(dataDir, 'faults.json');

const avOsd = require('../modules/avOsd.js');
avOsd.init({
    dataDir,
    ruiko: { connect: async () => {} },
    readConfig: () => ({ satellite: { name: 'SAT' }, cabinets: [], obs: {} }),
    globalResources: { getLogger: () => ({ info() {}, warn() {}, error() {} }) },
    satelliteName: () => 'SAT'
});

function countReads(fn) {
    const orig = fs.readFileSync;
    let n = 0;
    fs.readFileSync = function (p, ...rest) {
        if (path.basename(String(p)) === 'faults.json') n++;
        return orig.apply(this, [p, ...rest]);
    };
    try {
        const result = fn();
        return { n, result };
    } finally { fs.readFileSync = orig; }
}

/** Move mtime strictly past the file stamp, wall clock, and any earlier bump (writeFileSync can reset mtime backward). */
let bumpAt = 0;
function bumpMtime() {
    const st = fs.statSync(faultPath);
    bumpAt = Math.max(bumpAt, st.mtimeMs, Date.now()) + 2000;
    const next = bumpAt / 1000;
    fs.utimesSync(faultPath, next, next);
}

// 1. Missing file: no throw, empty, nothing cached as a hit
assert.deepStrictEqual(avOsd._loadFaults(), {});
assert.deepStrictEqual(avOsd.faults(), []);

// 2. Written file is loaded
const payload = { sat: { at: 1, items: [{ label: 'cam', bypass: false }] } };
fs.writeFileSync(faultPath, JSON.stringify(payload));
const first = avOsd._loadFaults();
assert.deepStrictEqual(first, payload);

// 3. Same mtime: no second read
const hit = countReads(() => avOsd._loadFaults());
assert.strictEqual(hit.n, 0, 'cache should skip readFileSync when mtime is unchanged');
assert.deepStrictEqual(hit.result, payload);

// 4. Caller mutation must not poison the cache
hit.result.sat.items[0].label = 'POISON';
hit.result.extra = true;
assert.deepStrictEqual(avOsd._loadFaults(), payload, 'cached data must be returned as a copy');

// 5. Parse error: no throw, do not keep a cached empty as authoritative
fs.writeFileSync(faultPath, '{not-json');
assert.deepStrictEqual(avOsd._loadFaults(), {});
fs.writeFileSync(faultPath, JSON.stringify(payload));
bumpMtime();
assert.deepStrictEqual(avOsd._loadFaults(), payload, 'after a parse error, a later good read must work');

// 6. mtime change reloads
const newer = { sat: { at: 2, items: [{ label: 'ref', bypass: false }] } };
fs.writeFileSync(faultPath, JSON.stringify(newer));
bumpMtime();
const miss = countReads(() => avOsd._loadFaults());
assert.ok(miss.n >= 1, 'mtime change should reread');
assert.deepStrictEqual(miss.result, newer);

// 7. Delete file: no throw, no stale cache
fs.unlinkSync(faultPath);
assert.deepStrictEqual(avOsd._loadFaults(), {});

fs.rmSync(dataDir, { recursive: true, force: true });
console.log('PASS: test-quickcast-faults-perf');
