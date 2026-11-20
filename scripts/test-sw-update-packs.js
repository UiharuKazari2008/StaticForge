#!/usr/bin/env node
// sw.js downloads for the static cache are one pack per round (#951): CACHE_STATIC_FILES posts its list to
// /install/meletonfx.zip, unzips the answer with fflate, checks each entry and stores it; what did not come down goes
// back as ONE more pack (backoff, Retry-After), never a request per file. The server half is the real
// modules/updatePack.js over a pack built by meletonInstallPack, so the zip the worker reads is the one it gets live.
// Run: node scripts/test-sw-update-packs.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const meletonInstallPack = require('../modules/meletonInstallPack');
const updatePack = require('../modules/updatePack');

const swSrc = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
const fflateSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/vendor/fflate.js'), 'utf8');

function topLevel(name) {
    const re = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    const at = swSrc.search(re);
    assert.ok(at >= 0, `sw.js has ${name}`);
    const end = swSrc.indexOf('\n}\n', at);
    return swSrc.slice(at, end + 3);
}
function constLine(name) {
    const m = new RegExp(`^(?:const|let) ${name} = [^\\n]*;$`, 'm').exec(swSrc);
    assert.ok(m, `sw.js has ${name}`);
    return m[0];
}

const FUNCS = ['retryAfterMs', 'retryOrFailStaticFile', 'nextStaticRetry', 'freshDownloadState', 'staticCacheResponseWithHash',
    'takeUpdatePackBatch', 'readUpdatePackBody', 'fetchUpdatePack', 'eachUpdatePackEntry', 'updatePackRow', 'updatePackStoreHash',
    'postDownloadProgress', 'cacheUpdatePack', 'postStaticCacheProgress', 'sendStaticCacheProgress', 'dropStaticCacheProgress',
    'noteInstallFileDone', 'mergeIntoRunningDownload', 'cacheStaticFiles', 'hasBodyHash', 'sha256Hex', 'isAuthGatedStaticPath',
    'isAuthGatedManifestFile', 'getContentTypeFromPath', 'purgeStaticCacheEntriesNow'];
const CONSTS = ['STATIC_CACHE', 'SAVED_ASSET_CACHE_CONTROL', 'NON_BODY_HASH_PATHS', 'STATIC_FILE_RETRY_DELAYS_MS', 'STATIC_FILE_404_RETRIES',
    'UPDATE_PACK_URL', 'UPDATE_PACK_MAX_BYTES', 'UPDATE_PACK_MAX_FILES', 'UPDATE_PACK_HEAD_TIMEOUT_MS', 'UPDATE_PACK_IDLE_TIMEOUT_MS',
    'UPDATE_PACK_EXTRACT_BYTES', 'STATIC_PROGRESS_POST_MS', 'staticProgressLatest', 'staticProgressTimer', 'staticProgressPostedAt'];

// the worker's arrays come from another realm
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

class FakeRes extends EventEmitter {
    constructor() { super(); this.chunks = []; }
    write(b) { this.chunks.push(Buffer.from(b)); return true; }
    end() {}
}

async function world(opts = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-packs-'));
    const disk = {};
    const manifest = [];
    for (const [url, bytes] of Object.entries(opts.files)) {
        const p = path.join(dir, 'public', url);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, bytes);
        disk[url] = p;
        manifest.push({ url, hash: sha(bytes), size: opts.sizes && opts.sizes[url] || bytes.length });
    }
    for (const url of opts.unresolved || []) manifest.push({ url, hash: 'f'.repeat(64), size: 10 });
    const resolveFile = (row) => disk[row.url] || null;
    meletonInstallPack.init({ outputDir: path.join(dir, 'packs') });
    await meletonInstallPack.rebuild({ outputDir: path.join(dir, 'packs'), manifest, resolveFile });
    const byUrl = new Map(manifest.map((r) => [r.url, r]));

    let clock = 1e12;
    const timers = [];
    const posts = [];
    const requests = [];
    const rows = new Map(); // path -> Response
    const cache = {
        match: async (req) => rows.get(new URL(typeof req === 'string' ? req : req.url, 'http://x').pathname),
        put: async (req, res) => { rows.set(new URL(typeof req === 'string' ? req : req.url, 'http://x').pathname, res); },
        delete: async (req) => rows.delete(new URL(typeof req === 'string' ? req : req.url, 'http://x').pathname)
    };
    const script = (opts.script || []).slice();
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Promise, JSON, Map, Set, Math, Number, String, Array, Object, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder, Error,
        URL, Headers, Response, AbortController, crypto: globalThis.crypto,
        Request: class extends Request { constructor(u, init) { super(new URL(u, 'http://x'), init); } },
        // each read moves the clock 1 ms: files put back in one loop get _nextAt a few ms apart, as in a browser
        Date: { now: () => clock++ },
        setTimeout: (fn, ms) => { const t = { fn, at: clock + (ms || 0) }; timers.push(t); setImmediate(() => { if (t.cancelled) return; clock = Math.max(clock, t.at); fn(); }); return t; },
        clearTimeout: (t) => { if (t) t.cancelled = true; },
        caches: { open: async () => cache },
        self: {
            location: { origin: 'http://x' },
            clients: { matchAll: async () => [{ postMessage: (m) => posts.push(m) }] }
        },
        startStallDetection() {}, stopStallDetection() {},
        perfSpan: (n, fn) => fn(),
        fetch: async (url, init) => {
            const method = (init && init.method) || 'GET';
            const body = init && init.body ? JSON.parse(init.body) : null;
            requests.push({ method, url, files: body ? body.files.map((f) => f.url) : null });
            const step = script.shift();
            if (step && step.status) {
                return new Response(JSON.stringify({ success: false }), { status: step.status, headers: step.headers || {} });
            }
            if (step && step.networkError) throw new TypeError('Failed to fetch');
            assert.strictEqual(method, 'POST', `${url}: only packs are fetched`);
            assert.strictEqual(url, '/install/meletonfx.zip');
            const planned = await updatePack.plan({ manifestByUrl: byUrl, requested: body.files, resolveFile, contentType: (u) => (u.endsWith('.js') ? 'application/javascript; charset=UTF-8' : '') });
            if (!planned.files && planned.missing.every((m) => m.reason === 'not-found')) {
                await planned.close();
                return new Response('{}', { status: 404 });
            }
            const res = new FakeRes();
            await updatePack.send(res, planned);
            let zip = Buffer.concat(res.chunks);
            if (step && step.damage) {
                // flip a byte inside the named entry's stored data
                const at = zip.indexOf(Buffer.from(step.damage)) + step.damage.length + 10;
                zip = Buffer.from(zip);
                zip[at] ^= 0xff;
            }
            return new Response(zip, { status: 200, headers: { 'content-length': String(zip.length), 'content-type': 'application/zip' } });
        }
    };
    ctx.self.fflate = (() => {
        const m = { exports: {} };
        new Function('module', 'exports', 'define', fflateSrc)(m, m.exports, undefined);
        return m.exports;
    })();
    vm.createContext(ctx);
    const code = CONSTS.map(constLine).join('\n') + '\n' + FUNCS.map(topLevel).join('\n')
        + '\nasync function purgeStaticCacheEntries(cache, urlPath) { return purgeStaticCacheEntriesNow(cache, urlPath); }'
        + '\nlet downloadState = freshDownloadState();'
        + '\nthis.api = { cacheStaticFiles, mergeIntoRunningDownload, state: () => downloadState };';
    vm.runInContext(code, ctx);
    return {
        api: ctx.api, posts, requests, rows, manifest, byUrl,
        cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
        complete: () => posts.find((m) => m.type === 'STATIC_CACHE_COMPLETE')
    };
}

(async () => {
    const files = {
        '/scripts/a.js': Buffer.from('console.log("a");\n'.repeat(200)),
        '/css/b.css': Buffer.from('b{color:red}\n'.repeat(200)),
        '/static_images/c.png': crypto.randomBytes(3000),
        '/static_images/d.webp': crypto.randomBytes(9000),
        '/scripts/e.js': Buffer.from('let e = 1;\n'.repeat(300))
    };

    // 1. five files: one request, all stored with the installer's row shape, reported updated
    let w = await world({ files });
    let list = w.manifest.slice();
    await w.api.cacheStaticFiles(list, true, 'page-1');
    assert.strictEqual(w.requests.length, 1, 'one pack for the round');
    same(w.requests[0].files, list.map((f) => f.url), 'the list in manifest order');
    let done = w.complete();
    assert.ok(done, 'STATIC_CACHE_COMPLETE');
    same(done.updatedFiles.map((f) => f.url).sort(), list.map((f) => f.url).sort());
    same(done.failed, []);
    const row = w.rows.get('/scripts/a.js');
    assert.strictEqual(row.headers.get('x-file-hash'), sha(files['/scripts/a.js']));
    assert.strictEqual(row.headers.get('content-type'), 'application/javascript; charset=UTF-8', 'the type the server serves it with');
    assert.strictEqual(row.headers.get('vary'), null);
    assert.ok(Buffer.from(await row.arrayBuffer()).equals(files['/scripts/a.js']), 'the bytes');
    assert.strictEqual(w.rows.get('/static_images/c.png').headers.get('content-type'), 'image/png');
    const counts = w.posts.filter((m) => m.type === 'STATIC_CACHE_PROGRESS').map((m) => m.completed);
    same(counts, counts.slice().sort((a, b) => a - b), 'progress never goes back');
    w.cleanup();

    // 2. the server answers 503 + Retry-After (starting), then the pack: two requests, no per-file GET
    w = await world({ files, script: [{ status: 503, headers: { 'Retry-After': '5' } }] });
    await w.api.cacheStaticFiles(w.manifest.slice(), true);
    assert.strictEqual(w.requests.length, 2, '503, then ONE more pack (the files put back a few ms apart go together)');
    same(w.requests[1].files.sort(), w.manifest.map((f) => f.url).sort(), 'every file in the second pack');
    assert.strictEqual(w.complete().updatedFiles.length, 5);
    w.cleanup();

    // 3. a dropped link mid-round: the whole list goes back as one pack
    w = await world({ files, script: [{ networkError: true }] });
    await w.api.cacheStaticFiles(w.manifest.slice(), true);
    assert.strictEqual(w.requests.length, 2);
    assert.strictEqual(w.complete().updatedFiles.length, 5);
    w.cleanup();

    // 4. one entry damaged in transfer: only it goes back, in one more pack
    w = await world({ files, script: [{ damage: 'static_images/d.webp' }] });
    await w.api.cacheStaticFiles(w.manifest.slice(), true);
    assert.strictEqual(w.requests.length, 2, 'the damaged file in a second pack');
    same(w.requests[1].files, ['/static_images/d.webp']);
    assert.strictEqual(w.complete().updatedFiles.length, 5);
    assert.ok(Buffer.from(await w.rows.get('/static_images/d.webp').arrayBuffer()).equals(files['/static_images/d.webp']));
    w.cleanup();

    // 5. a file the server does not have yet (in the manifest, no file) and one it never heard of: tried again in packs
    //    with the others' retries, then failed / absent; nothing else asked again; never a per-file request
    w = await world({ files, unresolved: ['/scripts/new.js'] });
    list = w.manifest.slice().concat([{ url: '/scripts/gone.js', hash: '0'.repeat(64), size: 5 }]);
    await w.api.cacheStaticFiles(list, true);
    done = w.complete();
    assert.strictEqual(w.requests[0].files.length, 7);
    for (const r of w.requests.slice(1)) assert.ok(r.files.every((u) => u === '/scripts/new.js' || u === '/scripts/gone.js'), 'retries carry only what is missing');
    assert.ok(w.requests.slice(1).some((r) => r.files.length === 2), 'both missing files ride in the same retry pack');
    assert.ok(w.requests.length <= 1 + 5, `bounded rounds (${w.requests.length})`);
    same(done.failed.map((f) => f.url).sort(), ['/scripts/gone.js', '/scripts/new.js']);
    same(done.absent, ['/scripts/gone.js'], 'the 404 is reported absent');
    assert.strictEqual(done.updatedFiles.length, 5);
    w.cleanup();

    // 6. a large round: a few packs of at most UPDATE_PACK_MAX_BYTES (manifest sizes), in order
    const sizes = { '/scripts/a.js': 20e6, '/css/b.css': 20e6, '/static_images/c.png': 1e6, '/static_images/d.webp': 1e6, '/scripts/e.js': 1e6 };
    w = await world({ files, sizes });
    await w.api.cacheStaticFiles(w.manifest.slice(), true);
    same(w.requests.map((r) => r.files.length), [1, 4], '24 MB packs');
    assert.strictEqual(w.complete().updatedFiles.length, 5);
    w.cleanup();

    // 7. auth-gated rows are never asked for
    w = await world({ files });
    await w.api.cacheStaticFiles(w.manifest.slice().concat([{ url: '/protected/x.js', hash: 'a', size: 1 }, { url: '/app', hash: 'b', size: 1, type: 'route' }]), true);
    assert.strictEqual(w.requests.length, 1);
    assert.ok(!w.requests[0].files.includes('/protected/x.js') && !w.requests[0].files.includes('/app'));
    assert.strictEqual(w.complete().completed, 7, 'counted done');
    w.cleanup();

    // 8. a 413 from a server with a smaller cap: the same files in halves
    w = await world({ files, script: [{ status: 413 }] });
    await w.api.cacheStaticFiles(w.manifest.slice(), true);
    same(w.requests.map((r) => r.files ? r.files.length : 0), [5, 2, 2, 1]);
    assert.strictEqual(w.complete().updatedFiles.length, 5);
    w.cleanup();

    console.log('test-sw-update-packs: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
