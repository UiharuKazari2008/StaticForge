'use strict';

/**
 * Checkpoint tiered retention (modules/checkpointGrandfathering.js).
 * Run: node scripts/test-checkpoint-retention.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const G = require('../modules/checkpointGrandfathering');

const ISO = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}\./;
const pad = (n, w = 2) => String(n).padStart(w, '0');

function stamp(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function writeCheckpoint(dir, tier, date, ext = '.db', sidecars = false) {
    const file = path.join(dir, tier, `${stamp(date)}${ext}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, date, date);
    if (sidecars) {
        fs.writeFileSync(`${file}-wal`, '');
        fs.writeFileSync(`${file}-shm`, '');
    }
    return file;
}

function list(dir, tier, suffix = '.db') {
    const d = path.join(dir, tier);
    return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.endsWith(suffix)).sort() : [];
}

function fakeGlobalResources(cacheRoot, checkpointsCfg = {}) {
    return {
        getConfig: () => JSON.parse(JSON.stringify(checkpointsCfg)),
        getPath: () => cacheRoot
    };
}

// ext4 returns directory entries in hash order, so a `-shm`/`-wal` sidecar can be listed
// before its checkpoint. Force that order to make the test deterministic.
function withSidecarsListedFirst(fn) {
    const real = fs.readdirSync;
    fs.readdirSync = function patched(dir, opts) {
        const out = real.call(fs, dir, opts);
        if (opts && opts.withFileTypes) return out;
        const side = (n) => (/-(wal|shm)$/.test(n) ? 0 : 1);
        return [...out].sort((a, b) => side(a) - side(b) || (a < b ? -1 : a > b ? 1 : 0));
    };
    try {
        return fn();
    } finally {
        fs.readdirSync = real;
    }
}

const base = new Date(2026, 9, 1, 0, 0, 0, 0);
const hoursFrom = (h) => new Date(base.getTime() + h * 3600e3);

// 1. Extension detection must ignore SQLite sidecars.
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ext-'));
    for (let i = 0; i < 3; i++) writeCheckpoint(dir, 'hour', hoursFrom(i), '.db', true);
    const ext = withSidecarsListedFirst(() => G.detectCheckpointExt(dir));
    assert.strictEqual(ext, '.db', `detectCheckpointExt picked a sidecar extension: ${ext}`);
}

// 2. Boot reconcile prunes .db checkpoints even when sidecars are listed first.
{
    const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-boot-'));
    const dir = path.join(cacheRoot, 'checkpoints', 'tag_wiki');
    for (let i = 0; i < 10; i++) writeCheckpoint(dir, 'hour', hoursFrom(i), '.db', true);
    writeCheckpoint(dir, 'day', hoursFrom(-48), '.db', true);
    writeCheckpoint(dir, 'month', hoursFrom(-24 * 40), '.db', true);

    const result = withSidecarsListedFirst(() => G.reconcileAllCheckpointRetention(fakeGlobalResources(cacheRoot)));
    assert.strictEqual(result.dirs, 1);
    assert.deepStrictEqual(list(dir, 'hour'), [6, 7, 8, 9].map((h) => `${stamp(hoursFrom(h))}.db`),
        'default hour.max=4 should keep the 4 newest hourly buckets');
    assert.deepStrictEqual(list(dir, 'day'), [], 'default day.max=0 purges the day tier');
    assert.deepStrictEqual(list(dir, 'month'), [], 'default month.max=0 purges the month tier');
    for (const tier of G.TIERS) {
        for (const name of fs.readdirSync(path.join(dir, tier))) {
            if (!/-(wal|shm)$/.test(name)) continue;
            assert.ok(fs.existsSync(path.join(dir, tier, name.slice(0, -4))), `orphan sidecar left behind: ${tier}/${name}`);
        }
    }
}

// 3. Configured ladder thins hour -> day -> month (per-write cleanup path).
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ladder-'));
    const gr = fakeGlobalResources(dir, {
        grandfathering: {
            hour: { max: 4, rollover: 'day' },
            day: { max: 7, rollover: 'month' },
            month: { max: 3 }
        }
    });
    for (let h = 0; h < 24 * 40; h++) {
        writeCheckpoint(dir, 'hour', hoursFrom(h));
        G.applyGrandfathering(dir, '.db', gr, ISO, 'metadata');
    }
    assert.strictEqual(list(dir, 'hour').length, 4);
    assert.strictEqual(list(dir, 'day').length, 7);
    assert.ok(list(dir, 'month').length >= 1 && list(dir, 'month').length <= 3);
}

// 4. Per-resource overrides are keyed by the checkpoint directory / db stem.
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-override-'));
    for (let i = 0; i < 6; i++) writeCheckpoint(dir, 'hour', hoursFrom(i));
    const gr = fakeGlobalResources(dir, { overrides: { metadata: { hour: { max: 2 } } } });
    G.applyGrandfathering(dir, '.db', gr, ISO, 'metadata');
    assert.strictEqual(list(dir, 'hour').length, 2);
}

console.log('test-checkpoint-retention: ok');
