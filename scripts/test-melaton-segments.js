#!/usr/bin/env node
// Melaton segments + live package swap (Yozora #872), in a real Chromium with --expose-gc:
//  - a segment's top-level variables, globals, timers, observers, listeners, socket handlers,
//    registrations, object URLs and DOM are gone after unload, and the garbage collector takes it
//  - the same code loads again (no "already declared" errors)
//  - melatonApps swaps a running package for a new tree: instance ended with 'update', new code
//    started on the same launch spec, old segment reclaimed; onBeforeUpdate puts it off until exit
// Does not start the server. Run: node scripts/test-melaton-segments.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://seg.test';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SEGMENT_V1 = `
'use strict';
const BIG = new Array(200000).fill('x').join('');           // top-level const: must die with the scope
let ticks = 0;
function bump() { ticks++; }
window.segDemo = { version: 1, size: () => BIG.length, ticks: () => ticks };
setInterval(bump, 5);
setTimeout(bump, 60000);
requestAnimationFrame(bump);
const mo = new MutationObserver(bump); mo.observe(document.body, { childList: true });
document.addEventListener('segdemo', () => { window.__segEvents = (window.__segEvents || 0) + 1; });
(async () => { await null; window.addEventListener('segdemo-late', () => { window.__segLate = (window.__segLate || 0) + 1; }); })();
wsClient.on('demo_push', () => { window.__segWs = (window.__segWs || 0) + 1; });
programFaults.registerProgram('segDemoWin', { name: 'Demo' });
const pop = document.createElement('div'); pop.id = 'segDemoPopup'; document.body.appendChild(pop);
const tagged = document.createElement('div'); tagged.className = 'seg-owned'; document.documentElement.appendChild(tagged);
window.__segUrl = URL.createObjectURL(new Blob(['x']));
`;

const APP_V1 = `
(function (root) {
    const BIG = new Array(100000).fill('a').join('');
    root.melatonApps.define('demo', (app) => {
        root.__demoStarts = (root.__demoStarts || []).concat('v1');
        app.openWindow({ title: 'Demo v1' });
        app.onExit((why) => { root.__demoExits = (root.__demoExits || []).concat(why); });
        app.onBeforeUpdate(() => root.__demoBusy || null);
        root.__demoSize = BIG.length;
    });
})(window);
`;
const APP_V2 = APP_V1.replace(/v1/g, 'v2');

function harness() {
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
// the desktop pieces melatonApps / melatonSegments talk to
window.wsClient = {
    handlers: new Map(),
    on(t, fn, o) { if (!this.handlers.has(t)) this.handlers.set(t, []); this.handlers.get(t).push(fn); },
    off(t, fn) { const l = this.handlers.get(t) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    emit(t, msg) { (this.handlers.get(t) || []).slice().forEach((fn) => fn(msg)); },
    count(t) { return (this.handlers.get(t) || []).length; },
    tree: 'aaaaaaaaaaaa1111',
    sent: [],
    async sendMessage(type, data) {
        this.sent.push({ type, data });
        const pkg = { id: 'demo', title: 'Demo', version: '1', base: '/melaton-apps/demo/', styles: [],
            clientEntry: '/melaton-apps/demo/client/demo.js?v=' + this.tree.slice(0, 12), treeHash: this.tree, owns: [] };
        if (type === 'app_launch') return { instanceId: 'i' + this.sent.length, runner: null, server: false, package: pkg };
        if (type === 'app_describe') return { package: pkg };
        return {};
    }
};
// modalKeyboardRegistry.js puts its own addEventListener on document, bound to the native one
(function () { const nativeAdd = document.addEventListener.bind(document); document.addEventListener = function patchedDocumentAddEventListener(t, l, o) { return nativeAdd(t, l, o); }; })();
window.programFaults = { reg: new Map(), registerProgram(id, o) { this.reg.set(id, o); }, unregisterProgram(id) { return this.reg.delete(id); } };
window.openModal = (m) => m.classList.remove('hidden');
window.closeModal = (m) => { m.classList.add('hidden'); document.dispatchEvent(new CustomEvent('staticforge:modal-lifecycle', { detail: { type: 'closed', id: m.id } })); };
</script>
<script src="/scripts/comp/melatonSegments.js"></script>
<script src="/scripts/comp/melatonApps.js"></script>
</body></html>`;
}

/** puppeteer-core (PUPPETEER_CORE or ~/sf-ui-check) with /usr/bin/chromium, gc exposed. */
async function launchBrowser() {
    const candidates = [process.env.PUPPETEER_CORE, path.join(os.homedir(), 'sf-ui-check', 'node_modules', 'puppeteer-core')].filter(Boolean);
    for (const c of candidates) {
        let puppeteer;
        try { puppeteer = require(c); } catch (_) { continue; }
        return puppeteer.launch({
            executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
            headless: true,
            args: ['--no-sandbox', '--js-flags=--expose-gc']
        });
    }
    throw new Error('puppeteer-core not found (set PUPPETEER_CORE)');
}

/**
 * The runtime files as clients get them: minified with the compiler's terser options
 * (modules/runtimeAssetCompiler.js). Minifying changes closure scopes (single-use functions are
 * inlined), which is how a page-wide hook once kept the first segment alive; only the minified pass
 * caught it.
 */
async function minifiedSources() {
    const { minify } = require('terser');
    const out = {};
    for (const rel of ['/scripts/comp/melatonSegments.js', '/scripts/comp/melatonApps.js']) {
        const r = await minify(read(`public${rel}`), { compress: { warnings: true, passes: 2 }, mangle: true, format: { comments: false } });
        out[rel] = r.code;
    }
    return out;
}

async function main(served) {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    let appVersion = 1;
    page.on('pageerror', (e) => console.error('pageerror:', e.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = new URL(req.url());
        if (url.origin !== ORIGIN) return req.respond({ status: 404, body: '' });
        const js = (body) => req.respond({ status: 200, contentType: 'application/javascript', body });
        if (url.pathname === '/') return req.respond({ status: 200, contentType: 'text/html', body: harness() });
        // SEG_SOURCE: another melatonSegments.js (a mutation check of this test)
        if (url.pathname === '/scripts/comp/melatonSegments.js' && process.env.SEG_SOURCE) return js(fs.readFileSync(process.env.SEG_SOURCE, 'utf8'));
        if (served && served[url.pathname]) return js(served[url.pathname]);
        if (url.pathname.startsWith('/scripts/')) return js(read(`public${url.pathname}`));
        if (url.pathname === '/seg/demo.js') return js(SEGMENT_V1);
        if (url.pathname === '/melaton-apps/demo/client/demo.js') return js(appVersion === 1 ? APP_V1 : APP_V2.replace(/v2/g, `v${appVersion}`));
        return req.respond({ status: 404, body: '' });
    });
    await page.goto(`${ORIGIN}/`);

    const gcUntil = (key) => page.evaluate(async (k) => {
        for (let i = 0; i < 40; i++) {
            window.gc();
            await new Promise((r) => setTimeout(r, 50));
            const row = melatonSegments.report().filter((x) => x.key === k).pop();
            if (row && row.state === 'reclaimed') return 'reclaimed';
        }
        return melatonSegments.report().filter((x) => x.key === k).pop().state;
    }, key);

    // ---- a plain segment -------------------------------------------------------------------------
    const loaded = await page.evaluate(async () => {
        await melatonSegments.load({ key: 'demo', label: 'Demo', scripts: ['/seg/demo.js'], owns: ['.seg-owned'] });
        await new Promise((r) => setTimeout(r, 80));
        document.dispatchEvent(new Event('segdemo'));
        window.dispatchEvent(new Event('segdemo-late'));
        wsClient.emit('demo_push', {});
        return {
            version: window.segDemo && window.segDemo.version,
            ticks: window.segDemo.ticks(),
            events: window.__segEvents, late: window.__segLate, ws: window.__segWs,
            popup: !!document.getElementById('segDemoPopup'),
            program: programFaults.reg.has('segDemoWin'),
            bigLeaked: typeof BIG !== 'undefined',
            globals: melatonSegments.get('demo') && Array.from(melatonSegments.get('demo').globals)
        };
    });
    assert.strictEqual(loaded.version, 1, 'segment ran');
    assert.ok(loaded.ticks > 0, 'its interval ran');
    assert.strictEqual(loaded.events, 1, 'document listener added');
    assert.strictEqual(loaded.late, 1, 'listener added after an await');
    assert.strictEqual(loaded.ws, 1, 'socket handler added');
    assert.ok(loaded.popup && loaded.program, 'DOM and registration made');
    assert.strictEqual(loaded.bigLeaked, false, 'top-level const stays out of the page scope');
    assert.ok(loaded.globals.includes('segDemo'), 'global found by the diff');

    const after = await page.evaluate(async () => {
        const ticks = window.segDemo.ticks();
        const url = window.__segUrl;
        const released = melatonSegments.unload('demo', 'test');
        await new Promise((r) => setTimeout(r, 80));
        document.dispatchEvent(new Event('segdemo'));
        window.dispatchEvent(new Event('segdemo-late'));
        wsClient.emit('demo_push', {});
        let urlDead = false;
        try { await fetch(url); } catch (_) { urlDead = true; }
        return {
            released,
            segDemo: 'segDemo' in window,
            events: window.__segEvents, late: window.__segLate, ws: window.__segWs,
            popup: !!document.getElementById('segDemoPopup'),
            owned: !!document.querySelector('.seg-owned'),
            program: programFaults.reg.has('segDemoWin'),
            wsCount: wsClient.count('demo_push'),
            urlDead,
            ticksBefore: ticks
        };
    });
    assert.strictEqual(after.segDemo, false, 'global deleted');
    assert.strictEqual(after.events, 1, 'document listener removed');
    assert.strictEqual(after.late, 1, 'late listener removed');
    assert.strictEqual(after.ws, 1, 'socket handler removed');
    assert.strictEqual(after.wsCount, 0, 'socket handler list empty');
    assert.strictEqual(after.popup, false, 'appended <body> child removed');
    assert.strictEqual(after.owned, false, 'owns selector removed');
    assert.strictEqual(after.program, false, 'program registration undone');
    assert.strictEqual(after.urlDead, true, 'object URL revoked');
    assert.deepStrictEqual(after.released.kept, [], 'no global left behind');
    assert.ok(after.released.timers >= 2 && after.released.observers === 1, `timers/observers released: ${JSON.stringify(after.released)}`);
    assert.strictEqual(await gcUntil('demo'), 'reclaimed', 'garbage collector took the unloaded segment');

    const again = await page.evaluate(async () => {
        await melatonSegments.load({ key: 'demo', label: 'Demo', scripts: ['/seg/demo.js'], owns: ['.seg-owned'] });
        const v = window.segDemo && window.segDemo.size();
        melatonSegments.unload('demo', 'test');
        return v;
    });
    assert.strictEqual(again, 200000, 'the same code loads again (no redeclaration error)');

    // ---- a package swap ----------------------------------------------------------------------------
    const first = await page.evaluate(async () => {
        await melatonApps.launch({ packageId: 'demo', args: { mode: 'x' } });
        return { starts: window.__demoStarts, windows: document.querySelectorAll('.melaton-app-window:not(.hidden)').length };
    });
    assert.deepStrictEqual(first.starts, ['v1']);
    assert.strictEqual(first.windows, 1);

    // busy: the swap waits until the app ends
    appVersion = 2;
    const deferred = await page.evaluate(async () => {
        window.__demoBusy = 'recording';
        wsClient.tree = 'bbbbbbbbbbbb2222';
        return melatonApps.applyPackageUpdate('demo', { treeHash: wsClient.tree });
    });
    assert.deepStrictEqual(deferred, { deferred: 'recording' });

    const swapped = await page.evaluate(async () => {
        window.__demoBusy = null;
        return melatonApps.applyPackageUpdate('demo', { treeHash: wsClient.tree });
    });
    assert.strictEqual(swapped.swapped, true, JSON.stringify(swapped));
    assert.strictEqual(swapped.relaunched, 1, 'running launch started again');
    const state = await page.evaluate(() => ({
        starts: window.__demoStarts,
        exits: window.__demoExits,
        windows: Array.from(document.querySelectorAll('.melaton-app-window')).filter((w) => !w.classList.contains('hidden')).map((w) => w.textContent.trim()),
        running: melatonApps.running().length,
        spec: wsClient.sent.filter((m) => m.type === 'app_launch').map((m) => m.data.args && m.data.args.mode)
    }));
    assert.deepStrictEqual(state.starts, ['v1', 'v2'], 'new code started');
    assert.deepStrictEqual(state.exits, ['update'], 'old instance ended with update');
    assert.strictEqual(state.running, 1);
    assert.ok(state.windows.length === 1 && /v2/.test(state.windows[0]), `one v2 window: ${state.windows}`);
    assert.deepStrictEqual(state.spec, ['x', 'x'], 'relaunched with the same launch spec');
    const oldKeyId = await page.evaluate(() => melatonSegments.report().filter((r) => r.key === 'app:/melaton-apps/demo/' && r.state !== 'loaded').pop().id);
    const reclaimed = await page.evaluate(async (id) => {
        for (let i = 0; i < 40; i++) {
            window.gc();
            await new Promise((r) => setTimeout(r, 50));
            const row = melatonSegments.report().find((x) => x.id === id);
            if (row && row.state === 'reclaimed') return true;
        }
        return false;
    }, oldKeyId);
    assert.strictEqual(reclaimed, true, 'old package code reclaimed after the swap');

    // a deferred swap runs when the app ends
    appVersion = 3;
    const late = await page.evaluate(async () => {
        window.__demoBusy = 'unsaved';
        wsClient.tree = 'cccccccccccc3333';
        const r = await melatonApps.applyPackageUpdate('demo', { treeHash: wsClient.tree });
        window.__demoBusy = null;
        const win = document.querySelector('.melaton-app-window:not(.hidden)');
        closeModal(win);
        for (let i = 0; i < 40 && melatonApps.loadedPackages().length; i++) await new Promise((res) => setTimeout(res, 50));
        return { r, loaded: melatonApps.loadedPackages(), pending: melatonApps.pendingUpdates() };
    });
    assert.deepStrictEqual(late.r, { deferred: 'unsaved' });
    assert.deepStrictEqual(late.loaded, [], 'swap ran after the last window closed (nothing to relaunch)');
    assert.deepStrictEqual(late.pending, []);

    await browser.close();
}

(async () => {
    await main(null);
    console.log('melaton segments: source: all checks passed');
    await main(await minifiedSources());
    console.log('melaton segments: minified (as served): all checks passed');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
