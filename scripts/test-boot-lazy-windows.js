#!/usr/bin/env node
/**
 * Three programs' windows leave the desktop's boot (Yozora #1001 item 1): Dovecote (dovecoteWindow.js +
 * dovecote.css), DreamOS Wi-Fi (dreamosWifi.js) and the desktop's Melaton Weather (wmWeather.js + wm-weather.css)
 * are featureLoader features, loaded on the first open. Checks:
 *   - app.html, read per shell as writeShellTags writes it: the desktop boot loads none of the window files, only the
 *     small parts (dovecote.js, dovecote-tray.css, dreamosWifiBoot.js, melatonWeatherOpener.js); the phone still
 *     loads wmWeather.js and wm-weather.css from the boot (Today, the 6.5 home screen, the status bar, offline)
 *   - the features name those files; Control Panel depends on dreamos_wifi; a moved stylesheet has its placeholder
 *   - every feature file is in the service worker's install (core package, not left out of a phone or a desktop set,
 *     not one of the server's excluded kinds), so a later open works offline
 *   - the stand-ins: each opener loads its feature first and then opens; the boot parts keep their state
 *     (Dovecote's doveUi stays null; DreamOS Wi-Fi remembers a known network, keeps the scan and hands both over)
 *   - featureLoader puts a moved stylesheet at its placeholder and, for stylesFirst, loads scripts after it
 * Does not start the server. Run: node scripts/test-boot-lazy-windows.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const appHtml = read('public/app.html');

// ---------- app.html per shell (public/app.html writeShellTags) ----------
function bootTags(shell) {
    const html = appHtml.replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<template data-shell="(desktop|mobile)">([\s\S]*?)<\/template>/g, (m, s, inner) => (s === shell ? inner : ''));
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => '/' + m[1].replace(/^\//, '').split('?')[0]);
    const sheets = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => '/' + m[1].replace(/^\//, '').split('?')[0]);
    const placeholders = [...html.matchAll(/<meta name="melaton-feature-css" content="([^"]+)">/g)].map((m) => m[1]);
    return { scripts, sheets, placeholders };
}
const desktop = bootTags('desktop');
const mobile = bootTags('mobile');

const WINDOW_FILES = {
    dovecote: { scripts: ['/scripts/comp/desktop-apps/dovecoteWindow.js'], styles: ['/css/desktop-apps/dovecote.css'] },
    dreamos_wifi: { scripts: ['/scripts/comp/dreamosWifi.js'], styles: [] },
    melaton_weather: { scripts: ['/scripts/comp/wmWeather.js'], styles: ['/css/wm-weather.css'] }
};
for (const [name, f] of Object.entries(WINDOW_FILES)) {
    f.scripts.forEach((s) => assert.ok(!desktop.scripts.includes(s), `the desktop boot does not load ${s} (${name})`));
    f.styles.forEach((s) => assert.ok(!desktop.sheets.includes(s), `the desktop boot does not link ${s} (${name})`));
    f.styles.forEach((s) => assert.ok(desktop.placeholders.includes(s), `${s} keeps its place in the desktop's cascade`));
}
['/scripts/comp/desktop-apps/dovecote.js', '/scripts/comp/dreamosWifiBoot.js', '/scripts/comp/melatonWeatherOpener.js', '/scripts/comp/wmLocation.js']
    .forEach((s) => assert.ok(desktop.scripts.includes(s), `the desktop boot loads ${s}`));
assert.ok(desktop.sheets.includes('/css/desktop-apps/dovecote-tray.css'), 'the tray, its flyout and New Mail are styled from the boot');
// the phone: Weather from the boot as before (Today, the 6.5 home screen, the status bar); the others as on the desktop
assert.ok(mobile.scripts.includes('/scripts/comp/wmWeather.js'), 'Melaton Mobile still loads wmWeather.js at boot');
assert.ok(mobile.sheets.includes('/css/wm-weather.css'), 'Melaton Mobile still links wm-weather.css at boot');
assert.ok(!mobile.scripts.includes('/scripts/comp/melatonWeatherOpener.js'), 'no stand-in on the phone');
assert.ok(mobile.scripts.includes('/scripts/comp/desktop-apps/dovecote.js') && !mobile.scripts.includes('/scripts/comp/desktop-apps/dovecoteWindow.js'), "the phone keeps Dovecote's pushes, not its windows");
assert.ok(mobile.scripts.includes('/scripts/comp/dreamosWifiBoot.js') && !mobile.scripts.includes('/scripts/comp/dreamosWifi.js'));
assert.ok(mobile.scripts.indexOf('/scripts/comp/wmLocation.js') < mobile.scripts.indexOf('/scripts/comp/wmWeather.js'), 'wmLocation.js before wmWeather.js');
// the stand-ins call featureLoader only when used; the Wi-Fi one follows the tray's providers from the boot
assert.ok(desktop.scripts.indexOf('/scripts/comp/trayProviders.js') < desktop.scripts.indexOf('/scripts/comp/dreamosWifiBoot.js'), 'the tray providers before the Wi-Fi stand-in');

// ---------- the features ----------
const flSrc = read('public/scripts/comp/featureLoader.js');
function featureManifest() {
    const start = flSrc.indexOf('const FEATURE_MANIFEST = {');
    const end = flSrc.indexOf('\n};\n', start);
    // (as plain JSON: arrays of another context fail deepStrictEqual)
    return JSON.parse(JSON.stringify(vm.runInNewContext('(' + flSrc.slice(start + 'const FEATURE_MANIFEST = '.length, end + 2) + ')')));
}
const M = featureManifest();
for (const [name, f] of Object.entries(WINDOW_FILES)) {
    assert.ok(M[name], `feature ${name}`);
    assert.deepStrictEqual((M[name].scripts || []).map((s) => '/' + s), f.scripts, `${name}: its scripts`);
    assert.deepStrictEqual((M[name].styles || []).map((s) => '/' + s), f.styles, `${name}: its styles`);
    assert.ok(!M[name].hot, `${name} loads as a plain script (its names are the page's, as before)`);
}
assert.ok(M.dovecote.stylesFirst && M.melaton_weather.stylesFirst, 'a window that was styled from the boot draws after its styles');
assert.ok(M.control_panel.depends.includes('dreamos_wifi'), "Control Panel's network pages and the tray flyout read the full dreamosWifi");

// ---------- precached: every file in the service worker's install, for desktops and phones ----------
const pk = require('../public/scripts/launch/assetPackages');
const webSrc = read('web_server.js');
const unrelated = eval(/const unrelatedFilePattern = (\/.*\/i);/.exec(webSrc)[1]); // eslint-disable-line no-eval
const onDemandPrefixes = [...webSrc.slice(webSrc.indexOf('const onDemandGameAsset')).split(';')[0].matchAll(/startsWith\('([^']+)'\)/g)].map((m) => m[1]);
assert.ok(onDemandPrefixes.length >= 2, 'the server\'s on-demand folders found');
const allFiles = [...new Set(Object.values(WINDOW_FILES).flatMap((f) => [...f.scripts, ...f.styles])
    .concat(['/scripts/comp/dreamosWifiBoot.js', '/scripts/comp/melatonWeatherOpener.js', '/css/desktop-apps/dovecote-tray.css']))];
for (const url of allFiles) {
    assert.ok(fs.existsSync(path.join(PUBLIC, url)), `${url} exists`);
    assert.ok(!unrelated.test(url) && !onDemandPrefixes.some((p) => url.startsWith(p)) && !url.split('/').some((p) => p.startsWith('.')), `${url} is not one the server leaves out`);
    assert.strictEqual(pk.packageOf(url), null, `${url} is in the core package (every client installs it)`);
    assert.strictEqual(pk.filterRows([{ url }], ['mobile']).length, 1, `${url} is in a phone's install`);
    assert.strictEqual(pk.filterRows([{ url }], []).length, 1, `${url} is in a desktop's install`);
}

// ---------- Dovecote: the boot part runs no window code; its openers name what dovecoteWindow.js hands back ----------
const doveSrc = read('public/scripts/comp/desktop-apps/dovecote.js');
const doveWinSrc = read('public/scripts/comp/desktop-apps/dovecoteWindow.js');
const forwarded = [...doveSrc.matchAll(/doveUi(?:Opener|IfLoaded|Run)\('([A-Za-z]+)'/g)].map((m) => m[1]);
const exported = (/doveUi = \{([\s\S]*?)\n {4}\};/.exec(doveWinSrc) || [])[1] || '';
assert.ok(forwarded.length >= 19, 'the openers and redraws are forwarded');
forwarded.forEach((n) => assert.ok(new RegExp(`\\b${n}\\b`).test(exported), `dovecoteWindow.js hands back ${n}`));
['openDesktopDovecote', 'doveOpenReaderWindow', 'doveOpenCompose', 'doveOpenComposeWindow'].forEach((n) => assert.ok(forwarded.includes(n), `${n} (other files call it) loads the windows first`));
['ensureDesktopDovecoteModal', 'doveBuildComposeWindow', 'doveBuildReaderWindow', 'doveRenderMessageList = function'].forEach((n) => assert.ok(!doveSrc.includes(`const ${n}`) && !doveSrc.includes(n + ' = function'), `${n} is not in the boot's part`));
['initializeDovecoteTray', 'doveRefreshTrayUnread', 'doveOnMailboxUpdated', 'doveApplyTrayBadge', 'DESKTOP_DOVECOTE_HUMAN_OWNER', 'doveBindMailboxPush', 'doveImapBind', 'dovePresentNewMail']
    .forEach((n) => assert.ok(new RegExp(`(const|let|function) ${n}\\b`).test(doveSrc), `${n} stays in the boot's part`));
assert.ok(/^\(function \(\) \{$/m.test(doveWinSrc) && doveWinSrc.trimEnd().endsWith('})();'), 'the windows file keeps its names to itself');

async function dovecoteOpeners() {
    const calls = [];
    const sandbox = {
        console, Promise, Map, Set, JSON, Object, Array, String, Number, Date, Math, Error,
        setTimeout, clearTimeout,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { getElementById: () => null, addEventListener() {}, dispatchEvent() {} },
        CustomEvent: function CustomEvent() {}
    };
    sandbox.window = sandbox;
    sandbox.featureLoader = {
        loadFeature(name) {
            calls.push(`load:${name}`);
            // what dovecoteWindow.js does when it has run
            vm.runInContext(`doveUi = { openDesktopDovecote: (...a) => (__log.push('open:' + a.join(',')), 'opened'), doveOpenComposeWindow: (o) => (__log.push('compose:' + o.subject), 'composed'), doveRenderFolderTree: () => __log.push('tree') };`, ctx);
            return Promise.resolve(true);
        }
    };
    sandbox.__log = calls;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(doveSrc, ctx, { filename: 'dovecote.js' });
    assert.strictEqual(vm.runInContext('doveUi', ctx), null, 'the boot loads no window code');
    assert.strictEqual(vm.runInContext('doveRenderFolderTree()', ctx), undefined, 'a redraw without the windows draws nothing');
    assert.deepStrictEqual(calls, [], '... and loads nothing');
    assert.strictEqual(await vm.runInContext("openDesktopDovecote('x')", ctx), 'opened', 'the Start menu, tray, Sidebar opener: loads, then opens');
    assert.deepStrictEqual(calls, ['load:dovecote', 'open:x']);
    // loaded: the call is the window's own, at once (no promise)
    assert.strictEqual(vm.runInContext("doveOpenComposeWindow({ subject: 'Capture' })", ctx), 'composed', "another program's Send To, once loaded");
    vm.runInContext('doveRenderFolderTree()', ctx);
    assert.deepStrictEqual(calls.slice(2), ['compose:Capture', 'tree']);
    assert.strictEqual(typeof vm.runInContext('window.dovecoteMailSettings.soundOn', ctx), 'function', 'Mail Options from the boot');
}

// ---------- Melaton Weather on the desktop ----------
async function weatherOpener() {
    const src = read('public/scripts/comp/melatonWeatherOpener.js');
    const calls = [];
    const make = (shell) => {
        const w = { uiShell: shell, Promise };
        w.featureLoader = {
            loadFeature(name) {
                calls.push(`load:${name}`);
                w.wmWeather = { openDesktop: () => { calls.push('openDesktop'); return 'shown'; }, showAlert: (a) => { calls.push(`alert:${a.id}`); }, open: () => calls.push('open') };
                return Promise.resolve(true);
            }
        };
        vm.runInNewContext(src, { window: w, globalThis: w });
        return w;
    };
    const phone = make('mobile');
    assert.strictEqual(phone.wmWeather, undefined, 'the phone has the program itself, no stand-in');
    const w = make('desktop');
    const stub = w.wmWeather;
    ['openDesktop', 'open', 'showAlert', 'showAlerts'].forEach((n) => assert.strictEqual(typeof stub[n], 'function', `wmWeather.${n} from the boot`));
    assert.deepStrictEqual(calls, [], 'nothing loads at boot');
    assert.strictEqual(await stub.openDesktop(), 'shown', 'the Start menu / Sidebar opener loads, then opens');
    assert.notStrictEqual(w.wmWeather, stub, 'the program replaced the stand-in');
    await stub.showAlert({ id: 'a1' });
    assert.deepStrictEqual(calls, ['load:melaton_weather', 'openDesktop', 'alert:a1'], 'a kept reference still reaches the program, loaded once');
}

// ---------- DreamOS Wi-Fi ----------
async function wifiBoot() {
    const src = read('public/scripts/comp/dreamosWifiBoot.js');
    const store = {};
    let netState = { wifi: { present: true, state: 'connected', radio: true, network: { name: 'Home', known: true, security: 'psk', autoConnect: true } } };
    const changeFns = [];
    const scanFns = [];
    const provider = { get: () => netState, onScan: (fn) => { scanFns.push(fn); return () => scanFns.splice(scanFns.indexOf(fn), 1); } };
    const calls = [];
    const w = {
        Promise, JSON, Date,
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
        melatonTray: { provider: () => provider, onChange: (area, fn) => { changeFns.push(fn); return () => changeFns.splice(changeFns.indexOf(fn), 1); } }
    };
    w.featureLoader = {
        loadFeature(name) {
            calls.push(`load:${name}`);
            // what dreamosWifi.js does as it loads: take the boot's view over, stop its follow, replace the object
            const boot = w.dreamosWifi._boot;
            calls.push(`took:${boot.connectedName()}:${boot.scanned().map((n) => n.name).join('+')}`);
            boot.retire();
            w.dreamosWifi = { openConnect: () => { calls.push('openConnect'); return 'win'; } };
            return Promise.resolve(true);
        }
    };
    vm.runInNewContext(src, { window: w, globalThis: w, Number, JSON, Date, Promise, Array, Object, String });
    const stub = w.dreamosWifi;
    assert.ok(stub.available(), 'available() from the boot');
    assert.strictEqual(stub.radioOff(), false);
    assert.strictEqual(stub.signalLevel(65), 4);
    assert.deepStrictEqual(JSON.parse(store['dreamos.wifi.saved']), [{ name: 'Home', security: 'psk', auto: true }], 'a known network is remembered from the boot, as before');
    scanFns.forEach((fn) => fn({ networks: [{ name: 'Cafe', known: true, security: 'open', autoConnect: false }, { name: 'Other' }] }));
    assert.strictEqual(JSON.parse(store['dreamos.wifi.saved']).length, 2, "a scan's known networks too");
    netState = { wifi: { present: true, state: 'off', radio: false } };
    changeFns.forEach((fn) => fn());
    assert.strictEqual(stub.radioOff(), true, 'the provider\'s pushes are followed');
    assert.strictEqual(stub._boot.connectedName(), '', 'and the connection with them');
    assert.deepStrictEqual(calls, [], 'nothing loads at boot');
    assert.strictEqual(await stub.openConnect(), 'win', 'Connect to a network loads the windows, then opens');
    assert.deepStrictEqual(calls, ['load:dreamos_wifi', 'took::Cafe+Other', 'openConnect']);
    assert.strictEqual(changeFns.length + scanFns.length, 0, 'the stand-in stops following once dreamosWifi.js has taken over');
    // dreamosWifi.js does take it over
    const full = read('public/scripts/comp/dreamosWifi.js');
    assert.ok(/root\.dreamosWifi\._boot/.test(full) && /boot\.scanned\(\)/.test(full) && /boot\.connectedSince\(\)/.test(full) && /if \(boot\) boot\.retire\(\);/.test(full), 'dreamosWifi.js takes the boot\'s view over');
}

// ---------- featureLoader: the placeholder, and styles first ----------
async function loaderStyles() {
    const head = [];
    const meta = { name: 'melaton-feature-css', getAttribute: (k) => (k === 'content' ? '/css/desktop-apps/dovecote.css' : k === 'name' ? 'melaton-feature-css' : null), after(el) { head.splice(head.indexOf(meta) + 1, 0, el); } };
    head.push({ tag: 'link', href: '/css/app.css' }, meta, { tag: 'link', href: '/css/desktop-apps/dovecote-tray.css' }, { tag: 'link', href: '/css/vista-taskbar.css' });
    const order = [];
    const document = {
        head: { appendChild: (el) => head.push(el) },
        body: { appendChild() {} },
        querySelectorAll: (sel) => (sel.startsWith('meta') ? [meta] : []),
        querySelector: () => null,
        addEventListener() {},
        createElement: (tag) => {
            const el = { tag, listeners: {}, sheet: null, addEventListener(t, fn) { this.listeners[t] = fn; } };
            // the stylesheet arrives a little later; the script waits for it
            setTimeout(() => { order.push(`styled:${el.href}`); el.sheet = {}; if (el.listeners.load) el.listeners.load(); }, 20);
            return el;
        },
        dispatchEvent() {}
    };
    const sandbox = { document, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Promise, URL, CustomEvent: function () {}, location: { href: 'http://x/app' }, navigator: { userAgent: '' }, performance: { now: () => 0 }, matchMedia: () => ({ matches: false }) };
    sandbox.window = sandbox;
    sandbox.addEventListener = () => {};
    const ctx = vm.createContext(sandbox);
    vm.runInContext(flSrc, ctx, { filename: 'featureLoader.js' });
    const loader = vm.runInContext('featureLoader', ctx);
    loader._loadScript = (s) => { order.push(`script:${s}`); return Promise.resolve(); };
    await loader.loadFeature('dovecote');
    const at = head.indexOf(meta);
    assert.strictEqual(head[at + 1].href, '/css/desktop-apps/dovecote.css', 'dovecote.css goes in at its placeholder');
    assert.strictEqual(head[at + 2].href, '/css/desktop-apps/dovecote-tray.css', 'before the sheets that came after it');
    assert.deepStrictEqual(order, ['styled:/css/desktop-apps/dovecote.css', 'script:scripts/comp/desktop-apps/dovecoteWindow.js'], 'its window code runs once its styles are in');
    order.length = 0;
    await loader.loadFeature('dreamos_wifi');
    assert.deepStrictEqual(order, ['script:scripts/comp/dreamosWifi.js']);
}

(async () => {
    await dovecoteOpeners();
    await weatherOpener();
    await wifiBoot();
    await loaderStyles();
    const kb = (urls) => Math.round(urls.reduce((n, u) => n + fs.statSync(path.join(PUBLIC, u)).size, 0) / 1024);
    const moved = Object.values(WINDOW_FILES).flatMap((f) => [...f.scripts, ...f.styles]);
    const added = ['/scripts/comp/dreamosWifiBoot.js', '/scripts/comp/melatonWeatherOpener.js', '/css/desktop-apps/dovecote-tray.css'];
    console.log(`test-boot-lazy-windows: ok (the desktop boot leaves ${kb(moved)} KB of window code and styles to the first open, adds ${kb(added)} KB of stand-ins)`);
})().catch((err) => { console.error(err); process.exit(1); });
