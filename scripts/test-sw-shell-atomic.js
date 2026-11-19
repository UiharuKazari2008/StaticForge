#!/usr/bin/env node
// public/sw.js: the kept shell and its files switch together, and a missing page file never waits on
// the network without a limit (Yozora #924). The bug this guards: an installed client's kept /app
// named a desktopBoot.js hash its cache did not hold (one update of several failed at a restart);
// with the server unreachable the request hung 334 s and the page died "desktopBoot is not defined".
// Run: node scripts/test-sw-shell-atomic.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const policy = require('../public/scripts/launch/updatePolicy.js');

function fnSource(name) {
    const at = src.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
    assert.ok(at >= 0, name + ' in sw.js');
    const end = src.indexOf('\n}\n', at);
    return src.slice(at, end + 3);
}
function constSource(name) {
    const at = src.search(new RegExp('^(const|let) ' + name + ' = ', 'm'));
    assert.ok(at >= 0, name + ' in sw.js');
    const end = src.indexOf(';\n', at);
    return src.slice(at, end + 2);
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const page = (boot, app) => `<html><script src="/scripts/comp/desktopBoot.js?sha=${boot}"></script><script src="scripts/app.js?sha=${app}"></script><link rel="stylesheet" href="/css/x.css?sha=${C}"><script src="/protected/p.js?sha=${C}"></script></html>`;

function world() {
    const stores = new Map();
    const open = async (name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const rows = stores.get(name);
        const keyOf = (k) => { const u = typeof k === 'string' ? k : k.url; return u.replace(/^http:\/\/x/, ''); };
        return {
            rows,
            match: async (k) => { const r = rows.get(keyOf(k)); return r ? r.clone() : undefined; },
            put: async (k, r) => { rows.set(keyOf(k), r); },
            delete: async (k) => rows.delete(keyOf(k)),
            keys: async () => Array.from(rows.keys()).map((u) => ({ url: 'http://x' + u }))
        };
    };
    const posted = [];
    const navigated = [];
    const client = { url: 'http://x/app', postMessage: (m) => posted.push(m), navigate: async (u) => { navigated.push(u); } };
    const ctx = {
        Response, Headers, URL, Map, Set, Promise, Date, AbortController, setTimeout, clearTimeout, console,
        caches: { open },
        self: { location: { origin: 'http://x' }, navigator: { userAgent: 'Chromium DreamOS/0.2' }, clients: { matchAll: async () => [client], get: async () => client } },
        fetch: null,
        respondWithSavedAsset: (request, row) => row,
        hashedScriptRow: async () => null,
        perfSpan: (n, fn) => fn()
    };
    vm.createContext(ctx);
    vm.runInContext([
        "const STATIC_CACHE = 'static'; const SCRIPT_CODE_CACHE = 'code'; const LAUNCH_SHELL_CACHE = 'shell';",
        "const LAUNCH_SHELL_KEY = '/launch'; const APP_SHELL_KEY = '/app'; const SHELL_ASSET_CACHE_CONTROL = 'no-cache';",
        "const HASHED_FAST_PREFIXES = ['/scripts/', '/css/'];",
        'let MISSING_ASSET_WAIT_MS = 150; let MISSING_ASSET_WAIT_INSTALLED_MS = 100; const SHELL_REPAIR_EVERY_MS = 180000; let shellRepairAt = 0;',
        constSource('SHELL_CRITICAL_PATHS'), constSource('SHELL_NEXT_SUFFIX'), constSource('SHELL_REF'), constSource('INSTALLED_CLIENT_UA'), constSource('isAppWebView'),
        'let scriptCodeCacheOpen = null; let scriptCodeKeyIndex = null;',
        fnSource('openScriptCodeCache'), fnSource('scriptCodeKeys'), fnSource('isAuthGatedStaticPath'), fnSource('matchStaticShell'),
        fnSource('shellFileRefs'), fnSource('shellFileMissing'), fnSource('keepShell'), fnSource('promoteShell'), fnSource('commitShells'),
        fnSource('answerHashedAsset'), fnSource('earlierScriptCopy'), fnSource('fetchMissingHashedAsset'), fnSource('reportMissingAsset'),
        'this.api = { shellFileRefs, keepShell, commitShells, answerHashedAsset, SHELL_CRITICAL_PATHS };'
    ].join('\n'), ctx);
    return { ctx, api: ctx.api, open, posted, navigated };
}

const row = (hash, body = 'x') => new Response(body, { status: 200, headers: { 'x-file-hash': hash } });
const shell = (html) => new Response(html, { status: 200, headers: { 'x-melaton-shell': 'app', 'content-type': 'text/html' } });

(async () => {
    // the critical list is the policy's
    let w = world();
    assert.deepStrictEqual(Array.from(w.api.SHELL_CRITICAL_PATHS).sort(), policy.CRITICAL_PATHS.slice().sort(), 'sw.js names the same critical files as updatePolicy.js');

    // which files a page names: hashed scripts and styles, relative paths rooted, gated paths left out
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.api.shellFileRefs(page(A, A)))), [
        { path: '/scripts/comp/desktopBoot.js', sha: A }, { path: '/scripts/app.js', sha: A }, { path: '/css/x.css', sha: C }
    ]);

    // an installed copy: /app v1 and its files
    const stat = await w.open('static');
    const kept = await w.open('shell');
    await stat.put('/scripts/comp/desktopBoot.js', row(A));
    await stat.put('/scripts/app.js', row(A));
    await stat.put('/css/x.css', row(C));
    assert.strictEqual(await w.api.keepShell('/app', shell(page(A, A))), true, 'a page whose files are all here is kept');
    assert.strictEqual(await (await kept.match('/app')).text(), page(A, A));

    // the server moves on: the new /app is only a candidate while its files are not here
    assert.strictEqual(await w.api.keepShell('/app', shell(page(B, B))), false, 'a newer page is not kept ahead of its files');
    assert.strictEqual(await (await kept.match('/app')).text(), page(A, A), 'the kept shell is still the one this cache can run');
    assert.ok(await kept.match('/app.next'), 'the newer page waits as the candidate');

    // a restart installs one file of the two and fails the other: nothing switches
    await stat.put('/scripts/app.js', row(B));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await w.api.commitShells())), { app: false, launch: false }, 'a partly installed update does not switch the shell');
    assert.strictEqual(await (await kept.match('/app')).text(), page(A, A), 'the previous shell stays after a failed install');

    // the rest lands: now the shell and its files switch together
    await stat.put('/scripts/comp/desktopBoot.js', row(B));
    assert.strictEqual((await w.api.commitShells()).app, true, 'the complete set switches the shell');
    assert.strictEqual(await (await kept.match('/app')).text(), page(B, B));
    assert.strictEqual(await kept.match('/app.next'), undefined, 'no candidate left');

    // the same page again is nothing new
    assert.strictEqual(await w.api.keepShell('/app', shell(page(B, B))), true);
    assert.strictEqual(await kept.match('/app.next'), undefined);

    // ---- a page file with no row anywhere, the server not answering ----
    w = world();
    const kept2 = await w.open('shell');
    await kept2.put('/app', shell(page(B, B)));
    let fetches = 0;
    w.ctx.fetch = (req, init) => new Promise((resolve, reject) => { fetches += 1; init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const waits = [];
    const event = { clientId: 'c1', waitUntil: (p) => waits.push(p) };
    const url = new URL(`http://x/scripts/comp/desktopBoot.js?sha=${B}`);
    const request = { url: url.href, headers: new Headers({ 'user-agent': 'Chromium DreamOS/0.2' }), destination: 'script' };
    let t0 = Date.now();
    let answer = await w.api.answerHashedAsset(event, request, url, url.href);
    await Promise.all(waits);
    assert.ok(Date.now() - t0 < 1500, 'the request gives up after its short limit instead of hanging');
    assert.strictEqual(fetches, 1);
    assert.strictEqual(answer.type, 'error', 'a network error, at once');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.posted)), [{ type: 'STATIC_FILE_MISSING', path: '/scripts/comp/desktopBoot.js', critical: true }]);
    assert.deepStrictEqual(w.navigated, ['/launch?repair=1'], 'a critical file missing sends the page to the repair start');
    assert.strictEqual(await kept2.match('/app'), undefined, 'the shell that named a file this cache lacks is dropped');
    // not again within minutes: the pages never bounce
    answer = await w.api.answerHashedAsset(event, request, url, url.href);
    await Promise.all(waits);
    assert.deepStrictEqual(w.navigated, ['/launch?repair=1']);

    // a file that is not critical only fails fast; nobody is sent anywhere
    const url2 = new URL(`http://x/scripts/comp/someFeature.js?sha=${B}`);
    await w.api.answerHashedAsset(event, { url: url2.href, headers: new Headers(), destination: 'script' }, url2, url2.href);
    await Promise.all(waits);
    assert.deepStrictEqual(w.navigated, ['/launch?repair=1']);
    assert.strictEqual(w.posted[w.posted.length - 1].critical, false);

    // the proxy's 502 is not the file
    w.ctx.fetch = async () => new Response('bad gateway', { status: 502 });
    assert.strictEqual((await w.api.answerHashedAsset(event, { url: url2.href, headers: new Headers(), destination: 'script' }, url2, url2.href)).type, 'error');
    // the server's answer is
    w.ctx.fetch = async () => new Response('ok', { status: 200 });
    assert.strictEqual((await w.api.answerHashedAsset(event, { url: url2.href, headers: new Headers(), destination: 'script' }, url2, url2.href)).status, 200);

    // ---- no row, but the version the page ran before is still held: it boots, no network ----
    w = world();
    const code = await w.open('code');
    await code.put(`http://x/scripts/comp/desktopBoot.js?sha=${A}`, row(A, 'previous'));
    w.ctx.fetch = () => { throw new Error('the network must not be asked'); };
    answer = await w.api.answerHashedAsset({ waitUntil: () => {} }, request, url, url.href);
    assert.strictEqual(await answer.text(), 'previous', 'the previous version answers');
    assert.deepStrictEqual(w.navigated, []);

    // the pages keep these in step with the worker
    const boot = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'launch', 'melatonBoot.js'), 'utf8');
    const launch = fs.readFileSync(path.join(__dirname, '..', 'public', 'launch.html'), 'utf8');
    assert.ok(/repair=1/.test(boot) && /repair=1/.test(launch), '/launch?repair=1 is not handed straight back to /app');
    assert.ok(!/\.put\((?:LAUNCH_SHELL_KEY|APP_SHELL_KEY),/.test(src.replace(fnSource('promoteShell'), '')), 'only promoteShell writes a kept shell');

    console.log('test-sw-shell-atomic: ok');
})().catch((err) => { console.error('test-sw-shell-atomic failed:', err); process.exit(1); });
