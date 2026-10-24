#!/usr/bin/env node
// public/sw.js cache upkeep without whole-cache scans (Oct 24 perf pass): the image policy on
// metadata alone (and its listing reconcile for maintenance), the per-file purge as one exact
// delete, the shell lookup as an exact match. Run: node scripts/test-sw-cache-upkeep.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

// A top-level function's source: from its declaration to the first "\n}\n" after it
function fnSource(name) {
    const at = src.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
    assert.ok(at >= 0, name + ' in sw.js');
    const end = src.indexOf('\n}\n', at);
    return src.slice(at, end + 3);
}

// No whole-cache scans on the hot paths
assert.ok(!/ignoreSearch: true/.test(src), 'no ignoreSearch matches left in sw.js');
assert.ok(!/cache\.keys\(\)/.test(fnSource('purgeStaticCacheEntriesNow')), 'the per-file purge does not list the cache');
assert.ok(!/cache\.keys\(\)/.test(fnSource('matchStaticShell')), 'the shell lookup does not list the cache');
const activate = src.slice(src.indexOf("self.addEventListener('activate'"), src.indexOf('// Send network activity event'));
assert.ok(!/enforceImageCachePolicy|tidyStaticRows|dropMislabelledStaticRows|cache\.keys\(\)/.test(activate),
    'activation holds no cache upkeep');

function imageWorld({ rows, entries, rules }) {
    const cache = new Map(rows.map((u) => [u, true]));
    let keysCalls = 0;
    const metadata = { sequence: 100, rules: rules || { favoriteUrls: [], lockedPreviewUrls: [] }, entries };
    const ctx = {
        Date, Map, Set, Object, Promise, URL,
        IMAGE_CACHE: 'image', IMAGE_CACHE_POLICY: { maxEntries: 3, maxSizeBytes: 1e9, maxIdleMs: 1000 },
        EXPLORER_VFS_PREVIEW_PATH: /^\/[0-9a-f-]{36}\/previews\/[^/]+$/i,
        self: { location: { origin: 'http://x' } },
        perfSpan: (name, fn) => fn(),
        readImageMetadata: async () => metadata,
        writeImageMetadata: async () => {},
        getCanonicalUrl: (u) => u,
        caches: { open: async () => ({
            keys: async () => { keysCalls += 1; return Array.from(cache.keys()).map((u) => ({ url: u })); },
            delete: async (k) => cache.delete(typeof k === 'string' ? k : k.url)
        }) }
    };
    vm.createContext(ctx);
    vm.runInContext([fnSource('isManagedImageCacheUrl'), fnSource('isFullImageUrl'),
        fnSource('enforceImageCachePolicy'), fnSource('enforceImageCachePolicyNow')].join('\n')
        + '\nthis.api = { enforceImageCachePolicy, enforceImageCachePolicyNow };', ctx);
    return { api: ctx.api, cache, metadata, keysCalls: () => keysCalls };
}

(async () => {
    const now = Date.now();
    const P = (n) => '/previews/p' + n + '.webp';

    // metadata only: expired goes, pinned stays even when expired, capacity evicts oldest seq
    let w = imageWorld({
        rows: [P(1), P(2), P(3), P(4), P(5)],
        rules: { favoriteUrls: [P(2)], lockedPreviewUrls: [] },
        entries: {
            [P(1)]: { seq: 1, lastAccess: now - 5000, size: 1 },   // expired
            [P(2)]: { seq: 2, lastAccess: now - 5000, size: 1 },   // expired but a favourite
            [P(3)]: { seq: 3, lastAccess: now, size: 1 },
            [P(4)]: { seq: 4, lastAccess: now, size: 1 },
            [P(5)]: { seq: 5, lastAccess: now, size: 1 }
        }
    });
    await w.api.enforceImageCachePolicy();
    assert.strictEqual(w.keysCalls(), 0, 'the hit-path policy does not list the cache');
    // 5 entries, cap 3: P1 expired, then capacity takes the oldest unpinned (P1 again, P3)
    assert.deepStrictEqual(Array.from(w.cache.keys()).sort(), [P(2), P(4), P(5)]);
    assert.deepStrictEqual(Object.keys(w.metadata.entries).sort(), [P(2), P(4), P(5)]);
    assert.strictEqual(w.metadata.entries[P(2)].pinned, true);

    // reconcile (maintenance): full images go, entries without a row go, rows without an entry are tracked
    w = imageWorld({
        rows: [P(1), P(7), '/images/full.png'],
        entries: { [P(1)]: { seq: 1, lastAccess: now, size: 1 }, [P(9)]: { seq: 9, lastAccess: now, size: 1 } }
    });
    await w.api.enforceImageCachePolicyNow({ reconcile: true });
    assert.strictEqual(w.keysCalls(), 1);
    assert.deepStrictEqual(Array.from(w.cache.keys()).sort(), [P(1), P(7)]);
    assert.deepStrictEqual(Object.keys(w.metadata.entries).sort(), [P(1), P(7)]);

    // purge: one exact delete of the bare path, every Vary variant
    const deletes = [];
    const ctx = { URL, self: { location: { origin: 'http://x' } } };
    vm.createContext(ctx);
    vm.runInContext(fnSource('purgeStaticCacheEntriesNow') + '\nthis.purge = purgeStaticCacheEntriesNow;', ctx);
    await ctx.purge({ delete: async (key, opts) => { deletes.push([key, opts]); return true; } }, '/scripts/a.js?sha=1');
    assert.strictEqual(JSON.stringify(deletes), JSON.stringify([['http://x/scripts/a.js', { ignoreVary: true }]]));

    // extensionless paths (API, /status, /logon-picture) skip the static cache entirely
    const ext = {};
    vm.createContext(ext);
    vm.runInContext(fnSource('hasFileExtension') + '\nthis.has = hasFileExtension;', ext);
    for (const p of ['/css/app.css', '/sounds/vista/Windows%20Ding.wav', '/.login.jpg', '/dist/nai-svg/img2img.aa3e7184.svg']) {
        assert.strictEqual(ext.has(p), true, p);
    }
    for (const p of ['/status', '/logon-picture', '/api/workspaces', '/agent/session/state', '/']) {
        assert.strictEqual(ext.has(p), false, p);
    }
    assert.ok(/else if \(!hasFileExtension\(url\.pathname\)\)/.test(src), 'the static branch sends extensionless paths to the network');

    // the boot's cache check of an unchanged manifest: routes plus an evenly spread sample
    const mgr = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'comp', 'serviceWorkerManager.js'), 'utf8');
    const sAt = mgr.indexOf('function sampleManifestFiles(');
    const sCtx = { Math, Array };
    vm.createContext(sCtx);
    vm.runInContext(mgr.slice(sAt, mgr.indexOf('\n}\n', sAt) + 3) + '\nthis.sample = sampleManifestFiles;', sCtx);
    const files = [{ url: '/', type: 'route' }, { url: '/app', type: 'route' }, { url: '/launch', type: 'route' }]
        .concat(Array.from({ length: 5000 }, (_, i) => ({ url: '/f' + i + '.js' })));
    const picked = sCtx.sample(files, 200);
    assert.ok(picked.length >= 200 && picked.length <= 203, 'about 200 files: ' + picked.length);
    assert.ok(['/', '/app', '/launch'].every((u) => picked.some((f) => f.url === u)), 'the routes are always checked');
    const idx = picked.filter((f) => /^\/f/.test(f.url)).map((f) => +f.url.slice(2, -3));
    assert.ok(Math.min(...idx) < 50 && Math.max(...idx) > 4900, 'spread over the whole list');
    assert.strictEqual(sCtx.sample(files.slice(0, 50), 200).length, 50, 'a short list is checked whole');
    assert.ok(/sampleManifestFiles\(snapshot, BOOT_CACHE_SAMPLE\)/.test(mgr), 'the boot check samples');

    console.log('test-sw-cache-upkeep: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
