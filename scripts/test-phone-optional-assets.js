#!/usr/bin/env node
/**
 * Melaton Mobile's lighter install (#890): a phone (the mobile bit and a Melaton Mobile boot on a handheld) carries the flag 'mobile' in
 * its package set (public/scripts/launch/assetPackages.js), and its manifest leaves out the Desktop
 * Background photos and the Sidebar's art ('wifi': fetched on demand, kept, prefetched on Wi-Fi by
 * public/sw.js) and the font files no phone browser reads ('demand'). Checks:
 *   - the rule, the server's filter per set (old phone cookies and desktops keep everything), the cookie
 *   - every 'demand' font exists and every @font-face naming it lists a WOFF2 first (or names it by a
 *     format Chromium skips), so a phone never asks for it; every pattern still matches a file
 *   - sw.js PHONE_WIFI_PREFIXES are the same folders as the rule
 *   - sw.js's Wi-Fi prefetch pass (Wi-Fi only, missing or changed files, stops off Wi-Fi, a complete
 *     pass is not repeated) and the page's PHONE_PREFETCH hints (mobile /app only, on change only)
 * Run: node scripts/test-phone-optional-assets.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const pk = require('../public/scripts/launch/assetPackages');
const swSrc = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');

// ---------- the rule ----------
const PHOTO = '/static_images/wallpapers/photos/japan/flickr-14446557593.webp';
const SIDEBAR = '/static_images/vista-sidebar/weather/32.png';
assert.strictEqual(pk.phoneOptional(PHOTO), 'wifi');
assert.strictEqual(pk.phoneOptional(SIDEBAR), 'wifi');
assert.strictEqual(pk.phoneOptional('/static_images/wallpapers/aurora.webp'), null, 'the stock auroras stay (the boot shows one)');
assert.strictEqual(pk.phoneOptional('/static_images/wallpapers/vista/img1.jpg'), null, 'the Vista wallpapers stay');
assert.strictEqual(pk.phoneOptional('/dist/fontawesome/webfonts/fa-solid-900.ttf'), 'demand');
assert.strictEqual(pk.phoneOptional('/dist/fontawesome/webfonts/fa-solid-900.woff2'), null, 'the WOFF2 stays');
assert.strictEqual(pk.phoneOptional('/dist/fonts/NotoSans-VariableFont_wdth,wght.ttf'), 'demand');
assert.strictEqual(pk.phoneOptional('/dist/fonts/NotoSans-Italic-VariableFont_wdth,wght.ttf'), null, 'a ttf with no WOFF2 stays');
assert.strictEqual(pk.phoneOptional('/dist/fonts/materialdesignicons-webfont.eot?v=7.4.47'), 'demand');
assert.strictEqual(pk.phoneOptional('/dist/remixicon/remixicon.symbol.svg'), null, 'the symbol sprite is not a font');
assert.strictEqual(pk.phoneOptional('/scripts/app.js'), null);

// ---------- the server's filter per set ----------
const full = [
    { url: '/scripts/app.js' }, { url: PHOTO }, { url: SIDEBAR },
    { url: '/dist/fontawesome/webfonts/fa-solid-900.ttf' }, { url: '/dist/fontawesome/webfonts/fa-solid-900.woff2' },
    { url: '/static_images/wm61/start.png' }, { url: '/static_images/wm61/start@2x.png' }
];
const urls = (rows) => rows.map((r) => r.url);
const phoneSet = pk.parseSet('mobile,wm61,wmc');
assert.deepStrictEqual(phoneSet, ['mobile', 'wm61', 'wmc'], 'the flag survives the server parse');
assert.deepStrictEqual(urls(pk.filterRows(full, phoneSet)), ['/scripts/app.js', '/dist/fontawesome/webfonts/fa-solid-900.woff2', '/static_images/wm61/start.png'],
    'a phone: no photos, Sidebar art or legacy fonts; its own art');
assert.deepStrictEqual(urls(pk.filterRows(full, pk.parseSet('wm61,wmc'))), ['/scripts/app.js', PHOTO, SIDEBAR,
    '/dist/fontawesome/webfonts/fa-solid-900.ttf', '/dist/fontawesome/webfonts/fa-solid-900.woff2', '/static_images/wm61/start.png'],
    'a phone still on the cookie of before: everything core, as before');
assert.strictEqual(pk.filterRows(full, pk.parseSet('none')).length, 5, 'a desktop: every core file');
assert.strictEqual(pk.parseSet(null), null, 'no cookie: the server sends everything');
assert.ok(!pk.PACKAGES.some((p) => p.id === pk.MOBILE_FLAG), 'the flag is not a package');

// the cookie: a mobile client's set carries the flag, current() (Applied Updates) does not
function pageWorld(state, extra = {}) {
    const store = new Map(state ? [['melatonPackages', JSON.stringify(state)]] : []);
    const doc = { cookie: '' };
    const ctx = Object.assign({
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
        document: doc, location: { protocol: 'https:', pathname: '/launch' }, screen: { width: 400, height: 800 }, devicePixelRatio: 2,
        console, JSON, Math, Set, Map, Array, Object, String, Number, encodeURIComponent, decodeURIComponent,
        setTimeout: () => 0
    }, extra);
    ctx.self = ctx;
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(PUBLIC, 'scripts/launch/assetPackages.js'), 'utf8'), ctx);
    return { api: ctx.melatonPackages, doc, ctx };
}
let p = pageWorld({ mobile: true, handheld: true, version: 'wm61', tier: 2, pinned: [] });
assert.strictEqual(decodeURIComponent(/melaton_pkgs=([^;]*)/.exec(p.doc.cookie)[1]), 'mobile,wm61,wm61-2x,wmc,wmc-2x', 'the page asserts the flag in the cookie at load');
assert.deepStrictEqual(Array.from(p.api.current()), ['wm61', 'wm61-2x', 'wmc', 'wmc-2x'], 'current() lists packages only');
assert.deepStrictEqual(urls(p.api.filterRows(full)), ['/scripts/app.js', '/dist/fontawesome/webfonts/fa-solid-900.woff2', '/static_images/wm61/start.png', '/static_images/wm61/start@2x.png'],
    'the page drops the same rows from a cache update broadcast');
p = pageWorld({ mobile: false, version: 'wm61', tier: 1, pinned: ['wm61'] });
assert.strictEqual(decodeURIComponent(/melaton_pkgs=([^;]*)/.exec(p.doc.cookie)[1]), 'wm61', 'a desktop that added Melaton Mobile art: no flag');
assert.strictEqual(p.api.filterRows(full).filter((r) => r.url === PHOTO).length, 1, 'and it keeps the photos');

// the flag needs a handheld: a desktop browser started narrower than 1200 px boots Melaton Mobile (and
// keeps the mobile bit for its art) but keeps the desktop's whole install
const cookieOf = (w) => decodeURIComponent((/melaton_pkgs=([^;]*)/.exec(w.doc.cookie) || [])[1] || '');
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 15; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
p = pageWorld(null, { navigator: { userAgent: DESKTOP_UA, userAgentData: { mobile: false } } });
p.api.noteBoot({ shell: 'mobile', version: '6.1', touch: false });
assert.strictEqual(cookieOf(p), 'wm61,wm61-2x,wmc,wmc-2x', 'a narrow desktop window: its art, no flag');
assert.strictEqual(p.api.filterRows(full).filter((r) => r.url === PHOTO || r.url === SIDEBAR).length, 2, 'it keeps the photos and the Sidebar art');
assert.strictEqual(p.api.read().handheld, false);
p = pageWorld(null, { navigator: { userAgent: DESKTOP_UA }, AndroidDisplay: { isDesktop: () => false } });
p.api.noteBoot({ shell: 'mobile', version: '6.1', touch: false });
assert.strictEqual(cookieOf(p), 'mobile,wm61,wm61-2x,wmc,wmc-2x', 'the Android app: the flag');
p.api.noteBoot({ shell: 'desktop' });
assert.strictEqual(cookieOf(p), 'hidpi-200,mobile,wm61,wm61-2x,wmc,wmc-2x', 'its DeX window (a desktop boot) keeps it, and adds the desktop art for its density (#921)');
// the desktop's HiDPI art (#921): one tier per density, never in a cookie-less client's manifest
{
    const d = pageWorld(null, { devicePixelRatio: 1.25, navigator: { userAgent: DESKTOP_UA } });
    d.api.noteBoot({ shell: 'desktop' });
    assert.strictEqual(cookieOf(d), 'hidpi-125', 'a 125 % desktop keeps the 1.25x art');
    const hd = [{ url: '/static_images/hidpi/125/vista-cpl/a.png' }, { url: '/static_images/hidpi/200/vista-cpl/a.png' }, { url: '/static_images/vista-cpl/a.png' }];
    assert.deepStrictEqual(urls(d.api.filterRows(hd)), ['/static_images/hidpi/125/vista-cpl/a.png', '/static_images/vista-cpl/a.png'], 'only its tier');
    assert.deepStrictEqual(urls(d.api.legacyRows(hd)), ['/static_images/vista-cpl/a.png'], 'a client from before packages: none');
    assert.deepStrictEqual([1, 1.25, 1.5, 1.75, 2, 3].map(d.api.hidpiTierFor), [1, 125, 150, 175, 200, 200]);
    const one = pageWorld(null, { devicePixelRatio: 1, navigator: { userAgent: DESKTOP_UA } });
    one.api.noteBoot({ shell: 'desktop' });
    assert.strictEqual(cookieOf(one), 'none', 'a 100 % desktop: core only');
}
p = pageWorld(null, { navigator: { userAgent: DESKTOP_UA, userAgentData: { mobile: true } } });
p.api.noteBoot({ shell: 'mobile', version: '6.1' });
assert.ok(cookieOf(p).startsWith('mobile,'), 'a browser whose client hints say phone');
p = pageWorld(null, { navigator: { userAgent: PHONE_UA } });
p.api.noteBoot({ shell: 'mobile', version: '6.1' });
assert.ok(cookieOf(p).startsWith('mobile,'), 'a phone browser by its user agent');
p = pageWorld({ mobile: true, version: 'wm61', tier: 1, pinned: [] }, { navigator: { userAgent: PHONE_UA } });
assert.strictEqual(cookieOf(p), 'wm61,wmc', 'a phone from before the handheld bit: the old cookie at load');
p.api.noteBoot({ shell: 'mobile', version: '6.1' });
assert.strictEqual(cookieOf(p), 'mobile,wm61,wm61-2x,wmc,wmc-2x', 'and the flag from its next Melaton Mobile boot');
p.ctx.navigator = { userAgent: DESKTOP_UA, userAgentData: { mobile: false } };
p.api.noteBoot({ shell: 'mobile', version: '6.1' });
assert.strictEqual(cookieOf(p), 'mobile,wm61,wm61-2x,wmc,wmc-2x', 'kept: a set that went back and forth would download the photos again');

// ---------- the fonts no phone reads ----------
const fontDirs = ['dist/fonts', 'dist/fontawesome/webfonts', 'dist/remixicon'];
const demandOnDisk = [];
for (const dir of fontDirs) {
    for (const name of fs.readdirSync(path.join(PUBLIC, dir))) {
        const web = `/${dir}/${name}`;
        if (pk.phoneOptional(web) === 'demand') demandOnDisk.push(web);
    }
}
// every @font-face in the public stylesheets (and inline ones): which font URLs come after a WOFF2
function cssFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full2 = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) cssFiles(full2, out); }
        else if (/\.(css|html)$/.test(e.name)) out.push(full2);
    }
    return out;
}
const refs = new Map(); // font path -> [{ file, safe }]
for (const file of cssFiles(PUBLIC)) {
    // comments out first: remixicon.css has one between two src entries
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!text.includes('@font-face')) continue;
    const base = 'http://x/' + path.relative(PUBLIC, file).replace(/\\/g, '/');
    for (const face of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const srcs = [...face[1].matchAll(/src\s*:([^;]*)(?:;|$)/g)].map((m) => m[1]);
        srcs.forEach((decl, at) => {
            const last = at === srcs.length - 1; // an earlier src is overridden by the last one
            let woff2Before = false;
            for (const item of decl.split(/,(?=\s*(?:url|local)\()/)) {
                const u = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(item);
                if (!u) continue;
                const fmt = (/format\(\s*["']?([^"')]+)/.exec(item) || [])[1] || '';
                const web = new URL(u[1], base).pathname;
                const isWoff2 = /\.woff2$/i.test(web);
                const skipped = /embedded-opentype|^svg$/i.test(fmt);
                if (!refs.has(web)) refs.set(web, []);
                refs.get(web).push({ file: path.relative(PUBLIC, file), safe: isWoff2 || woff2Before || skipped || !last });
                if (isWoff2) woff2Before = true;
            }
        });
    }
}
assert.ok(demandOnDisk.length >= 17, 'the legacy font files on disk: ' + demandOnDisk.length);
for (const web of demandOnDisk) {
    const r = refs.get(web) || [];
    assert.ok(r.length > 0, `${web} is named by a stylesheet (else it would not be a font fallback at all)`);
    const bad = r.filter((x) => !x.safe);
    assert.deepStrictEqual(bad, [], `${web}: a stylesheet lists it where a phone could read it`);
}
// every alternative of the pattern still matches a file (no dead rule)
for (const probe of ['/dist/fontawesome/webfonts/fa-', '/dist/fonts/materialdesignicons-webfont.', '/dist/fonts/NotoSans-VariableFont', '/dist/remixicon/remixicon.']) {
    assert.ok(demandOnDisk.some((w) => w.startsWith(probe)), 'a file for ' + probe);
}
// a JS file that names one directly would read it on a phone too
const jsHits = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full2 = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', 'dist', 'vendor'].includes(e.name) && !e.name.startsWith('.')) walk(full2); continue; }
        if (!/\.js$/.test(e.name)) continue;
        const text = fs.readFileSync(full2, 'utf8');
        for (const web of demandOnDisk) if (text.includes(path.basename(web))) jsHits.push(`${path.relative(PUBLIC, full2)}: ${web}`);
    }
})(path.join(PUBLIC, 'scripts'));
assert.deepStrictEqual(jsHits, [], 'no page script reads a legacy font file');

// ---------- sw.js and the rule draw the same line ----------
const prefixes = JSON.parse(/const PHONE_WIFI_PREFIXES = (\[[^\]]*\]);/.exec(swSrc)[1].replace(/'/g, '"'));
assert.deepStrictEqual(prefixes, ['/static_images/wallpapers/photos/', '/static_images/vista-sidebar/']);
for (const prefix of prefixes) assert.strictEqual(pk.phoneOptional(prefix + 'x.png'), 'wifi', prefix);
for (const dir of ['static_images/wallpapers/photos', 'static_images/vista-sidebar']) {
    assert.ok(fs.existsSync(path.join(PUBLIC, dir)), dir + ' exists');
}

// what a phone no longer installs (information)
function du(rel) {
    let files = 0;
    let bytes = 0;
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const f = path.join(d, e.name);
            if (e.isDirectory()) walk(f);
            else { files += 1; bytes += fs.statSync(f).size; }
        }
    })(path.join(PUBLIC, rel));
    return { files, bytes };
}
const photos = du('static_images/wallpapers/photos');
const sidebar = du('static_images/vista-sidebar');
const fontBytes = demandOnDisk.reduce((n, w) => n + fs.statSync(path.join(PUBLIC, w)).size, 0);
console.log(`phone install leaves out: photos ${photos.files} files ${(photos.bytes / 1048576).toFixed(1)} MB, `
    + `sidebar ${sidebar.files} files ${(sidebar.bytes / 1048576).toFixed(1)} MB, fonts ${demandOnDisk.length} files ${(fontBytes / 1048576).toFixed(1)} MB`);

// ---------- sw.js: the Wi-Fi prefetch pass ----------
function swBlock(from, to) {
    const a = swSrc.indexOf(from);
    const b = swSrc.indexOf(to, a);
    assert.ok(a > 0 && b > a, from);
    return swSrc.slice(a, b);
}
const prefetchSrc = swBlock('// ---------- Melaton Mobile\'s on-demand files (#890)', '// Activate event - clean up old caches');
function fnOf(name) {
    const at = swSrc.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
    assert.ok(at >= 0, name);
    return swSrc.slice(at, swSrc.indexOf('\n}\n', at) + 3);
}
async function sha(bytes) {
    return require('crypto').createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}
function prefetchWorld(opts) {
    const calls = [];
    const statics = new Map(Object.entries(opts.cached || {})); // path -> hash
    const internal = opts.internal || new Map();
    const server = opts.server; // url -> body string
    const headers = (h) => ({ get: (n) => (h || {})[n.toLowerCase()] || null });
    const conn = { type: opts.type || 'wifi', saveData: false };
    const body = (text) => new TextEncoder().encode(text).buffer;
    const ctx = {
        Promise, JSON, URL, Map, Set, Math, Number, String, Array, Request: class { constructor(u) { this.url = 'http://x' + u; } },
        Date, console,
        setTimeout: (fn) => setImmediate(fn),
        Response: class { constructor(b, init) { this.b = b; this.init = init; } json() { return Promise.resolve(JSON.parse(this.b)); } },
        self: { location: { origin: 'http://x' }, navigator: { connection: conn } },
        STATIC_CACHE: 'static', INTERNAL_CACHE: 'internal', PHONE_WIFI_PREFIXES: prefixes,
        downloadState: { isDownloading: false },
        perfLog: () => {}, perfSpan: (n, fn) => fn(),
        sha256Hex: sha,
        purgeStaticCacheEntries: async (cache, url) => { calls.push('purge ' + url); },
        staticCacheResponseWithHash: (b, res, hash) => ({ hash }),
        caches: { open: async (name) => (name === 'internal'
            ? { match: async (k) => internal.get(k), put: async (k, res) => { internal.set(k, res); } }
            : {
                match: async (p2) => (statics.has(p2) ? { headers: headers({ 'x-file-hash': statics.get(p2) }) } : undefined),
                put: async (req, res) => { calls.push('put ' + new URL(req.url).pathname); statics.set(new URL(req.url).pathname, res.hash); }
            }) },
        fetch: async (url, init) => {
            const method = (init && init.method) || 'GET';
            if (method === 'OPTIONS') {
                calls.push('OPTIONS ' + (init.headers['X-Melaton-Packages'] || '') + (init.headers['X-Manifest-Hash'] ? ' ' + init.headers['X-Manifest-Hash'] : ''));
                if (init.headers['X-Manifest-Hash'] === opts.digest) return { ok: false, status: 304, headers: headers({ 'x-manifest-hash': opts.digest }) };
                const rows = await Promise.all(Object.entries(server).map(async ([u, text]) => ({ url: u, hash: await sha(body(text)) })));
                return { ok: true, status: 200, headers: headers({ 'x-manifest-hash': opts.digest }), json: async () => rows.concat([{ url: '/scripts/app.js', hash: 'zz' }]) };
            }
            calls.push('GET ' + url + (init && init.priority ? ' ' + init.priority : ''));
            if (opts.onGet) opts.onGet(url, conn, ctx);
            return { ok: true, status: 200, arrayBuffer: async () => body(server[url]) };
        }
    };
    vm.createContext(ctx);
    vm.runInContext(prefetchSrc + '\nthis.api = { runPhonePrefetch, notePhoneNetwork, workerNetwork };', ctx);
    return { api: ctx.api, calls, statics, internal, conn, ctx };
}

// the page's hint, from the page
function hintWorld({ mobile, pathname, type, bridge, asleep }) {
    const posts = [];
    const timers = [];
    const listeners = {};
    const doc = {
        cookie: '', hidden: false, documentElement: { dataset: asleep ? { screenOff: '' } : {} },
        addEventListener: (ev, fn) => { listeners['doc:' + ev] = fn; }
    };
    const conn = type === undefined ? undefined : { type, addEventListener: (ev, fn) => { listeners['conn:' + ev] = fn; } };
    const extra = {
        location: { protocol: 'https:', pathname },
        navigator: {
            connection: conn,
            serviceWorker: { controller: { postMessage: (m) => posts.push(m) }, addEventListener: (ev, fn) => { listeners['sw:' + ev] = fn; } }
        },
        document: doc,
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        addEventListener: (ev, fn) => { listeners['win:' + ev] = fn; },
        AndroidDeviceStatus: bridge ? { getState: () => JSON.stringify(bridge.state) } : undefined
    };
    const w2 = pageWorld(mobile ? { mobile: true, handheld: mobile !== 'narrow-desktop', version: 'wm61', tier: 1, pinned: [] } : { mobile: false, version: 'wm61', tier: 1, pinned: [] }, extra);
    return { posts, timers, listeners, conn, doc, w: w2 };
}

(async () => {
    const server = {
        [PHOTO]: 'photo-1',
        '/static_images/wallpapers/photos/usa/b.webp': 'photo-2',
        [SIDEBAR]: 'sidebar-1'
    };
    const have = await sha(new TextEncoder().encode('photo-1').buffer);

    // on Wi-Fi: the core list (X-Melaton-Packages: none), then the missing files one by one, low priority
    let w = prefetchWorld({ server, digest: 'L1', cached: { [PHOTO]: have } });
    await w.api.runPhonePrefetch();
    assert.deepStrictEqual(w.calls.filter((c) => !c.startsWith('purge')), [
        'OPTIONS none',
        'GET /static_images/wallpapers/photos/usa/b.webp low', 'put /static_images/wallpapers/photos/usa/b.webp',
        `GET ${SIDEBAR} low`, `put ${SIDEBAR}`
    ], 'the file it has is not fetched again; app files are not its business');
    const record = JSON.parse(w.internal.get('/internal/sw-phone-optional-v1').b);
    assert.strictEqual(record.complete, true, 'a pass with nothing missed is complete');
    assert.strictEqual(record.rows.length, 3, 'only the phone-optional rows are kept');

    // the next boot: the list by its digest (304), complete: nothing else
    w = prefetchWorld({ server, digest: 'L1', internal: w.internal, cached: {} });
    await w.api.runPhonePrefetch();
    assert.deepStrictEqual(w.calls, ['OPTIONS none L1'], 'a complete pass is not repeated for the same list');

    // a new list (a photo changed on the server): checked again
    const changed = Object.assign({}, server, { [PHOTO]: 'photo-1b' });
    w = prefetchWorld({ server: changed, digest: 'L2', internal: w.internal, cached: { [PHOTO]: have } });
    await w.api.runPhonePrefetch();
    assert.ok(w.calls.includes(`GET ${PHOTO} low`), 'a file whose hash changed is fetched again');

    // a code update moves the core digest, the 'wifi' rows stay: the complete pass stands (no cache
    // walk, nothing fetched) and the record takes the new digest (#890)
    w = prefetchWorld({ server: changed, digest: 'L3', internal: w.internal, cached: {} });
    await w.api.runPhonePrefetch();
    assert.deepStrictEqual(w.calls, ['OPTIONS none L2'], 'same rows under a new digest: no pass');
    const moved = JSON.parse(w.internal.get('/internal/sw-phone-optional-v1').b);
    assert.strictEqual(moved.hash, 'L3', 'kept under the new digest');
    assert.strictEqual(moved.complete, true, 'still complete');
    w = prefetchWorld({ server: changed, digest: 'L3', internal: w.internal, cached: {} });
    await w.api.runPhonePrefetch();
    assert.deepStrictEqual(w.calls, ['OPTIONS none L3'], 'and the next check is a 304');

    // on cellular: nothing at all
    w = prefetchWorld({ server, digest: 'L1', type: 'cellular' });
    await w.api.runPhonePrefetch();
    assert.deepStrictEqual(w.calls, [], 'no request off Wi-Fi');

    // the network leaves Wi-Fi mid-pass: it stops, and the pass is not complete
    w = prefetchWorld({ server, digest: 'L1', onGet: (url, conn) => { conn.type = 'cellular'; } });
    await w.api.runPhonePrefetch();
    assert.strictEqual(w.calls.filter((c) => c.startsWith('GET')).length, 1, 'stops after the file in flight');
    assert.strictEqual(JSON.parse(w.internal.get('/internal/sw-phone-optional-v1').b).complete, false);

    // the worker cannot see the type: the page's hint decides
    w = prefetchWorld({ server, digest: 'L1', type: 'unknown' });
    await w.api.runPhonePrefetch();
    assert.deepStrictEqual(w.calls, [], 'unknown: nothing');
    w.api.notePhoneNetwork('unmetered');
    await w.api.runPhonePrefetch();
    assert.ok(w.calls.filter((c) => c.startsWith('GET')).length === 3, 'the page says Wi-Fi: fetched');

    // an update download running: the prefetch steps aside
    w = prefetchWorld({ server, digest: 'L1' });
    w.ctx.downloadState.isDownloading = true;
    await w.api.runPhonePrefetch();
    assert.strictEqual(w.calls.filter((c) => c.startsWith('GET')).length, 0, 'no prefetch during an update download');

    // the message wiring
    assert.ok(/type === 'PHONE_PREFETCH'\) \{[\s\S]{0,200}notePhoneNetwork\(event\.data\.network\);\s*event\.waitUntil\(heldAtMost\(runPhonePrefetch\(\)\)\);/.test(swSrc), 'PHONE_PREFETCH starts a pass under waitUntil');

    // a long job holds its message event for a bounded time only
    const hctx = { Promise, setTimeout, clearTimeout };
    vm.createContext(hctx);
    vm.runInContext(/^const EVENT_HOLD_MAX_MS = [^;]+;/m.exec(swSrc)[0] + '\n' + fnOf('heldAtMost') + '\nthis.held = heldAtMost; this.max = EVENT_HOLD_MAX_MS;', hctx);
    assert.ok(hctx.max < 5 * 60 * 1000, 'under the browser\'s 5 minutes');
    const t0 = Date.now();
    await hctx.held(new Promise(() => {}), 30);
    assert.ok(Date.now() - t0 < 1000, 'a job that runs on releases the event at the cap');
    assert.strictEqual(await hctx.held(Promise.resolve(7), 60000), 7, 'a job that ends first ends the hold');
    assert.ok(/event\.waitUntil\(heldAtMost\(perfSpan\(`cacheStaticFiles/.test(swSrc), 'the download is held, within the cap');

    // ---------- the page's hints ----------
    const plain = (v) => JSON.parse(JSON.stringify(v)); // objects from the page's realm
    // a phone's /app: nothing during the boot, then the network once, then only changes
    let h = hintWorld({ mobile: true, pathname: '/app', type: 'wifi' });
    assert.strictEqual(h.posts.length, 0, 'nothing during the boot');
    assert.strictEqual(h.timers.length, 1);
    assert.ok(h.timers[0].ms >= 20000, 'after the boot');
    h.timers[0].fn();
    assert.deepStrictEqual(plain(h.posts), [{ type: 'PHONE_PREFETCH', network: 'unmetered' }]);
    h.listeners['conn:change']();
    assert.strictEqual(h.posts.length, 1, 'no change, no message');
    h.conn.type = 'cellular';
    h.listeners['conn:change']();
    assert.deepStrictEqual(plain(h.posts[1]), { type: 'PHONE_PREFETCH', network: 'metered' });
    h.listeners['sw:controllerchange']();
    assert.strictEqual(h.posts.length, 3, 'a new worker hears it again');

    // no connection type (or 'unknown'): the Android app's status says it
    h = hintWorld({ mobile: true, pathname: '/app', type: 'unknown', bridge: { state: { active: 'wifi', wifi: { connected: true } } } });
    h.timers[0].fn();
    assert.deepStrictEqual(plain(h.posts), [{ type: 'PHONE_PREFETCH', network: 'unmetered' }]);
    h.listeners['win:androiddevicestatus']({ detail: { active: 'cellular' } });
    assert.deepStrictEqual(plain(h.posts[1]), { type: 'PHONE_PREFETCH', network: 'metered' });
    h.listeners['win:androiddevicestatus']({ detail: JSON.stringify({ active: 'cellular' }) });
    assert.strictEqual(h.posts.length, 2, 'a status event with the same link sends nothing');
    h.listeners['win:androiddevicestatus']({ detail: { active: 'vpn', wifi: { connected: true } } });
    assert.deepStrictEqual(plain(h.posts[2]), { type: 'PHONE_PREFETCH', network: 'unmetered' }, 'a VPN on Wi-Fi');

    // a page that is not seen holds its hint until it is seen again (#890): the screen off at the end of
    // the boot, a change while off, then the screen on; behind an Android program the same
    h = hintWorld({ mobile: true, pathname: '/app', type: 'wifi', asleep: true });
    h.timers[0].fn();
    assert.strictEqual(h.posts.length, 0, 'asleep at the end of the boot: nothing');
    h.listeners['conn:change']();
    assert.strictEqual(h.posts.length, 0, 'nor on a change while asleep');
    delete h.doc.documentElement.dataset.screenOff;
    h.listeners['win:melatonscreen']({ detail: { on: true } });
    assert.deepStrictEqual(plain(h.posts), [{ type: 'PHONE_PREFETCH', network: 'unmetered' }], 'the held hint goes once the screen is on');
    h.listeners['doc:visibilitychange']();
    assert.strictEqual(h.posts.length, 1, 'nothing held, nothing sent');
    // Wi-Fi to cellular while behind a program: 'metered' stops a running pass, so it goes at once
    h.doc.documentElement.dataset.wmBehind = '';
    h.conn.type = 'cellular';
    h.listeners['conn:change']();
    assert.deepStrictEqual(plain(h.posts[1]), { type: 'PHONE_PREFETCH', network: 'metered' }, 'metered is never held');
    // back on Wi-Fi while behind: held (it would start work)
    h.conn.type = 'wifi';
    h.listeners['conn:change']();
    assert.strictEqual(h.posts.length, 2, 'behind a program: unmetered held');
    delete h.doc.documentElement.dataset.wmBehind;
    h.listeners['doc:wmBehind']();
    assert.deepStrictEqual(plain(h.posts[2]), { type: 'PHONE_PREFETCH', network: 'unmetered' }, 'sent when the page is in front again');
    // hidden, the app status says cellular (connection type unknown): sent at once too
    h = hintWorld({ mobile: true, pathname: '/app', type: '', bridge: { state: { active: 'wifi' } } });
    h.timers[0].fn();
    assert.deepStrictEqual(plain(h.posts), [{ type: 'PHONE_PREFETCH', network: 'unmetered' }]);
    h.doc.hidden = true;
    h.listeners['win:androiddevicestatus']({ detail: { active: 'cellular' } });
    assert.deepStrictEqual(plain(h.posts[1]), { type: 'PHONE_PREFETCH', network: 'metered' }, 'hidden: metered goes at once');

    // a desktop, or a phone's /launch: never
    h = hintWorld({ mobile: false, pathname: '/app', type: 'wifi' });
    h.timers.forEach((t) => t.fn());
    assert.strictEqual(h.posts.length, 0, 'a desktop sends nothing');
    assert.strictEqual(h.listeners['conn:change'], undefined, 'and listens to nothing');
    h = hintWorld({ mobile: true, pathname: '/launch', type: 'wifi' });
    assert.strictEqual(h.timers.length, 0, 'the installer page does not start it');
    h = hintWorld({ mobile: 'narrow-desktop', pathname: '/app', type: 'wifi' });
    h.timers.forEach((t) => t.fn());
    assert.strictEqual(h.posts.length, 0, 'a narrow desktop window (full install) sends nothing');

    console.log('test-phone-optional-assets: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
