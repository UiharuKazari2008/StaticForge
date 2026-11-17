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
    let writes = 0;
    const metadata = { sequence: 100, rules: rules || { favoriteUrls: [], lockedPreviewUrls: [] }, entries };
    const ctx = {
        Date, Map, Set, Object, Promise, URL,
        IMAGE_CACHE: 'image', IMAGE_CACHE_POLICY: { maxEntries: 3, maxSizeBytes: 1e9, maxIdleMs: 1000 },
        EXPLORER_VFS_PREVIEW_PATH: /^\/[0-9a-f-]{36}\/previews\/[^/]+$/i,
        self: { location: { origin: 'http://x' } },
        perfSpan: (name, fn) => fn(),
        perfLog: () => {},
        setTimeout,
        IMAGE_POLICY_DELETES_PER_RUN: 300,
        IMAGE_POLICY_ENFORCE_MIN_INTERVAL_MS: 30000,
        scheduleImageCachePolicyEnforcement: () => {},
        readImageMetadata: async () => metadata,
        writeImageMetadata: async () => { writes += 1; },
        getCanonicalUrl: (u) => u,
        caches: { open: async () => ({
            keys: async () => { keysCalls += 1; return Array.from(cache.keys()).map((u) => ({ url: u })); },
            delete: async (k) => cache.delete(typeof k === 'string' ? k : k.url)
        }) }
    };
    vm.createContext(ctx);
    vm.runInContext(['let pinnedImageSetMemo = { favorites: null, locked: null, set: new Set() };',
        fnSource('pinnedImageSet'), fnSource('isManagedImageCacheUrl'), fnSource('isFullImageUrl'),
        fnSource('enforceImageCachePolicy'), fnSource('enforceImageCachePolicyNow')].join('\n')
        + '\nthis.api = { enforceImageCachePolicy, enforceImageCachePolicyNow };', ctx);
    return { api: ctx.api, cache, metadata, keysCalls: () => keysCalls, writes: () => writes };
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
    assert.strictEqual(w.writes(), 1, 'a run that evicted writes the metadata');
    // a run that changes nothing (every preview hit schedules one) does not rewrite the blob (#890)
    await w.api.enforceImageCachePolicy();
    assert.strictEqual(w.writes(), 1, 'nothing evicted, no pin changed: no write');
    w.metadata.rules = { favoriteUrls: [P(2), P(4)], lockedPreviewUrls: [] };
    await w.api.enforceImageCachePolicy();
    assert.strictEqual(w.writes(), 2, 'a pin that changed is written');
    assert.strictEqual(w.metadata.entries[P(4)].pinned, true);

    // reconcile (maintenance): full images go, entries without a row go, rows without an entry are tracked
    w = imageWorld({
        rows: [P(1), P(7), '/images/full.png'],
        entries: { [P(1)]: { seq: 1, lastAccess: now, size: 1 }, [P(9)]: { seq: 9, lastAccess: now, size: 1 } }
    });
    await w.api.enforceImageCachePolicyNow({ reconcile: true });
    assert.strictEqual(w.keysCalls(), 1);
    assert.strictEqual(w.writes(), 1, 'the reconcile changed entries: written');
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

    // ---- #890: the image metadata flush, the pinned set, exact deletes, the script copies' index ----

    // a clock and timers the test moves by hand
    function fakeTime() {
        let now = 1000000;
        let seq = 0;
        const timers = new Map();
        return {
            Date: { now: () => now },
            setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms || 0), fn }); return id; },
            clearTimeout: (id) => { timers.delete(id); },
            async advance(ms) {
                const end = now + ms;
                for (;;) {
                    let next = null;
                    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
                    if (!next) break;
                    timers.delete(next[0]);
                    now = next[1].at;
                    next[1].fn();
                    for (let i = 0; i < 5; i++) await Promise.resolve();
                }
                now = end;
                for (let i = 0; i < 5; i++) await Promise.resolve();
            },
            now: () => now
        };
    }

    const flushSrc = ['IMAGE_METADATA_FLUSH_IDLE_MS', 'IMAGE_METADATA_FLUSH_MIN_GAP_MS', 'IMAGE_METADATA_FLUSH_MAX_WAIT_MS']
        .map((name) => (new RegExp('^const ' + name + ' = [^;]+;', 'm').exec(src) || [''])[0]).join('\n');
    assert.ok(/IDLE_MS = 2000;[\s\S]*MIN_GAP_MS = 30000;[\s\S]*MAX_WAIT_MS = 30000;/.test(flushSrc), 'the flush constants');
    function metadataWorld() {
        const t = fakeTime();
        const puts = [];
        const ctx = {
            Promise, JSON, Math, Set, Map, Array, Object,
            Date: t.Date, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout,
            INTERNAL_CACHE: 'internal', IMAGE_METADATA_KEY: '/internal/meta',
            Response: class { constructor(body) { this.body = body; } },
            caches: { open: async () => ({ put: async (key, res) => { puts.push({ at: t.now(), body: res.body }); } }) }
        };
        vm.createContext(ctx);
        vm.runInContext([flushSrc,
            'let imageMetadataState = null; let imageMetadataFlushTimer = null; let imageMetadataDirtySince = 0;',
            'let imageMetadataLastFlushAt = 0; let imageMetadataPending = null; let imageMetadataWriting = Promise.resolve();',
            'let pinnedImageSetMemo = { favorites: null, locked: null, set: new Set() };',
            fnSource('writeImageMetadata'), fnSource('imageMetadataSettled'), fnSource('holdForImageMetadata'),
            fnSource('flushImageMetadataNow'), fnSource('runImageMetadataFlush'), fnSource('flushImageMetadata'),
            fnSource('pinnedImageSet'), fnSource('isPinnedImageUrl')].join('\n')
            + '\nthis.api = { writeImageMetadata, imageMetadataSettled, holdForImageMetadata, flushImageMetadataNow, pinnedImageSet, isPinnedImageUrl };', ctx);
        return { api: ctx.api, t, puts };
    }

    // a burst of hits: nothing written while they come, one write 2 s after the last
    let m = metadataWorld();
    const meta = { sequence: 1, rules: { favoriteUrls: [], lockedPreviewUrls: [] }, entries: {} };
    let settled = false;
    for (let i = 0; i < 20; i++) {
        meta.entries['/previews/' + i] = { seq: i };
        await m.api.writeImageMetadata(meta);
        if (i === 0) m.api.imageMetadataSettled().then(() => { settled = true; });
        await m.t.advance(100);
    }
    assert.strictEqual(m.puts.length, 0, 'no write while previews keep coming');
    assert.strictEqual(settled, false, 'the batch is not written yet');
    await m.t.advance(2000);
    assert.strictEqual(m.puts.length, 1, 'one write once they stop');
    assert.strictEqual(Object.keys(JSON.parse(m.puts[0].body).entries).length, 20, 'the write carries every change');
    assert.strictEqual(settled, true, 'imageMetadataSettled resolves with the write');

    // a second burst soon after: held to one write per 30 s
    meta.entries['/previews/x'] = { seq: 99 };
    await m.api.writeImageMetadata(meta);
    await m.t.advance(5000);
    assert.strictEqual(m.puts.length, 1, 'not again within 30 s of the last write');
    await m.t.advance(30000);
    assert.strictEqual(m.puts.length, 2, 'written once the gap is over');
    assert.ok(m.puts[1].at - m.puts[0].at >= 30000, 'at least 30 s apart');

    // previews that never stop (a hit every 500 ms for 2 minutes): a write about every 30 s, not every 1.5 s
    m = metadataWorld();
    for (let i = 0; i < 240; i++) {
        meta.entries['/previews/c' + i] = { seq: i };
        await m.api.writeImageMetadata(meta);
        await m.t.advance(500);
    }
    assert.ok(m.puts.length >= 3 && m.puts.length <= 5, 'about one write per 30 s while busy: ' + m.puts.length);
    for (let i = 1; i < m.puts.length; i++) assert.ok(m.puts[i].at - m.puts[i - 1].at >= 30000, 'never closer than 30 s');

    // flushImageMetadataNow writes at once (rule changes, maintenance)
    m = metadataWorld();
    await m.api.writeImageMetadata(meta);
    await m.api.flushImageMetadataNow();
    assert.strictEqual(m.puts.length, 1, 'written now');
    await m.t.advance(60000);
    assert.strictEqual(m.puts.length, 1, 'and not again with nothing new');

    // holdForImageMetadata: the event waits for the pending write
    m = metadataWorld();
    await m.api.writeImageMetadata(meta);
    const held = [];
    m.api.holdForImageMetadata({ waitUntil: (p) => held.push(p) });
    assert.strictEqual(held.length, 1, 'the event is extended');
    let heldDone = false;
    held[0].then(() => { heldDone = true; });
    await m.t.advance(100);
    assert.strictEqual(heldDone, false);
    await m.t.advance(3000);
    assert.strictEqual(heldDone, true, 'until the batch is written');
    assert.ok(/event\.waitUntil\(updateImageMetadataForHit\(canonicalUrl\)\.then\(imageMetadataSettled\)\)/.test(src), 'an image hit holds the worker for its batch');

    // the pinned Set: built once, rebuilt only when the lists are replaced
    const rules = { favoriteUrls: ['/previews/a'], lockedPreviewUrls: ['/previews/b'] };
    const md = { rules };
    const first = m.api.pinnedImageSet(md);
    assert.strictEqual(m.api.pinnedImageSet(md), first, 'the same Set on every hit');
    assert.ok(m.api.isPinnedImageUrl('/previews/a', md) && m.api.isPinnedImageUrl('/previews/b', md) && !m.api.isPinnedImageUrl('/previews/c', md));
    rules.favoriteUrls = ['/previews/c'];
    assert.notStrictEqual(m.api.pinnedImageSet(md), first, 'new lists, new Set');
    assert.ok(m.api.isPinnedImageUrl('/previews/c', md) && !m.api.isPinnedImageUrl('/previews/a', md));
    assert.ok(!/new Set\(metadata\.rules/.test(fnSource('isPinnedImageUrl') + fnSource('enforceImageCachePolicyNow')), 'no per-hit Sets');

    // deleteUrlFromCaches: one exact delete per cache, no listing
    const delCalls = [];
    const dctx = {
        URL, self: { location: { origin: 'http://x' } },
        IMAGE_CACHE: 'image', STATIC_CACHE: 'static', DYNAMIC_CACHE: 'dynamic', WALLPAPER_CACHE: 'wall',
        EXPLORER_VFS_PREVIEW_PATH: /^\/[0-9a-f-]{36}\/previews\/[^/]+$/i,
        deleteImageMetadata: async (urls) => { delCalls.push(['meta', urls]); },
        caches: { open: async (name) => ({
            keys: async () => { throw new Error('listed ' + name); },
            delete: async (key, opts) => { delCalls.push([name, key, opts]); return name === 'static'; }
        }) }
    };
    vm.createContext(dctx);
    vm.runInContext([fnSource('absoluteAssetUrl'), fnSource('isManagedImageCacheUrl'), fnSource('isStudioGalleryImageUrl'),
        fnSource('deleteUrlFromCaches')].join('\n') + '\nthis.del = deleteUrlFromCaches;', dctx);
    const removed = await dctx.del('/static_images/x.png?v=2');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(delCalls)), [
        ['static', 'http://x/static_images/x.png', { ignoreVary: true }],
        ['dynamic', 'http://x/static_images/x.png', { ignoreVary: true }],
        ['wall', 'http://x/static_images/x.png', { ignoreVary: true }],
        ['meta', ['http://x/static_images/x.png']]
    ]);
    assert.deepStrictEqual(Array.from(removed), ['http://x/static_images/x.png']);

    // the script copies: one listing per worker, then the index; the old hash's copy goes
    const scKeys = new Map([['http://x/scripts/a.js?sha=1', 1], ['http://x/scripts/b.js?sha=9', 1]]);
    let scLists = 0;
    const scCache = {
        keys: async () => { scLists += 1; return Array.from(scKeys.keys()).map((url) => ({ url })); },
        put: async (key) => { scKeys.set(key, 1); },
        delete: async (key) => scKeys.delete(key)
    };
    const sctx = { Map, Set, Promise };
    vm.createContext(sctx);
    vm.runInContext('let scriptCodeKeyIndex = null;\n' + fnSource('scriptCodeKeys') + fnSource('keepScriptCodeRow')
        + '\nthis.keep = keepScriptCodeRow;', sctx);
    await sctx.keep(scCache, 'http://x/scripts/a.js', 'http://x/scripts/a.js?sha=2', {});
    await sctx.keep(scCache, 'http://x/scripts/c.js', 'http://x/scripts/c.js?sha=5', {});
    await sctx.keep(scCache, 'http://x/scripts/a.js', 'http://x/scripts/a.js?sha=3', {});
    assert.strictEqual(scLists, 1, 'the small cache is listed once');
    assert.deepStrictEqual(Array.from(scKeys.keys()).sort(), ['http://x/scripts/a.js?sha=3', 'http://x/scripts/b.js?sha=9', 'http://x/scripts/c.js?sha=5']);

    // ---- #890: replies go to the page that asked; NETWORK_ACTIVITY skips hidden and opted-out windows ----
    const posted = [];
    const client = (id, visibilityState) => ({ id, visibilityState, postMessage: (m2) => posted.push([id, m2.type]) });
    const stored = new Map();
    let allClients = [client('a', 'visible'), client('b', 'hidden'), client('c', 'visible')];
    const nctx = {
        Promise, Set, JSON, Array,
        INTERNAL_CACHE: 'internal', NETWORK_ACTIVITY_OPT_OUT_KEY: '/internal/opt-out',
        Response: class { constructor(body) { this.body = body; } json() { return Promise.resolve(JSON.parse(this.body)); } },
        self: { clients: { matchAll: async () => allClients } },
        caches: { open: async () => ({
            match: async (key) => stored.get(key),
            put: async (key, res) => { stored.set(key, res); }
        }) }
    };
    vm.createContext(nctx);
    vm.runInContext('let networkActivityOptOut = null; let networkActivityOptOutLoad = null;\n'
        + [fnSource('replyToSource'), fnSource('loadNetworkActivityOptOut'), fnSource('saveNetworkActivityOptOut'),
            fnSource('setNetworkActivityOptOut'), fnSource('networkActivityClients')].join('\n')
        + '\nthis.api = { replyToSource, setNetworkActivityOptOut, networkActivityClients, reset: () => { networkActivityOptOut = null; } };', nctx);
    nctx.api.replyToSource(allClients[2], { type: 'ping' });
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(posted, [['c', 'ping']], 'the ping answer goes to the page that asked');
    posted.length = 0;
    nctx.api.replyToSource(null, { type: 'X' });
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(posted.length, 3, 'no source: every window, as before');
    assert.deepStrictEqual((await nctx.api.networkActivityClients()).map((c2) => c2.id), ['a', 'c'], 'a hidden window gets none');
    await nctx.api.setNetworkActivityOptOut(allClients[2], true);
    assert.deepStrictEqual((await nctx.api.networkActivityClients()).map((c2) => c2.id), ['a'], 'an opted-out page gets none');
    nctx.api.reset(); // a worker started again reads the opt-outs back
    assert.deepStrictEqual((await nctx.api.networkActivityClients()).map((c2) => c2.id), ['a'], 'kept across a worker restart');
    await nctx.api.setNetworkActivityOptOut(allClients[2], false);
    assert.deepStrictEqual((await nctx.api.networkActivityClients()).map((c2) => c2.id), ['a', 'c'], 'and opts back in');
    await nctx.api.setNetworkActivityOptOut(allClients[0], true);
    allClients = [client('c', 'visible')]; // a closed: its id is forgotten
    await nctx.api.networkActivityClients();
    assert.deepStrictEqual(JSON.parse(stored.get('/internal/opt-out').body), [], 'closed windows are dropped from the list');
    // the ping: the page that asked and the hidden windows (they do not ping while hidden; their tray
    // reads the last answer's time), not the other visible windows (each pings on its own)
    const pctx = { Promise, Date, self: nctx.self };
    vm.createContext(pctx);
    vm.runInContext(fnSource('replyToSource') + fnSource('answerPing') + '\nthis.answer = answerPing;', pctx);
    allClients = [client('a', 'visible'), client('b', 'hidden'), client('c', 'visible'), client('d', 'hidden')];
    posted.length = 0;
    await pctx.answer(allClients[2]);
    assert.deepStrictEqual(posted, [['c', 'ping'], ['b', 'ping'], ['d', 'ping']], 'the asking page and the hidden windows');
    posted.length = 0;
    await pctx.answer(allClients[1]);
    assert.deepStrictEqual(posted, [['b', 'ping'], ['d', 'ping']], 'a hidden asker is answered once');
    posted.length = 0;
    await pctx.answer(null);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(posted.length, 4, 'no source: every window');
    assert.ok(/event\.waitUntil\(answerPing\(event\.source\)\)/.test(src), 'the ping handler answers through answerPing');

    // the gallery's pin sync: the same lists change nothing; new lists go with the next batch
    const rctx = {
        Promise, Array, Set, Number, Math,
        IMAGE_CACHE_POLICY: { maxEntries: 20000, maxSizeBytes: 2e9, maxIdleMs: 604800000, lockedPreviewCount: 3 },
        getCanonicalUrl: (u) => u.replace(/\?.*$/, ''),
        calls: []
    };
    const rmeta = { rules: { favoriteUrls: [], lockedPreviewUrls: [] }, entries: {} };
    rctx.readImageMetadata = async () => rmeta;
    rctx.writeImageMetadata = async () => { rctx.calls.push('write'); };
    rctx.imageMetadataSettled = async () => { rctx.calls.push('settled'); };
    rctx.flushImageMetadataNow = async () => { rctx.calls.push('flushNow'); };
    rctx.scheduleImageCachePolicyEnforcement = () => { rctx.calls.push('policy'); };
    vm.createContext(rctx);
    vm.runInContext(fnSource('sameUrlSet') + fnSource('syncImageCacheRules') + '\nthis.sync = syncImageCacheRules;', rctx);
    await rctx.sync({ favoriteUrls: ['/p/a', '/p/b'], lockedPreviewUrls: ['/p/1', '/p/2', '/p/3', '/p/4'] });
    assert.deepStrictEqual(rctx.calls, ['write', 'policy', 'settled'], 'new lists: marked, policy run, held for the batch, no forced write');
    assert.deepStrictEqual(Array.from(rmeta.rules.lockedPreviewUrls), ['/p/1', '/p/2', '/p/3'], 'the first lockedPreviewCount');
    const favRef = rmeta.rules.favoriteUrls;
    rctx.calls.length = 0;
    await rctx.sync({ favoriteUrls: ['/p/b', '/p/a?x=1', '/p/a'], lockedPreviewUrls: ['/p/1', '/p/2', '/p/3', '/p/9'] });
    assert.deepStrictEqual(rctx.calls, [], 'the same pins again (any order): nothing written, no policy run');
    assert.strictEqual(rmeta.rules.favoriteUrls, favRef, 'the lists are kept (the pinned Set stays built)');
    await rctx.sync({ favoriteUrls: ['/p/a', '/p/b'], lockedPreviewUrls: ['/p/1', '/p/2', '/p/3'], policy: { maxIdleMs: 1000 } });
    assert.deepStrictEqual(rctx.calls, ['policy'], 'a new policy runs the policy without a metadata write');
    rctx.calls.length = 0;
    await rctx.sync({ favoriteUrls: ['/p/a', '/p/c'], lockedPreviewUrls: ['/p/1', '/p/2', '/p/3'] });
    assert.deepStrictEqual(rctx.calls, ['write', 'policy', 'settled'], 'a pin toggled: written with the batch');
    assert.notStrictEqual(rmeta.rules.favoriteUrls, favRef, 'replaced, not edited in place');
    assert.ok(!/flushImageMetadataNow/.test(fnSource('syncImageCacheRules')), 'no forced flush on a pin sync');
    assert.ok(/event\.waitUntil\(syncImageCacheRules\(event\.data\)\)/.test(src), 'the message waits for it');
    assert.ok(/networkActivityClients\(\)\.then\(clients =>/.test(src), 'the flush posts to those windows only');

    console.log('test-sw-cache-upkeep: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
