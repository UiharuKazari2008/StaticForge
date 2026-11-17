#!/usr/bin/env node
// The Vista games' files stay out of the update manifest (web_server.js onDemandGameAsset), so
// sw.js checks a cached one against the server's X-File-Hash after serving it
// (revalidateGameAsset), and leaves Setup's media zips to the network (GAME_MEDIA_PREFIX).
// Runs that part of public/sw.js against fake clients, fetch and caches.
// Run: node scripts/test-sw-game-assets.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const start = src.indexOf('const GAME_ASSET_PREFIX');
const end = src.indexOf('// Custom strategy wrapper to add cache-busting headers');
assert.ok(start > 0 && end > start, 'the game asset block in sw.js');

// the route leaves the media folder alone; a hit under vista-games is checked; activate drops old zips
assert.ok(/if \(url\.pathname\.startsWith\(GAME_MEDIA_PREFIX\)\) \{\s*return false;/.test(src), 'media zips bypass the worker');
assert.ok(/startsWith\(GAME_ASSET_PREFIX\) && event\.event\) \{\s*event\.event\.waitUntil\(revalidateGameAsset\(/.test(src), 'a game asset hit is revalidated');
assert.ok(/perfSpan\('maintenance:tidyStaticRows', \(\) => tidyStaticRows\(force\)\)/.test(src), 'cache maintenance drops cached media zips');
// tidyStaticRows (the cache upkeep block): the media zips go, the game's files stay
const upkeepStart = src.indexOf('// ---------- cache upkeep');
const upkeepEnd = src.indexOf('function runCacheMaintenance');
assert.ok(upkeepStart > 0 && upkeepEnd > upkeepStart, 'the cache upkeep block in sw.js');

function world(opts) {
    const calls = [];
    const rows = new Map(Object.entries(opts.rows || {}));
    const internal = opts.internal || new Map();
    let listings = 0;
    const cache = {
        put: async (key, res) => { calls.push('put ' + key); rows.set(key, res); },
        keys: async () => { listings += 1; return Array.from(rows.keys()).map((k) => ({ url: 'http://x' + k })); },
        delete: async (req) => { const k = new URL(req.url).pathname; calls.push('delete ' + k); return rows.delete(k); }
    };
    // INTERNAL_CACHE: the tidy's mark
    const internalCache = {
        match: async (key) => internal.get(key),
        put: async (key, res) => { internal.set(key, res); }
    };
    const headers = (h) => ({ get: (n) => (h || {})[n.toLowerCase()] || null });
    const sent = [];
    const ctx = {
        Date, Map, Set, Promise, URL, console, decodeURI, JSON, perfLog: () => {},
        Response: class { constructor(body) { this.body = body; } json() { return Promise.resolve(JSON.parse(this.body)); } },
        STATIC_CACHE: 'static-cache-v2', INTERNAL_CACHE: 'internal-cache-v1',
        self: { clients: { matchAll: async () => (opts.clients || []).map((u) => ({ url: 'http://x' + u })) } },
        caches: { open: async (name) => (name === 'internal-cache-v1' ? internalCache : cache) },
        // the page's stored list (IndexedDB melatonCacheVerified), when the test gives one
        indexedDB: opts.snapshot === undefined ? undefined : fakeIndexedDb(opts.snapshot),
        fetch: async (url, init) => {
            const method = (init && init.method) || 'GET';
            calls.push(method + ' ' + url);
            if (method === 'OPTIONS') sent.push((init && init.headers) || {});
            if (method === 'OPTIONS' && opts.manifest) {
                const digest = opts.digest || 'd1';
                if (init && init.headers && init.headers['X-Manifest-Hash'] === digest) {
                    return { ok: false, status: 304, headers: headers({ 'x-manifest-hash': digest }) };
                }
                return { ok: true, status: 200, headers: headers({ 'x-manifest-hash': digest }), json: async () => opts.manifest.map((u) => ({ url: u })) };
            }
            return { ok: true, status: 200, headers: headers({ 'x-file-hash': opts.serverHash }) };
        }
    };
    vm.createContext(ctx);
    vm.runInContext(src.slice(start, end) + src.slice(upkeepStart, upkeepEnd)
        + '\nthis.api = { revalidateGameAsset, tidyStaticRows, gameAssetChecked };', ctx);
    return { api: ctx.api, calls, rows, internal, sent, listings: () => listings, cached: (hash) => ({ headers: headers({ 'x-file-hash': hash }) }) };
}

// indexedDB.open(...) -> request whose onsuccess gives a db with store 'v' holding { manifest: snapshot }
function fakeIndexedDb(snapshot) {
    return {
        open() {
            const request = {};
            setImmediate(() => {
                request.result = {
                    close() {},
                    transaction() {
                        return { objectStore() { return { get() {
                            const g = {};
                            setImmediate(() => { g.result = snapshot; if (g.onsuccess) g.onsuccess(); });
                            return g;
                        } }; } };
                    }
                };
                if (request.onsuccess) request.onsuccess();
            });
            return request;
        }
    };
}

(async () => {
    const URL1 = '/static_images/vista-games/minesweeper/data.json';

    // same hash: a HEAD and nothing else
    let w = world({ serverHash: 'aaa', clients: ['/app'] });
    await w.api.revalidateGameAsset(URL1, w.cached('aaa'));
    assert.deepStrictEqual(w.calls, ['HEAD ' + URL1]);

    // rebuilt on the server: fetched again and stored
    w = world({ serverHash: 'bbb', clients: ['/app'] });
    await w.api.revalidateGameAsset(URL1, w.cached('aaa'));
    assert.deepStrictEqual(w.calls, ['HEAD ' + URL1, 'GET ' + URL1, 'put ' + URL1]);

    // checked once per 10 minutes
    await w.api.revalidateGameAsset(URL1, w.cached('aaa'));
    assert.strictEqual(w.calls.length, 3, 'a second hit within 10 minutes is not checked');

    // a lighter copy (its own hash) is replaced on the desktop ...
    w = world({ serverHash: 'full', clients: ['/app'] });
    await w.api.revalidateGameAsset(URL1, w.cached('lite'));
    assert.deepStrictEqual(w.calls.slice(-1), ['put ' + URL1]);

    // ... but not while Setup runs (its last step swaps them), and it is checked again later
    for (const setup of ['/launch', '/launch-games.html']) {
        w = world({ serverHash: 'full', clients: ['/app', setup] });
        await w.api.revalidateGameAsset(URL1, w.cached('lite'));
        assert.deepStrictEqual(w.calls, [], 'no checks with ' + setup + ' open');
        assert.ok(!w.api.gameAssetChecked.has(URL1), 'left for a later hit');
    }

    // cache maintenance: the media zips go, the game's files stay (no manifest answer: no prune)
    w = world({ rows: { '/static_images/vista-games/media/minesweeper.zip': 1, '/static_images/vista-games/media/minesweeper.json': 1, [URL1]: 1, '/css/app.css': 1 } });
    await w.api.tidyStaticRows();
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(), ['/css/app.css', URL1]);

    // with the manifest: rows it no longer lists go, on-demand game and gadget files stay
    const manifest = ['/css/app.css', '/sounds/vista/Windows Ding.wav'].concat(Array.from({ length: 120 }, (_, i) => '/f' + i + '.js'));
    w = world({ manifest, rows: { '/css/app.css': 1, '/css/old.css': 1, '/sounds/vista/Windows%20Ding.wav': 1, [URL1]: 1,
        '/static_images/vista-gadgets/clock/clock.html': 1, '/static_images/vista-games/media/chess.zip': 1 } });
    await w.api.tidyStaticRows();
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(),
        ['/css/app.css', '/sounds/vista/Windows%20Ding.wav', URL1, '/static_images/vista-gadgets/clock/clock.html'].sort());

    // #890: the page's stored list goes as X-Manifest-Hash; a 304 uses it (no body)
    const snapshot = { hash: 'd1', n: manifest.length, urls: manifest.join('\n'), hashes: manifest.map(() => 'h').join('\n'), auth: [] };
    w = world({ manifest, digest: 'd1', snapshot, rows: { '/css/app.css': 1, '/css/old.css': 1 } });
    await w.api.tidyStaticRows();
    assert.strictEqual(w.sent[0]['X-Manifest-Hash'], 'd1', 'the stored digest is sent');
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(), ['/css/app.css'], 'the 304 prunes against the stored list');
    // the same manifest again within a week: no listing at all
    const mark = w.internal;
    w = world({ manifest, digest: 'd1', snapshot, internal: mark, rows: { '/css/app.css': 1, '/css/old.css': 1 } });
    await w.api.tidyStaticRows();
    assert.strictEqual(w.listings(), 0, 'an unchanged manifest is not listed again');
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(), ['/css/app.css', '/css/old.css']);
    // ... unless forced (a package was removed), or the manifest changed
    await w.api.tidyStaticRows(true);
    assert.strictEqual(w.listings(), 1, 'forced: listed');
    w = world({ manifest, digest: 'd2', snapshot, internal: mark, rows: { '/css/app.css': 1, '/css/old.css': 1 } });
    await w.api.tidyStaticRows();
    assert.strictEqual(w.listings(), 1, 'a new manifest: listed');
    assert.ok(!w.sent[0]['X-Manifest-Hash'] || w.sent[0]['X-Manifest-Hash'] === 'd1');
    // a stored list under another digest than the server's: the body is used
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(), ['/css/app.css']);

    // #890: a phone's manifest has no Desktop Background photos or Sidebar art: what it fetched stays
    const PHOTO = '/static_images/wallpapers/photos/japan/flickr-1.webp';
    const SIDEBAR = '/static_images/vista-sidebar/weather/32.png';
    const FONT = '/dist/fontawesome/webfonts/fa-solid-900.ttf';
    w = world({ manifest, rows: { '/css/app.css': 1, [PHOTO]: 1, [SIDEBAR]: 1, [FONT]: 1 } });
    await w.api.tidyStaticRows();
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(), ['/css/app.css', PHOTO, SIDEBAR].sort(),
        'a phone keeps the pictures it fetched; the font no phone reads goes');
    // a desktop's manifest lists them: a picture the server no longer has goes there
    const desktop = manifest.concat(['/static_images/wallpapers/photos/japan/flickr-2.webp', '/static_images/vista-sidebar/weather/31.png']);
    w = world({ manifest: desktop, rows: { '/css/app.css': 1, [PHOTO]: 1, [SIDEBAR]: 1 } });
    await w.api.tidyStaticRows();
    assert.deepStrictEqual(Array.from(w.rows.keys()).sort(), ['/css/app.css'], 'a desktop prunes the photos its list dropped');

    console.log('test-sw-game-assets: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
