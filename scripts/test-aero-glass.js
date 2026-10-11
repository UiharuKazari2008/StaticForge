#!/usr/bin/env node
// Unit + flow test for public/scripts/comp/aeroGlass.js on a tiny DOM stub.
// Covers: mode mapping (legacy disable-blur), CSS url / position parsing, cover geometry,
// per-window origin math, frosted build (blob publish, cover vars, revoke of the old blob),
// failure fallback, no-wallpaper fallback, cross-origin flag.
// Run: node scripts/test-aero-glass.js
const assert = require('assert');

// ---------- DOM stub ----------
class ClassList {
    constructor() { this.set = new Set(); }
    add(...n) { n.forEach((x) => this.set.add(x)); }
    remove(...n) { n.forEach((x) => this.set.delete(x)); }
    contains(n) { return this.set.has(n); }
    toggle(n, force) { const on = force === undefined ? !this.set.has(n) : Boolean(force); if (on) this.set.add(n); else this.set.delete(n); return on; }
}
class Style {
    constructor() { this.props = {}; }
    setProperty(k, v) { this.props[k] = v; }
    removeProperty(k) { delete this.props[k]; }
    getPropertyValue(k) { return this.props[k] || ''; }
}
const drawCalls = [];
class CanvasCtx {
    constructor() { this.filter = 'none'; this.imageSmoothingEnabled = false; this.imageSmoothingQuality = 'low'; }
    drawImage(...args) { drawCalls.push({ filter: this.filter, args }); }
}
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase(); this.classList = new ClassList(); this.style = new Style(); this.dataset = {};
        this.attributes = {}; this.listeners = {}; this.computedVars = {};
        this.rect = { left: 0, top: 0, width: 100, height: 100 };
        this.offsetLeft = 0; this.offsetTop = 0; this.offsetWidth = 0; this.offsetHeight = 0;
        if (tag === 'canvas') { this.width = 0; this.height = 0; this._ctx = new CanvasCtx(); }
    }
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; }
    getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
    getContext() { return this._ctx; }
    toBlob(cb, type, quality) { if (this._taint) throw new Error('SecurityError: tainted canvas'); cb({ type, quality, size: 1 }); }
}
const modals = [];
const document = {
    documentElement: new Element('html'),
    body: new Element('body'),
    createElement: (t) => new Element(t),
    querySelectorAll: (sel) => {
        assert.strictEqual(sel, '.modal:not(.hidden):not(.hidden-alt)');
        return modals.filter((m) => !m.classList.contains('hidden') && !m.classList.contains('hidden-alt'));
    },
    addEventListener(t, fn) { this.documentElement.addEventListener(t, fn); },
    dispatchEvent(ev) { return this.documentElement.dispatchEvent(ev); }
};
const storage = new Map();
const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear()
};
const window = {
    innerWidth: 1920, innerHeight: 1112, devicePixelRatio: 1,
    location: { href: 'http://localhost:9220/app', origin: 'http://localhost:9220' },
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
};
const imageTable = { '/images/wall.png': [3000, 2000], '/images/other.png': [1000, 1000], 'https://cdn.example/far.png': [800, 600] };
const createdImages = [];
class Image {
    constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; this.crossOrigin = null; createdImages.push(this); }
    set src(url) {
        this._src = url;
        const key = url.startsWith('http://localhost:9220') ? url.slice('http://localhost:9220'.length) : url;
        setTimeout(() => {
            const size = imageTable[key];
            if (!size) { this.onerror && this.onerror(new Error('404')); return; }
            [this.naturalWidth, this.naturalHeight] = size; this.complete = true; this.onload && this.onload();
        }, 0);
    }
    get src() { return this._src; }
}
const revoked = [];
let blobSeq = 0;
URL.createObjectURL = () => `blob:test-${++blobSeq}`;
URL.revokeObjectURL = (u) => revoked.push(u);
if (typeof global.CustomEvent !== 'function') {
    global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
}
global.document = document; global.window = window; global.localStorage = localStorage; global.Image = Image;
global.getComputedStyle = (el) => ({ getPropertyValue: (k) => el.computedVars[k] || el.style.getPropertyValue(k) || '' });

const api = require('../public/scripts/comp/aeroGlass.js');
const T = api._test;
T.config.revokeDelayMs = 5;
T.config.wallpaperRefreshDebounceMs = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.documentElement;
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

(async () => {
    // ---- pure helpers ----
    assert.strictEqual(T.parseCssUrl('url("/a b.png")'), '/a b.png');
    assert.strictEqual(T.parseCssUrl("url('/x.png')"), '/x.png');
    assert.strictEqual(T.parseCssUrl('url(/images/x%20y.png)'), '/images/x%20y.png');
    assert.strictEqual(T.parseCssUrl('none'), null);
    assert.strictEqual(T.parseCssUrl(''), null);
    assert.strictEqual(T.parseCssUrl(undefined), null);

    assert.deepStrictEqual(T.parseWallpaperPosition('center'), { x: 0.5, y: 0.5 });
    assert.deepStrictEqual(T.parseWallpaperPosition('center 26%'), { x: 0.5, y: 0.26 });
    assert.deepStrictEqual(T.parseWallpaperPosition('left top'), { x: 0, y: 0 });
    assert.deepStrictEqual(T.parseWallpaperPosition('top left'), { x: 0, y: 0 });
    assert.deepStrictEqual(T.parseWallpaperPosition('right'), { x: 1, y: 0.5 });
    assert.deepStrictEqual(T.parseWallpaperPosition('bottom'), { x: 0.5, y: 1 });
    assert.deepStrictEqual(T.parseWallpaperPosition('20% 80%'), { x: 0.2, y: 0.8 });
    assert.deepStrictEqual(T.parseWallpaperPosition('right bottom'), { x: 1, y: 1 });
    assert.deepStrictEqual(T.parseWallpaperPosition(''), { x: 0.5, y: 0.5 });
    assert.deepStrictEqual(T.parseWallpaperPosition('12px 4px'), { x: 0.5, y: 0.5 });

    let geo = T.computeCoverGeometry(1920, 1080, 1000, 1000, { x: 0.5, y: 0.5 });
    near(geo.width, 1777.78); near(geo.height, 1000); near(geo.x, -388.89); near(geo.y, 0);
    geo = T.computeCoverGeometry(1000, 2000, 1000, 1000, { x: 0, y: 1 });
    near(geo.width, 1000); near(geo.height, 2000); near(geo.x, 0); near(geo.y, -1000);
    assert.strictEqual(T.computeCoverGeometry(0, 10, 10, 10), null);
    assert.strictEqual(T.computeCoverGeometry(10, 10, 0, 10), null);

    const m = new Element('div');
    m.classList.add('modal');
    m.rect = { left: 100, top: 50, width: 300, height: 200 };
    m.offsetLeft = 500; m.offsetTop = 400; m.offsetWidth = 300; m.offsetHeight = 200;
    assert.deepStrictEqual(T.computeModalOrigin(m), { x: 100, y: 50 }, 'settled rect path');
    m.classList.add('opening');
    assert.deepStrictEqual(T.computeModalOrigin(m), { x: 350, y: 300 }, 'animating, centre-anchored');
    m.dataset.windowContentAnchor = 'top';
    assert.deepStrictEqual(T.computeModalOrigin(m), { x: 350, y: 400 }, 'animating, top-anchored');
    m.classList.add('modal-pixel-settled');
    assert.deepStrictEqual(T.computeModalOrigin(m), { x: 500, y: 400 }, 'animating, pixel-settled');
    m.classList.remove('opening', 'modal-pixel-settled'); delete m.dataset.windowContentAnchor;
    m.setAttribute('data-dragging', 'true');
    assert.deepStrictEqual(T.computeModalOrigin(m), { x: 350, y: 300 }, 'dragging uses layout boxes');
    m.removeAttribute('data-dragging');

    // ---- stored mode mapping ----
    assert.strictEqual(api.getMode(), 'live', 'default mode after init is live');
    assert.strictEqual(root.dataset.glass, 'live');
    storage.clear(); storage.set('disable-blur', 'true');
    assert.strictEqual(T.readStoredMode(), 'basic', 'legacy disable-blur maps to basic');
    storage.set('aero-glass-mode', 'frosted');
    assert.strictEqual(T.readStoredMode(), 'frosted', 'explicit mode wins over legacy key');
    storage.set('aero-glass-mode', 'bogus'); storage.set('disable-blur', 'false');
    assert.strictEqual(T.readStoredMode(), 'live');
    storage.clear();

    // ---- setMode / toggle ----
    let events = 0;
    document.addEventListener('aeroGlassModeChanged', () => { events += 1; });
    assert.strictEqual(api.setMode('basic'), 'basic');
    assert.strictEqual(root.dataset.glass, 'basic');
    assert.ok(root.classList.contains('disable-blur'), 'basic keeps html.disable-blur for older rules');
    assert.strictEqual(storage.get('aero-glass-mode'), 'basic');
    assert.strictEqual(storage.get('disable-blur'), 'true');
    assert.strictEqual(api.setMode('nonsense'), 'basic', 'unknown mode is ignored');
    assert.strictEqual(events, 1);
    assert.strictEqual(api.toggleBasic(), 'live', 'toggle leaves basic for the last glass mode (live since init)');
    assert.ok(!root.classList.contains('disable-blur'));
    assert.strictEqual(storage.get('disable-blur'), 'false');
    assert.strictEqual(events, 2);
    assert.strictEqual(api.setMode('frosted'), 'frosted');
    assert.strictEqual(api.setMode('basic'), 'basic');
    assert.strictEqual(api.toggleBasic(), 'frosted', 'last glass mode is remembered across basic');
    assert.strictEqual(events, 5);

    // ---- frosted build ----
    document.body.computedVars['--desktop-wallpaper'] = 'url(/images/wall.png)';
    document.body.computedVars['--desktop-wallpaper-position'] = 'center 26%';
    assert.strictEqual(await api.rebuildWallpaper(), true);
    assert.match(root.style.getPropertyValue('--aero-wallpaper'), /^url\("blob:test-\d+"\)$/);
    assert.strictEqual(root.style.getPropertyValue('--aero-vw'), '1920px');
    assert.strictEqual(root.style.getPropertyValue('--aero-vh'), '1112px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-w'), '1920px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-h'), '1280px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-x'), '0px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-y'), '-44px');
    const blurs = drawCalls.filter((c) => /blur\(\d+px\)/.test(c.filter)).map((c) => parseInt(c.filter.match(/blur\((\d+)px\)/)[1], 10));
    assert.strictEqual(blurs.length, 2, 'frame copy and lighter taskbar copy each get one blur pass');
    assert.ok(blurs[1] < blurs[0], 'taskbar copy is blurred less than the frame copy');
    assert.ok(drawCalls.filter((c) => c.filter === 'none').length >= 9, 'image plus clamped edges drawn before the blur pass');
    const firstBlob = root.style.getPropertyValue('--aero-wallpaper');
    const firstLight = root.style.getPropertyValue('--aero-wallpaper-light');
    assert.match(firstLight, /^url\("blob:test-\d+"\)$/);
    assert.notStrictEqual(firstLight, firstBlob);

    // same wallpaper again: no rebuild
    const tokenBefore = T.state.buildToken;
    assert.strictEqual(await T.ensureFrosted({ force: false }), true);
    assert.strictEqual(T.state.buildToken, tokenBefore, 'unchanged wallpaper does not rebuild');

    // ---- per-window sync ----
    modals.push(m);
    m.rect = { left: 321.4, top: 77, width: 300, height: 200 };
    assert.strictEqual(api.syncModal(m), true);
    assert.strictEqual(m.style.getPropertyValue('--aero-x'), '321px');
    assert.strictEqual(m.style.getPropertyValue('--aero-y'), '77px');
    window.devicePixelRatio = 2;
    m.rect.left = 10.3;
    api.syncModal(m);
    assert.strictEqual(m.style.getPropertyValue('--aero-x'), '10.5px', 'rounded to device pixels');
    window.devicePixelRatio = 1;
    m.classList.add('hidden');
    assert.strictEqual(api.syncModal(m), false, 'hidden windows are skipped');
    m.classList.remove('hidden');
    assert.strictEqual(api.syncAllModals(), 1);

    // ---- wallpaper change revokes the old blob after the swap ----
    document.body.computedVars['--desktop-wallpaper'] = 'url("/images/other.png")';
    document.body.computedVars['--desktop-wallpaper-position'] = 'center';
    assert.strictEqual(await api.rebuildWallpaper(), true);
    const secondBlob = root.style.getPropertyValue('--aero-wallpaper');
    assert.notStrictEqual(secondBlob, firstBlob);
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-w'), '1920px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-h'), '1920px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-y'), '-404px');
    await sleep(20);
    assert.ok(revoked.includes(firstBlob.slice(5, -2)), 'previous blob URL revoked');
    assert.ok(revoked.includes(firstLight.slice(5, -2)), 'previous light blob URL revoked');

    // ---- resize republishes cover vars ----
    window.innerWidth = 1000; window.innerHeight = 500;
    window.listeners.resize.forEach((fn) => fn());
    await sleep(T.config.resizeDebounceMs + 20);
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-w'), '1000px');
    assert.strictEqual(root.style.getPropertyValue('--aero-cover-y'), '-250px');

    // ---- failure: missing image falls back to tinted frames ----
    document.body.computedVars['--desktop-wallpaper'] = 'url(/images/bad.png)';
    assert.strictEqual(await api.rebuildWallpaper(), false);
    assert.strictEqual(root.style.getPropertyValue('--aero-wallpaper'), '');
    assert.strictEqual(root.style.getPropertyValue('--aero-wallpaper-light'), '');
    assert.strictEqual(T.state.failedUrl, 'http://localhost:9220/images/bad.png');
    const tokenAfterFail = T.state.buildToken;
    assert.strictEqual(await T.ensureFrosted({ force: false }), false);
    assert.strictEqual(T.state.buildToken, tokenAfterFail, 'a failed wallpaper is not retried without force');

    // ---- cross-origin: anonymous request, taint falls back ----
    document.body.computedVars['--desktop-wallpaper'] = 'url(https://cdn.example/far.png)';
    assert.strictEqual(await api.rebuildWallpaper(), true);
    const far = createdImages.find((i) => i.src === 'https://cdn.example/far.png');
    assert.strictEqual(far.crossOrigin, 'anonymous');

    // ---- no wallpaper: var removed, mode stays frosted ----
    delete document.body.computedVars['--desktop-wallpaper'];
    assert.strictEqual(await api.rebuildWallpaper(), false);
    assert.strictEqual(root.style.getPropertyValue('--aero-wallpaper'), '');
    assert.strictEqual(api.getMode(), 'frosted');

    // ---- live mode does not touch windows ----
    api.setMode('live');
    m.style.removeProperty('--aero-x');
    assert.strictEqual(api.syncModal(m), false);
    assert.strictEqual(m.style.getPropertyValue('--aero-x'), '');

    console.log('✅ test-aero-glass: all assertions passed');
})().catch((err) => {
    console.error('❌ test-aero-glass failed:', err);
    process.exit(1);
});
