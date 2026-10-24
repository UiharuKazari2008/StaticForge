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
assert.ok(/perfSpan\('maintenance:tidyStaticRows', tidyStaticRows\)/.test(src), 'cache maintenance drops cached media zips');
// tidyStaticRows (the cache upkeep block): the media zips go, the game's files stay
const upkeepStart = src.indexOf('// ---------- cache upkeep');
const upkeepEnd = src.indexOf('function runCacheMaintenance');
assert.ok(upkeepStart > 0 && upkeepEnd > upkeepStart, 'the cache upkeep block in sw.js');

function world(opts) {
    const calls = [];
    const rows = new Map(Object.entries(opts.rows || {}));
    const cache = {
        put: async (key, res) => { calls.push('put ' + key); rows.set(key, res); },
        keys: async () => Array.from(rows.keys()).map((k) => ({ url: 'http://x' + k })),
        delete: async (req) => { const k = new URL(req.url).pathname; calls.push('delete ' + k); return rows.delete(k); }
    };
    const headers = (h) => ({ get: (n) => (h || {})[n.toLowerCase()] || null });
    const ctx = {
        Date, Map, Set, Promise, URL, console, decodeURI, perfLog: () => {},
        STATIC_CACHE: 'static-cache-v2',
        self: { clients: { matchAll: async () => (opts.clients || []).map((u) => ({ url: 'http://x' + u })) } },
        caches: { open: async () => cache },
        fetch: async (url, init) => {
            const method = (init && init.method) || 'GET';
            calls.push(method + ' ' + url);
            if (method === 'OPTIONS' && opts.manifest) return { ok: true, json: async () => opts.manifest.map((u) => ({ url: u })) };
            return { ok: true, headers: headers({ 'x-file-hash': opts.serverHash }) };
        }
    };
    vm.createContext(ctx);
    vm.runInContext(src.slice(start, end) + src.slice(upkeepStart, upkeepEnd)
        + '\nthis.api = { revalidateGameAsset, tidyStaticRows, gameAssetChecked };', ctx);
    return { api: ctx.api, calls, rows, cached: (hash) => ({ headers: headers({ 'x-file-hash': hash }) }) };
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

    console.log('test-sw-game-assets: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
