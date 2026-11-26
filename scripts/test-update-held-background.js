#!/usr/bin/env node
// A large update held for the restart downloads in the background (Yozora #514, items 1-4):
//  1. the worker stores it in a STAGING cache (update-staging-v1), never in the live static cache: the running page keeps
//     reading one consistent old set (client-update-never-in-place). /launch's installer (updateEngine.check -> promoteStaged)
//     promotes the staged rows whose x-file-hash is the manifest's into the static cache before it diffs, downloads only the
//     rest, and drops the staging cache. "Check for updates but let me choose" downloads nothing; a phone only on Wi-Fi.
//  2. installer stragglers (files the install could not keep) are kept in the static cache on first use.
//  3. /cache/ rows named by their content do not expire at 24 h; the mutable ones keep the day.
//  4. a preview miss uses the HTTP cache (default cache mode); processing / full-picture requests keep no-store.
// The worker is the real public/sw.js run in a vm over a fake Cache Storage, a Workbox CacheFirst that follows Workbox's own
// plugin contract, and the real server half of the update pack (modules/updatePack.js over modules/meletonInstallPack.js).
// SW_SRC=<file> runs the worker tests against another sw.js (git show HEAD:public/sw.js > /tmp/old.js shows the old behaviour).
// Run: node scripts/test-update-held-background.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const meletonInstallPack = require('../modules/meletonInstallPack');
const updatePack = require('../modules/updatePack');
const engine = require('../public/scripts/launch/updateEngine.js');

const ROOT = path.join(__dirname, '..');
const swSrc = fs.readFileSync(process.env.SW_SRC || path.join(ROOT, 'public/sw.js'), 'utf8');
const swmSrc = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/serviceWorkerManager.js'), 'utf8');
const fflateSrc = fs.readFileSync(path.join(ROOT, 'public/scripts/vendor/fflate.js'), 'utf8');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const plain = (v) => JSON.parse(JSON.stringify(v));
const ORIGIN = 'http://x';
const STATIC = 'static-cache-v2';
const STAGING = 'update-staging-v1';

// A Request that takes the worker's relative urls
class Req extends Request {
    constructor(u, init) { super(typeof u === 'string' ? new URL(u, ORIGIN).href : u, init); }
}

/** Cache Storage in memory: named caches, rows keyed by absolute url. */
function fakeStorage() {
    const stores = new Map();
    const keyOf = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
    const make = (rows) => ({
        match: async (r) => { const hit = rows.get(keyOf(r)); return hit ? hit.clone() : undefined; },
        put: async (r, res) => {
            const body = Buffer.from(await res.arrayBuffer());
            rows.set(keyOf(r), new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
        },
        delete: async (r) => rows.delete(keyOf(r)),
        keys: async () => Array.from(rows.keys(), (u) => new Req(u))
    });
    return {
        rows: (name) => stores.get(name) || new Map(),
        open: async (name) => { if (!stores.has(name)) stores.set(name, new Map()); return make(stores.get(name)); },
        has: async (name) => stores.has(name),
        delete: async (name) => stores.delete(name),
        keys: async () => Array.from(stores.keys())
    };
}

class FakeRes extends EventEmitter {
    constructor() { super(); this.chunks = []; }
    write(b) { this.chunks.push(Buffer.from(b)); return true; }
    end() {}
}

/** The server: a manifest over files on disk, packs built by the real pack code, plain GETs from opts.serve. */
async function server(files, hashes = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'held-bg-'));
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    const disk = {};
    const manifest = [];
    for (const [url, bytes] of Object.entries(files)) {
        const p = path.join(dir, 'public', url);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, bytes);
        disk[url] = p;
        manifest.push({ url, hash: hashes[url] || sha(bytes), size: bytes.length });
    }
    const resolveFile = (row) => disk[row.url] || null;
    meletonInstallPack.init({ outputDir: path.join(dir, 'packs') });
    await meletonInstallPack.rebuild({ outputDir: path.join(dir, 'packs'), manifest, resolveFile });
    const byUrl = new Map(manifest.map((r) => [r.url, r]));
    const packs = [];
    return {
        manifest, packs,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
        async pack(body) {
            packs.push(body.files.map((f) => f.url));
            const planned = await updatePack.plan({ manifestByUrl: byUrl, requested: body.files, resolveFile, contentType: (u) => (u.endsWith('.js') ? 'application/javascript; charset=UTF-8' : '') });
            const res = new FakeRes();
            await updatePack.send(res, planned);
            const zip = Buffer.concat(res.chunks);
            return new Response(zip, { status: 200, headers: { 'content-length': String(zip.length), 'content-type': 'application/zip' } });
        }
    };
}

// Workbox's CacheFirst by its plugin contract (workbox-strategies 7: cachedResponseWillBeUsed in a row, cacheWillUpdate
// before a put, cacheKeyWillBeUsed for reads and writes) and ExpirationPlugin's freshness test (workbox-expiration: a row
// whose Date header is older than maxAgeSeconds is no hit - only when maxAgeSeconds is set).
function workboxStubs(getContext) {
    class CacheFirst {
        constructor(options) { this.options = options; this.plugins = options.plugins || []; }
        async key(request, mode, event) {
            let key = request;
            for (const plugin of this.plugins) {
                if (!plugin.cacheKeyWillBeUsed) continue;
                const input = typeof key === 'string' ? new Req(key) : key;
                key = (await plugin.cacheKeyWillBeUsed({ request: input, mode, event })) || key;
            }
            return typeof key === 'string' ? new Req(key) : key;
        }
        async handle({ request, event }) {
            const { caches, fetch } = getContext();
            const cache = await caches.open(this.options.cacheName);
            const readKey = await this.key(request, 'read', event);
            let hit = await cache.match(readKey);
            for (const plugin of this.plugins) {
                if (plugin.cachedResponseWillBeUsed) hit = (await plugin.cachedResponseWillBeUsed({ cacheName: this.options.cacheName, matchOptions: this.options.matchOptions, cachedResponse: hit, request: readKey, event })) || undefined;
            }
            if (hit) return hit;
            const response = await fetch(request);
            let storable = response;
            for (const plugin of this.plugins) {
                if (!plugin.cacheWillUpdate) continue;
                storable = await plugin.cacheWillUpdate({ request, response: storable, event });
                if (!storable) break;
            }
            if (storable) await cache.put(await this.key(request, 'write', event), storable.clone());
            return response;
        }
    }
    class ExpirationPlugin {
        constructor(options) { this.options = options; }
        async cachedResponseWillBeUsed({ cachedResponse }) {
            if (!cachedResponse) return null;
            if (!this.options.maxAgeSeconds) return cachedResponse;
            const stamped = cachedResponse.headers.has('date') ? new Date(cachedResponse.headers.get('date')).getTime() : null;
            if (stamped === null || Number.isNaN(stamped)) return cachedResponse;
            return stamped >= Date.now() - this.options.maxAgeSeconds * 1000 ? cachedResponse : null;
        }
    }
    class CacheableResponsePlugin {
        constructor(options) { this.options = options; }
        async cacheWillUpdate({ response }) { return response && this.options.statuses.includes(response.status) ? response : null; }
    }
    return { CacheFirst, ExpirationPlugin, CacheableResponsePlugin };
}

/** The worker, loaded as the browser would: its listeners and routes collected, its fetches answered here. */
async function worker(opts = {}) {
    const store = opts.storage || fakeStorage();
    const srv = opts.server || null;
    const posts = [];
    const fetches = [];
    const listeners = {};
    const routes = [];
    const RealDate = Date;
    const clock = { skew: 0 };
    class FakeDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(RealDate.now() + clock.skew); else super(...args); }
        static now() { return RealDate.now() + clock.skew; }
    }
    const navigator = { userAgent: 'Mozilla/5.0 (X11; Linux) Chrome', connection: opts.connection };
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Promise, JSON, Map, Set, Math, Number, String, Array, Object, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder, Error, URL, URLSearchParams,
        Headers, Response, Request: Req, AbortController, Date: FakeDate, RegExp, setTimeout, clearTimeout, setInterval, clearInterval,
        parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent, Symbol, Boolean, WeakMap, Int32Array, Uint32Array,
        crypto: globalThis.crypto, performance: { now: () => RealDate.now() },
        importScripts() {},
        caches: store,
        fetch: async (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
            fetches.push({ url: url.pathname + url.search, init, request: typeof input === 'string' ? null : input });
            if (url.pathname === '/install/meletonfx.zip') {
                assert.ok(srv, 'a pack asked for with no server');
                return srv.pack(JSON.parse(init.body));
            }
            return opts.serve(url, init, typeof input === 'string' ? null : input);
        }
    };
    ctx.workbox = {
        setConfig() {},
        routing: { registerRoute: (match, handler) => routes.push({ match, handler }) },
        strategies: null, expiration: null, cacheableResponse: null
    };
    const stubs = workboxStubs(() => ctx);
    ctx.workbox.strategies = { CacheFirst: stubs.CacheFirst };
    ctx.workbox.expiration = { ExpirationPlugin: stubs.ExpirationPlugin };
    ctx.workbox.cacheableResponse = { CacheableResponsePlugin: stubs.CacheableResponsePlugin };
    const client = { id: 'c1', visibilityState: 'visible', postMessage: (m) => posts.push(m), url: ORIGIN + '/app' };
    ctx.self = {
        location: { origin: ORIGIN },
        addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
        clients: { matchAll: async () => [client], claim: async () => {}, get: async () => client },
        navigator, skipWaiting() {}, registration: {}, fetch: ctx.fetch
    };
    ctx.self.self = ctx.self;
    ctx.self.fflate = (() => {
        const m = { exports: {} };
        new Function('module', 'exports', 'define', fflateSrc)(m, m.exports, undefined);
        return m.exports;
    })();
    vm.createContext(ctx);
    vm.runInContext(swSrc, ctx, { filename: 'sw.js' });

    const w = {
        ctx, store, posts, fetches, clock, navigator, server: srv,
        /** A top-level const of the worker (a script's const is not a property of its global). */
        read: (name) => vm.runInContext(name, ctx),
        of: (type) => posts.filter((m) => m.type === type),
        types: () => Array.from(new Set(posts.map((m) => m.type))),
        /** A message to the worker, as a page posts it; resolves when the work the message event holds is done. */
        async message(data) {
            const waits = [];
            const event = { data, source: client, waitUntil: (p) => waits.push(p), ports: [] };
            listeners.message.forEach((fn) => fn(event));
            await Promise.all(waits);
        },
        /** A GET the page makes: the browser's fetch listeners first (the hashed-script fast path), then the router. */
        async get(pathAndQuery, { destination = '', headers = {}, cache = 'default' } = {}) {
            const url = new URL(pathAndQuery, ORIGIN);
            const request = { url: url.href, method: 'GET', headers: new Headers(headers), destination, mode: 'no-cors', cache, clone() { return this; } };
            const waits = [];
            let answered = null;
            let stopped = false;
            const event = {
                request, clientId: 'c1', waitUntil: (p) => waits.push(p),
                respondWith: (p) => { answered = Promise.resolve(p); },
                stopImmediatePropagation: () => { stopped = true; }
            };
            for (const fn of listeners.fetch || []) { fn(event); if (stopped || answered) break; }
            let response;
            if (answered) {
                response = await answered;
            } else {
                const route = routes.find((r) => r.match({ url, request, event }));
                assert.ok(route, `a route answers ${pathAndQuery}`);
                response = await route.handler({ url, request, event, waitUntil: event.waitUntil });
            }
            await Promise.all(waits);
            return response;
        },
        async activate() {
            const waits = [];
            listeners.activate.forEach((fn) => fn({ waitUntil: (p) => waits.push(p) }));
            await Promise.all(waits);
        },
        listeners
    };
    return w;
}

/** A server answer for a plain file: its bytes, its manifest hash in X-File-Hash, a Date a day-and-a-bit later tests can age. */
function served(bytes, extra = {}) {
    return new Response(bytes, { status: 200, headers: Object.assign({ 'content-type': 'application/octet-stream', 'content-length': String(bytes.length), date: new Date().toUTCString() }, extra) });
}

// ---- the page half: the real methods of serviceWorkerManager.js over a stub page ----
function methodSource(name) {
    const at = swmSrc.search(new RegExp(`^    (?:async )?${name}\\(`, 'm'));
    assert.ok(at >= 0, `serviceWorkerManager.js has ${name}`);
    const open = swmSrc.indexOf('{', swmSrc.indexOf(')', at));
    let depth = 0;
    let str = null;
    for (let i = open; i < swmSrc.length; i++) {
        const ch = swmSrc[i];
        if (str) { if (ch === '\\') i++; else if (ch === str) str = null; continue; }
        if (ch === '/' && swmSrc[i + 1] === '/') { i = swmSrc.indexOf('\n', i); continue; }
        if (ch === '/' && swmSrc[i + 1] === '*') { i = swmSrc.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { str = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) return swmSrc.slice(at, i + 1);
    }
    throw new Error(`unbalanced ${name}`);
}
function topLevel(name) {
    const at = swmSrc.search(new RegExp(`^function ${name}\\(`, 'm'));
    assert.ok(at >= 0, `serviceWorkerManager.js has ${name}`);
    return swmSrc.slice(at, swmSrc.indexOf('\n}\n', at) + 3);
}
const PAGE_METHODS = ['_offerServicePackUpgrade', '_stageHeldUpdate', '_noteStagingMessage', '_stagedNote', '_showStagingProgress', '_holdsUpdates', '_updateMode', '_installerFileCount'];
const PageClass = new Function('window', 'console', 'Date', `
    ${topLevel('servicePackPatchId')}
    ${topLevel('servicePackFromFiles')}
    ${topLevel('filesCountingTowardInstaller')}
    return class { ${PAGE_METHODS.map(methodSource).join('\n')} };
`);

function page(mode, extra = {}) {
    const win = { uiShell: 'desktop', melatonUpdateSettings: { get: () => ({ mode }) } };
    const Klass = PageClass(win, { log() {}, warn() {}, error() {} }, Date);
    const p = new Klass();
    const sent = [];
    Object.assign(p, {
        swRegistration: { active: { postMessage: (m) => sent.push(m) } }, _pageTag: 'ptest', agentSession: false, _staging: null,
        servicePack: null, isUpdating: false, updateAvailable: false, checkingToastId: null, updateToastId: null,
        _packageInstall: false, _shutdownInstalling: false, _installingAvailable: false, trayPopup: { state: 'hidden', el: null }, sent, win
    }, extra);
    p._filesCountingTowardInstaller = (f) => f;
    p._clearScheduledUpdateCompleteToast = () => {};
    p._showServiceWorkerTrayPopup = () => true;
    p._isDesktopTrayMode = () => true;
    p._renderServiceWorkerTrayPopup = () => { p.rendered = (p.rendered || 0) + 1; };
    Object.assign(p, extra);
    return p;
}

(async () => {
    // 25 changed files: more than INSTALLER_FILE_THRESHOLD (20), so the restart installs them on /launch
    const files = {};
    for (let i = 0; i < 25; i++) files[`/scripts/mod${i}.js`] = Buffer.from(`console.log(${i}); // new\n`.repeat(40));
    const OLD = (url) => Buffer.from(`old ${url}`);

    // ============================ 1. the worker stages a held update, apart from the live cache ============================
    let srv = await server(files);
    let w = await worker({ server: srv, serve: () => { throw new Error('only packs are fetched'); } });
    // the live cache holds the old set the running page reads
    const live = await w.store.open(STATIC);
    for (const f of srv.manifest) await live.put(new Req(f.url), new Response(OLD(f.url), { headers: { 'x-file-hash': 'old-' + f.url, 'content-type': 'application/javascript' } }));
    const liveBefore = JSON.stringify(await Promise.all(Array.from(w.store.rows(STATIC).entries(), async ([u, r]) => [u, r.headers.get('x-file-hash'), (await r.clone().text())])));

    await w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true, requester: 'p1' });
    assert.ok(w.of('STAGING_CACHE_STARTED').length === 1 && w.of('STAGING_CACHE_COMPLETE').length === 1, 'a staging download reports its own start and end');
    assert.deepStrictEqual(w.types().filter((t) => t.startsWith('STATIC_CACHE')), [], 'no live-download message reaches a page: its update UI never sees the staging');
    assert.ok(!w.posts.some((m) => m.type === 'CANCEL_DOWNLOAD'), 'no CANCEL_DOWNLOAD');
    assert.strictEqual(w.of('STAGING_CACHE_COMPLETE')[0].updatedFiles.length, 25, 'every file staged');
    assert.strictEqual(srv.packs.length, 1, 'one pack for the round (not a request per file)');
    const staged = w.store.rows(STAGING);
    assert.strictEqual(staged.size, 25, '25 rows in the staging cache');
    for (const f of srv.manifest) {
        const row = staged.get(ORIGIN + f.url);
        assert.ok(row, `${f.url} staged`);
        assert.strictEqual(row.headers.get('x-file-hash'), f.hash, 'at the manifest hash');
        assert.ok(Buffer.from(await row.clone().arrayBuffer()).equals(files[f.url]), 'the bytes');
    }
    const liveAfter = JSON.stringify(await Promise.all(Array.from(w.store.rows(STATIC).entries(), async ([u, r]) => [u, r.headers.get('x-file-hash'), (await r.clone().text())])));
    assert.strictEqual(liveAfter, liveBefore, 'the live static cache is byte-for-byte unchanged: the running page keeps one consistent old set');
    const progress = w.of('STAGING_CACHE_PROGRESS').map((m) => m.completed);
    assert.deepStrictEqual(progress, progress.slice().sort((a, b) => a - b), 'staged progress never goes back');
    // the page asks again for the same set (the next update check): nothing is fetched again
    const packsBefore = srv.packs.length;
    await w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true, requester: 'p1' });
    assert.strictEqual(srv.packs.length, packsBefore, 'staged rows at the manifest hash are not downloaded again');
    assert.strictEqual(w.of('STAGING_CACHE_COMPLETE')[1].updatedFiles.length, 25, 'and still counted as staged');

    // one file changed again on the server (a newer deploy): only it comes down, and replaces the staged row
    const newer = Buffer.from('console.log("deploy 2");\n'.repeat(30));
    srv.cleanup();
    srv = await server(Object.assign({}, files, { '/scripts/mod3.js': newer }));
    w.server = srv;
    w.ctx.fetch = ((orig) => async (input, init) => (new URL(typeof input === 'string' ? input : input.url, ORIGIN).pathname === '/install/meletonfx.zip' ? srv.pack(JSON.parse(init.body)) : orig(input, init)))(w.ctx.fetch);
    await w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true, requester: 'p1' });
    assert.deepStrictEqual(srv.packs, [['/scripts/mod3.js']], 'only the superseded file is fetched');
    assert.strictEqual(w.store.rows(STAGING).get(ORIGIN + '/scripts/mod3.js').headers.get('x-file-hash'), sha(newer), 'its staged row is the new one');

    // ---- a live request ends a staging download (the lanes never mix); what is staged stays ----
    srv.cleanup();
    srv = await server(files);
    let release;
    const gate = new Promise((r) => { release = r; });
    w = await worker({ server: srv, serve: () => { throw new Error('packs only'); } });
    const realPack = srv.pack;
    srv.pack = async (body) => { if (!srv.slowDone) { srv.slowDone = true; await gate; } return realPack(body); };
    const staging = w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true });
    await new Promise((r) => setTimeout(r, 20));
    // a staging download is background work, not "downloading": the boot gate, the page's state check and its "already
    // downloading" branch (all of which read isDownloading) ignore it
    await w.message({ type: 'GET_DOWNLOAD_STATE', requestId: 'r1' });
    const state = w.of('DOWNLOAD_STATE')[0];
    assert.strictEqual(state.isDownloading, false);
    assert.strictEqual(state.staging, true);
    const liveFiles = srv.manifest.slice(0, 2);
    await w.message({ type: 'CACHE_STATIC_FILES', files: liveFiles, silent: true, requester: 'p2' });
    release();
    await staging;
    assert.ok(w.of('STAGING_CACHE_CANCELLED').length === 1, 'the staging download was cancelled by the live one');
    assert.strictEqual(w.of('STATIC_CACHE_COMPLETE').length, 1, 'the live download completed');
    assert.deepStrictEqual(Array.from(w.store.rows(STATIC).keys()).sort(), liveFiles.map((f) => ORIGIN + f.url).sort(), 'and wrote the live cache');
    // and the other way: the live download of a page is the old behaviour, untouched
    assert.strictEqual(w.of('STATIC_CACHE_COMPLETE')[0].updatedFiles.length, 2);
    srv.cleanup();

    // ---- a phone stages only on Wi-Fi (the prefetch's rule), and goes on when the hint says unmetered ----
    srv = await server(files);
    w = await worker({ server: srv, connection: undefined, serve: () => { throw new Error('packs only'); } });
    await w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true, phone: true });
    assert.strictEqual(srv.packs.length, 0, 'phone, network unknown: nothing downloads');
    assert.strictEqual(w.of('STAGING_CACHE_DEFERRED').length, 1, 'the page is told it waits for Wi-Fi');
    await w.message({ type: 'PHONE_PREFETCH', network: 'metered' });
    assert.strictEqual(srv.packs.length, 0, 'cellular: still nothing');
    await w.message({ type: 'PHONE_PREFETCH', network: 'unmetered' });
    assert.strictEqual(w.store.rows(STAGING).size, 25, 'Wi-Fi: the held set goes on and is staged');
    assert.strictEqual(w.of('STAGING_CACHE_COMPLETE').length, 1);
    assert.strictEqual(w.store.rows(STATIC).size, 0, 'the live cache is still untouched');
    // a desktop page (no phone flag) stages whatever the network says
    const desk = await worker({ server: srv, connection: { type: 'cellular' }, serve: () => { throw new Error('packs only'); } });
    srv.packs.length = 0;
    await desk.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true });
    assert.strictEqual(desk.store.rows(STAGING).size, 25, 'a desktop stages on any network');
    // Wi-Fi dropping mid-download stops it at the next pack and keeps it for Wi-Fi
    const wifi = { type: 'wifi' };
    w = await worker({ server: srv, connection: wifi, serve: () => { throw new Error('packs only'); } });
    const bigSizes = srv.manifest.map((f, i) => Object.assign({}, f, { size: 20 * 1024 * 1024, i }));
    srv.packs.length = 0;
    const realPack2 = srv.pack;
    srv.pack = async (body) => { const res = await realPack2(body); wifi.type = 'cellular'; return res; };
    await w.message({ type: 'CACHE_STATIC_FILES', files: bigSizes, silent: true, staging: true, phone: true });
    assert.strictEqual(w.of('STAGING_CACHE_DEFERRED').length, 1, 'Wi-Fi gone between two packs: deferred');
    assert.ok(w.store.rows(STAGING).size >= 1 && w.store.rows(STAGING).size < 25, 'what came down stays staged');
    srv.pack = realPack2;
    wifi.type = 'wifi';
    await w.message({ type: 'PHONE_PREFETCH', network: 'unmetered' });
    assert.strictEqual(w.store.rows(STAGING).size, 25, 'and the rest comes when it is back');
    srv.cleanup();

    // ---- the worker's own housekeeping keeps the staging cache (activate drops unknown caches) ----
    w = await worker({ serve: () => { throw new Error('none'); } });
    await w.store.open(STAGING);
    await w.store.open('some-old-cache-v0');
    await w.store.open(STATIC);
    await w.activate();
    const kept = await w.store.keys();
    assert.ok(kept.includes(STAGING) && kept.includes(STATIC), 'activation keeps the staging cache');
    assert.ok(!kept.includes('some-old-cache-v0'), 'and drops what it does not know');

    // ============================ the page: what it asks of the worker ============================
    const held = [];
    for (let i = 0; i < 25; i++) held.push({ url: `/scripts/mod${i}.js`, hash: `h${i}`, size: 100 });
    // "download updates" and "install automatically": the held set is posted for staging, no CANCEL_DOWNLOAD
    for (const mode of ['download', 'auto']) {
        const p = page(mode);
        p._offerServicePackUpgrade(held, null);
        assert.deepStrictEqual(p.sent.map((m) => m.type), ['CACHE_STATIC_FILES'], `${mode}: one staging request`);
        assert.strictEqual(p.sent[0].staging, true);
        assert.strictEqual(p.sent[0].files.length, 25);
        assert.strictEqual(p.sent[0].phone, false);
        assert.ok(p.servicePack && p.servicePack.label.startsWith('Upgrade to Service Pack '), 'the tray offer (Restart to install) is still made');
        assert.strictEqual(p.isUpdating, false, 'the offer is not a live download: the restart stays available');
        // the same set again (the next check): not asked twice
        p._offerServicePackUpgrade(held, null);
        assert.strictEqual(p.sent.length, 1, 'not asked twice');
    }
    // "Check for updates but let me choose" (the default): nothing downloads, a running download ends as it always did
    let p = page('notify');
    p._offerServicePackUpgrade(held, null);
    assert.deepStrictEqual(p.sent.map((m) => m.type), ['CANCEL_DOWNLOAD'], 'let me choose: no CACHE_STATIC_FILES at all');
    // ... until the person asks for it (Install updates)
    p = page('notify');
    p._offerServicePackUpgrade(held, { install: true });
    assert.deepStrictEqual(p.sent.map((m) => m.type), ['CACHE_STATIC_FILES'], 'Install updates stages');
    // a phone page tells the worker it is one (the worker checks Wi-Fi)
    p = page('download');
    p.win.uiShell = 'mobile';
    p._offerServicePackUpgrade(held, null);
    assert.strictEqual(p.sent[0].phone, true);
    // a staging download ended by a live one is asked again at the next check, not after the 5 minutes
    p = page('download');
    p._offerServicePackUpgrade(held, null);
    p._noteStagingMessage({ type: 'STAGING_CACHE_CANCELLED', completed: 3, total: 25 });
    p._offerServicePackUpgrade(held, null);
    assert.strictEqual(p.sent.length, 2, 'asked again after a cancel');
    // stragglers never count toward the held set
    p = page('download', { _filesCountingTowardInstaller: (f) => f.filter((x) => x.url !== '/scripts/mod0.js') });
    p._offerServicePackUpgrade(held, null);
    assert.strictEqual(p.sent[0].files.length, 24);
    // the offer is honest about progress: nothing claimed before a file is staged, then the count, then done
    p = page('download');
    p._offerServicePackUpgrade(held, null);
    p.servicePack = { label: 'Upgrade to Service Pack 26Q4 abcd' };
    p._noteStagingMessage({ type: 'STAGING_CACHE_PROGRESS', completed: 10, total: 25 });
    assert.strictEqual(p._stagedNote(), ' 10 of 25 files are downloaded in the background.');
    assert.deepStrictEqual(plain(p.servicePack.staged), { completed: 10, total: 25, state: 'running' });
    p.trayPopup = { state: 'upgrade', el: { classList: { contains: () => true } }, vistaBalloon: null };
    p._noteStagingMessage({ type: 'STAGING_CACHE_PROGRESS', completed: 15, total: 25 });
    assert.strictEqual(p.rendered, 1, 'the showing balloon is redrawn when the percent moves');
    p._noteStagingMessage({ type: 'STAGING_CACHE_PROGRESS', completed: 15, total: 25 });
    assert.strictEqual(p.rendered, 1, 'and not when it did not');
    p._noteStagingMessage({ type: 'STAGING_CACHE_COMPLETE', completed: 24, total: 25, failed: [{ url: '/scripts/mod1.js' }] });
    assert.strictEqual(p._staging.state, 'partial', 'a file that did not come down: partial, asked again later');
    assert.strictEqual(p._staging.completed, 23);
    p._noteStagingMessage({ type: 'STAGING_CACHE_COMPLETE', completed: 25, total: 25, failed: [] });
    assert.ok(/All of its files are downloaded/.test(p._stagedNote()));
    p._noteStagingMessage({ type: 'STAGING_CACHE_DEFERRED', total: 25 });
    assert.ok(/Wi-Fi/.test(p._stagedNote()), 'a phone waiting for Wi-Fi says so');
    // the page never takes the worker's staging as a live download
    const handler = methodSource('handleServiceWorkerMessage');
    const stagingCases = handler.slice(handler.indexOf("case 'STAGING_CACHE_STARTED':"));
    const stagingBlock = stagingCases.slice(0, stagingCases.indexOf('break;'));
    assert.ok(stagingBlock.includes('_noteStagingMessage') && !/isUpdating|updateAvailable|_processStaticCacheComplete/.test(stagingBlock), 'staging messages touch no live-download state');

    // ============================ 1b. /launch promotes the staged rows, downloads only the rest ============================
    srv = await server(files);
    const shared = fakeStorage();
    w = await worker({ server: srv, storage: shared, serve: () => { throw new Error('packs only'); } });
    const liveCache = await shared.open(STATIC);
    for (const f of srv.manifest) await liveCache.put(new Req(f.url), new Response(OLD(f.url), { headers: { 'x-file-hash': 'old-' + f.url } }));
    await w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true });
    assert.strictEqual(shared.rows(STAGING).size, 25);
    // the restart: /launch's manifest. Two files moved on (a newer deploy), one staged row carries another hash than it should
    const launchManifest = srv.manifest.map((f) => Object.assign({}, f));
    launchManifest[1].hash = 'newer-deploy-1';
    launchManifest[2].hash = 'newer-deploy-2';
    const tampered = await shared.open(STAGING);
    await tampered.put(new Req('/scripts/mod5.js'), new Response('not the staged bytes', { headers: { 'x-file-hash': 'wrong-hash' } }));
    const toLaunch = [];
    const store = new Map();
    const env = {
        location: { origin: ORIGIN },
        caches: shared,
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
        navigator: { serviceWorker: { controller: { postMessage: (m) => toLaunch.push(m) } } },
        fetch: async () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'X-Manifest-Hash' ? 'digest-new' : null) }, json: async () => launchManifest }),
        random: () => 0.5, now: () => Date.now(), sleep: async () => {}
    };
    // nothing in the live cache changed between the staging and the restart
    for (const f of srv.manifest) assert.strictEqual(shared.rows(STATIC).get(ORIGIN + f.url).headers.get('x-file-hash'), 'old-' + f.url);
    const found = await engine.check(env);
    assert.deepStrictEqual(toLaunch, [{ type: 'CANCEL_STAGING' }], 'the worker is told to stop filling the staging cache first');
    const left = found.files.map((f) => f.url).sort();
    assert.deepStrictEqual(left, ['/scripts/mod1.js', '/scripts/mod2.js', '/scripts/mod5.js'], 'the installer lists only the superseded (2) and the mismatched (1) row; the 22 staged files are not in its download list');
    for (const f of launchManifest) {
        const row = shared.rows(STATIC).get(ORIGIN + f.url);
        if (left.includes(f.url)) {
            assert.strictEqual(row.headers.get('x-file-hash'), 'old-' + f.url, `${f.url} (stale staged row) was not promoted`);
        } else {
            assert.strictEqual(row.headers.get('x-file-hash'), f.hash, `${f.url} promoted at the manifest hash`);
            assert.ok(Buffer.from(await row.clone().arrayBuffer()).equals(files[f.url]), `${f.url} promoted with its bytes`);
            assert.strictEqual(row.headers.get('vary'), null);
        }
    }
    assert.ok(!(await shared.has(STAGING)), 'the staging cache is dropped');
    // the installer's own request names only the rest
    let asked = null;
    const copyEnv = Object.assign({}, env, { fetch: async (url, init) => { asked = JSON.parse(init.body).files.map((f) => f.url).sort(); return { ok: false, status: 500, headers: { get: () => null } }; } });
    await engine.copyPack(copyEnv, launchManifest, { subset: found.files });
    assert.deepStrictEqual(asked, left, 'POST /install/meletonfx.zip carries just those');
    srv.cleanup();

    // everything staged and current: /launch finds nothing to install (no Setup), and the digest is stored (the cache is in sync)
    srv = await server(files);
    const shared2 = fakeStorage();
    w = await worker({ server: srv, storage: shared2, serve: () => { throw new Error('packs only'); } });
    const live2 = await shared2.open(STATIC);
    for (const f of srv.manifest) await live2.put(new Req(f.url), new Response(OLD(f.url), { headers: { 'x-file-hash': 'old-' + f.url } }));
    await w.message({ type: 'CACHE_STATIC_FILES', files: srv.manifest, silent: true, staging: true });
    const store2 = new Map();
    const env2 = Object.assign({}, env, { caches: shared2, localStorage: { getItem: (k) => (store2.has(k) ? store2.get(k) : null), setItem: (k, v) => store2.set(k, String(v)), removeItem: (k) => store2.delete(k) }, navigator: { serviceWorker: { controller: { postMessage() {} } } }, fetch: async () => ({ ok: true, status: 200, headers: { get: (h) => (h === 'X-Manifest-Hash' ? 'digest-2' : null) }, json: async () => srv.manifest }) });
    const all = await engine.check(env2);
    assert.strictEqual(all.files.length, 0, 'a fully staged update leaves nothing to download');
    assert.strictEqual(store2.get('melatonManifestHash'), 'digest-2', 'the cache is proven in sync');
    assert.ok(!(await shared2.has(STAGING)));
    // no staging cache: a start costs one lookup and changes nothing
    const calls = [];
    const plainEnv = Object.assign({}, env2, { caches: Object.assign(Object.create(shared2), { has: async (n) => { calls.push(n); return false; }, open: shared2.open }) });
    assert.deepStrictEqual(plain(await engine.promoteStaged(plainEnv, srv.manifest)), { promoted: 0, stale: 0 });
    assert.deepStrictEqual(calls, [STAGING]);
    // a stale staging cache (nothing in it matches the manifest) is dropped, never promoted
    const stale = await shared2.open(STAGING);
    await stale.put(new Req('/scripts/mod7.js'), new Response('old deploy', { headers: { 'x-file-hash': 'an-older-hash' } }));
    const before7 = await (await shared2.rows(STATIC).get(ORIGIN + '/scripts/mod7.js').clone().text());
    assert.deepStrictEqual(plain(await engine.promoteStaged(env2, srv.manifest)), { promoted: 0, stale: 1 });
    assert.strictEqual(await (await shared2.rows(STATIC).get(ORIGIN + '/scripts/mod7.js').clone().text()), before7, 'the live row is the one it was');
    assert.ok(!(await shared2.has(STAGING)));
    srv.cleanup();

    // ============================ 2. stragglers: kept on first use ============================
    const bytes = Buffer.from('/* a file the installer could not keep */\n'.repeat(20));
    const sha1 = sha(bytes);
    const serve = (hashHeader) => (url) => served(bytes, hashHeader === null ? {} : { 'x-file-hash': hashHeader || sha1, 'content-type': url.pathname.endsWith('.js') ? 'application/javascript' : 'image/webp', vary: 'Accept-Encoding' });
    // a page script asked for by its hash (the worker's fast path, answerHashedAsset): no row anywhere, the server answers
    w = await worker({ serve: serve() });
    let r = await w.get(`/scripts/comp/straggler.js?sha=${sha1}`, { destination: 'script' });
    assert.strictEqual(r.status, 200);
    let row = w.store.rows(STATIC).get(ORIGIN + '/scripts/comp/straggler.js');
    assert.ok(row, 'a hashed script straggler is stored in the static cache on first use');
    assert.strictEqual(row.headers.get('x-file-hash'), sha1);
    assert.strictEqual(row.headers.get('vary'), null, 'as the worker\'s own rows (no Vary)');
    assert.ok(Buffer.from(await row.clone().arrayBuffer()).equals(bytes));
    const fetchesBefore = w.fetches.length;
    r = await w.get(`/scripts/comp/straggler.js?sha=${sha1}`, { destination: 'script' });
    assert.strictEqual(w.fetches.length, fetchesBefore, 'the second load comes from the cache');
    assert.strictEqual(r.status, 200);
    // a body that is not the one the server named is not kept; neither is an answer with no hash, an error, or an auth-gated path
    w = await worker({ serve: serve('0'.repeat(64)) });
    await w.get(`/scripts/comp/straggler.js?sha=${sha1}`, { destination: 'script' });
    assert.strictEqual(w.store.rows(STATIC).size, 0, 'a body that does not hash to the X-File-Hash is not kept');
    w = await worker({ serve: serve(null) });
    await w.get(`/scripts/comp/straggler.js?sha=${sha1}`, { destination: 'script' });
    assert.strictEqual(w.store.rows(STATIC).size, 0, 'no X-File-Hash, no row');
    w = await worker({ serve: () => new Response('no', { status: 404, headers: { 'x-file-hash': sha1 } }) });
    await w.get(`/scripts/comp/straggler.js?sha=${sha1}`, { destination: 'script' });
    assert.strictEqual(w.store.rows(STATIC).size, 0, 'a 404 is not kept');
    // any other static file (an image, a font, a script asked for by its plain name): the strategies' miss path keeps it
    w = await worker({ serve: serve() });
    await w.get('/static_images/straggler.webp', { destination: 'image' });
    row = w.store.rows(STATIC).get(ORIGIN + '/static_images/straggler.webp');
    assert.ok(row && row.headers.get('x-file-hash') === sha1, 'an image straggler is stored on first use by the static strategy');
    const n = w.fetches.length;
    await w.get('/static_images/straggler.webp?v=3', { destination: 'image' });
    assert.strictEqual(w.fetches.length, n, 'and then served from the cache, query ignored');
    await w.get('/scripts/comp/other.js', { destination: 'script' });
    assert.ok(w.store.rows(STATIC).get(ORIGIN + '/scripts/comp/other.js'), 'a script asked for by its plain name too');

    // ============================ 3. /cache/* rows: content-addressed ones do not expire at 24 h ============================
    const cacheServe = (url) => served(Buffer.from('picture ' + url.pathname), { 'content-type': 'image/png', 'cache-control': 'public, max-age=259200' });
    w = await worker({ serve: cacheServe });
    const dyn = w.read('dynamicStrategy').options;
    const exp = dyn.plugins.find((pl) => pl.constructor.name === 'ExpirationPlugin');
    assert.ok(exp && exp.options.maxEntries > 0, 'the cache stays bounded by a row count');
    assert.strictEqual(exp.options.maxAgeSeconds, undefined, 'no blanket 24 h age on the whole cache');
    const folders = {
        '/cache/upload/9e107d9d372bb6826bd81d3542a419d6': 'content-addressed (md5 of the bytes)',
        '/cache/dynGenPreview/9e107d9d372bb6826bd81d3542a419d6.webp': 'content-addressed (preview hash)',
        '/cache/account-pictures/kanmi-1763900000000-4096.png': 'content-addressed (mtime and size in the name)',
        '/cache/provider-logos/openai-1763900000000-2048.png': 'content-addressed',
        '/cache/lapis-picture/lapis-1763900000000-8192.webp': 'content-addressed'
    };
    const mutable = ['/cache/site-icons/example.com.png', '/cache/wiki_files/post123.jpg', '/cache/wiki/page.json', '/cache/packages/app/icon.png', '/cache/vibe/abc.json'];
    for (const u of Object.keys(folders).concat(mutable)) await w.get(u, { destination: 'image' });
    const after = w.fetches.length;
    w.clock.skew = 25 * 60 * 60 * 1000; // 25 hours later
    for (const u of Object.keys(folders)) {
        await w.get(u, { destination: 'image' });
        assert.strictEqual(w.fetches.filter((f) => f.url === u).length, 1, `${u} (${folders[u]}) is still a hit after 25 h`);
    }
    for (const u of mutable) {
        await w.get(u, { destination: 'image' });
        assert.strictEqual(w.fetches.filter((f) => f.url === u).length, 2, `${u} (not content-addressed) keeps its day: fetched again after 25 h`);
    }
    assert.strictEqual(w.fetches.length, after + mutable.length);
    w.clock.skew = 0;
    // the paths with their own strategies keep theirs
    const route = (u) => w.get(u, { destination: 'image' });
    await route('/cache/preview/abcdef.webp');
    assert.ok(w.store.rows('explorer-preview-cache-v1').get(ORIGIN + '/cache/preview/abcdef.webp'), '/cache/preview/ keeps its own cache');
    assert.strictEqual(w.read('explorerPreviewStrategy').options.fetchOptions, undefined, '/cache/preview/ misses fetch with the request\'s own cache mode (the HTTP cache applies)');
    assert.strictEqual(w.fetches.find((f) => f.url === '/cache/preview/abcdef.webp').init, undefined);

    // ============================ 4. the preview miss uses the HTTP cache ============================
    const previewServe = () => served(Buffer.from('webp'), { 'content-type': 'image/webp', 'cache-control': 'private, max-age=259200', 'content-length': '4' });
    w = await worker({ serve: previewServe });
    const initOf = (u) => w.fetches.find((f) => f.url === u).init;
    await w.get('/previews/a_b@2x.webp', { destination: 'image' });
    assert.strictEqual(initOf('/previews/a_b@2x.webp'), undefined, 'a preview miss is fetched with the default cache mode (no cache: no-store, no no-cache request headers)');
    await w.get('/naxCache/gal/thumb.webp?w=480', { destination: 'image' });
    assert.strictEqual(initOf('/naxCache/gal/thumb.webp?w=480'), undefined, 'a NAX thumbnail too');
    // full pictures and requests that ask the server to process keep no-store
    await w.get('/images/full.png', { destination: 'image' });
    assert.strictEqual(initOf('/images/full.png').cache, 'no-store', 'a full picture keeps no-store');
    await w.get('/previews/a_b@ll.webp', { destination: 'image' });
    assert.strictEqual(initOf('/previews/a_b@ll.webp').cache, 'no-store', 'a lossless preview (a full picture) keeps no-store');
    await w.get('/previews/a_b@2x.webp?download=true', { destination: 'image' });
    assert.strictEqual(initOf('/previews/a_b@2x.webp?download=true').cache, 'no-store', 'download keeps no-store');
    await w.get('/previews/a_b@2x.webp?clipboard=true', { destination: 'image' });
    assert.strictEqual(initOf('/previews/a_b@2x.webp?clipboard=true').cache, 'no-store', 'clipboard keeps no-store');
    await w.get('/previews/fin.webp', { destination: 'image', headers: { 'X-Preview-Finalize': '1' } });
    assert.strictEqual(initOf('/previews/fin.webp').cache, 'no-store', 'a finalize request keeps no-store');
    // and a stored preview is served without any request
    const nPrev = w.fetches.length;
    await w.get('/previews/a_b@2x.webp', { destination: 'image' });
    assert.strictEqual(w.fetches.length, nPrev, 'the stored row answers');
    // the explicit refresh (deleteAndPrecache) and wallpapers still bypass the browser cache
    assert.ok(/async function deleteAndPrecache[\s\S]{0,1800}cache: 'no-store'/.test(swSrc), 'the cache viewer\'s refresh keeps no-store');

    console.log('test-update-held-background: ok');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
