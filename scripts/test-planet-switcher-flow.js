#!/usr/bin/env node
// State-machine smoke test for public/scripts/comp/planetSwitcher.js on a tiny DOM stub.
// Covers: open (layers captured + animated), navigate/tween, cancel (restores origins, removes DOM),
// select -> load (workspaceSwitchComplete + workspaceChanged) -> zoom -> reveal, failure path, key swallowing.
// Run: node scripts/test-planet-switcher-flow.js
const assert = require('assert');

// ---------- DOM stub ----------
class ClassList {
    constructor() { this.set = new Set(); }
    add(...n) { n.forEach((x) => this.set.add(x)); }
    remove(...n) { n.forEach((x) => this.set.delete(x)); }
    contains(n) { return this.set.has(n); }
    toggle(n, force) { const on = force === undefined ? !this.set.has(n) : Boolean(force); if (on) this.set.add(n); else this.set.delete(n); return on; }
}
const animations = [];
class Anim {
    constructor(el, keyframes, opts) {
        this.el = el; this.keyframes = keyframes; this.opts = opts; this.cancelled = false; this.playbackRate = 1;
        this.finished = Promise.resolve(this);
        this.effect = { getTiming: () => ({ duration: opts.duration }) };
        animations.push(this);
    }
    cancel() { this.cancelled = true; }
    play() {}
}
class Style {
    constructor() { this.props = {}; }
    setProperty(k, v) { this.props[k] = v; }
}
let elementSeq = 0;
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase(); this.id = ''; this.className = ''; this.classList = new ClassList();
        this.style = new Style(); this.dataset = {}; this.children = []; this.parentNode = null; this.attributes = {};
        this.listeners = {}; this.tabIndex = 0; this.textContent = ''; this.innerHTML = ''; this.seq = ++elementSeq;
        this.offsetLeft = 0; this.offsetTop = 0; this.complete = false; this.naturalWidth = 0; this.rect = { left: 0, top: 0, width: 100, height: 100 };
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { if (n === this) return true; return this.children.some((c) => c.contains(n)); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter((f) => f !== fn); }
    dispatch(t, ev) { (this.listeners[t] || []).forEach((fn) => fn(ev)); }
    getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
    animate(k, o) { return new Anim(this, k, o); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
    setPointerCapture() {} releasePointerCapture() {}
    getContext() { return new Proxy({}, { get: (t, p) => (p === 'globalAlpha' ? 1 : () => {}), set: () => true }); }
    decode() { this.complete = true; this.naturalWidth = 512; return Promise.resolve(); }
    querySelector() { return null; }
    walk(fn) { fn(this); this.children.forEach((c) => c.walk(fn)); }
}
const registry = {};
const document = {
    body: new Element('body'),
    activeElement: null,
    hidden: false,
    listeners: {},
    createElement: (t) => new Element(t),
    getElementById: (id) => registry[id] || null,
    querySelectorAll: (sel) => {
        const out = [];
        document.body.walk((el) => {
            if (sel.includes('.modal') && el.classList.contains('modal')) out.push(el);
            if (sel.includes('#galleryWindow') && el.id === 'galleryWindow') out.push(el);
        });
        return out;
    },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter((f) => f !== fn); },
    dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
    contains(n) { return document.body.contains(n); }
};
document.activeElement = document.body;
let rafCb = null;
const windowListeners = {};
Object.assign(globalThis, {
    document,
    window: globalThis,
    innerWidth: 1600,
    innerHeight: 900,
    devicePixelRatio: 2,
    isDesktop: true,
    isWorkspaceSwitching: false,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ transform: 'none', opacity: '1', display: 'block', scale: 'none' }),
    requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
    addEventListener: (t, fn) => { (windowListeners[t] = windowListeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { if (windowListeners[t]) windowListeners[t] = windowListeners[t].filter((f) => f !== fn); },
    CustomEvent: globalThis.CustomEvent || class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    showGlassToast: (type, title, message) => { toasts.push({ type, title, message }); },
    setActiveWorkspace: async (id) => { activations.push(id); }
});
const toasts = [];
const activations = [];
globalThis.workspaces = {
    default: { id: 'default', name: 'Default', color: '#6366f1', sort: 0 },
    art: { id: 'art', name: 'Art', color: '#f97316', sort: 1, wallpaper: 'file:wall.png' },
    lab: { id: 'lab', name: 'Lab', color: '#22c55e', sort: 2 }
};
globalThis.activeWorkspace = 'default';
globalThis.wsClient = {
    isConnected: () => true,
    getWorkspacePreviewSamples: async () => ({ samples: { default: [{ base: 'a', preview: 'a.webp', blurhash: null }, { base: 'b', preview: 'b.webp' }], art: [], lab: [{ base: 'c' }] } })
};
globalThis.resolveWorkspaceWallpaperUrl = (w) => (w ? '/images/wall.png' : null);

function mount(id, cls) { const el = new Element('div'); el.id = id; if (cls) el.classList.add(cls); registry[id] = el; document.body.appendChild(el); return el; }
const wallpaper = mount('desktopWallpaper', 'desktop-wallpaper');
const icons = mount('desktopIcons', 'desktop-icons');
const taskbar = mount('desktopTaskbar', 'desktop-taskbar');
const gallery = mount('galleryWindow', 'gallery-window');
gallery.rect = { left: 200, top: 100, width: 800, height: 600 };
const studio = mount('manualModal', 'modal');
studio.rect = { left: 400, top: 150, width: 700, height: 500 };
const hiddenModal = mount('hiddenModal', 'modal'); hiddenModal.classList.add('hidden');
const minimised = mount('minModal', 'modal'); minimised.classList.add('minimised');

const { PLANET_SWITCHER_TIMING } = require('../public/scripts/comp/planetSwitcher.js');
const sw = globalThis.planetSwitcher;
assert.ok(sw, 'module exposes window.planetSwitcher');

const tick = () => new Promise((r) => setImmediate(r));
const pump = (t) => { const cb = rafCb; rafCb = null; if (cb) cb(t); };
const key = (k, extra = {}) => {
    const ev = { key: k, repeat: false, shiftKey: false, stopped: false, prevented: false, ...extra,
        stopImmediatePropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    (windowListeners.keydown || []).forEach((fn) => fn(ev));
    return ev;
};
let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`); }

(async () => {
    await test('open captures desktop + visible windows, animates scale/opacity only, pauses via body class', async () => {
        await sw.open();
        assert.strictEqual(sw.state, 'browsing');
        assert.ok(document.body.classList.contains('planet-switcher-active'));
        assert.strictEqual(sw.desktopLayer.length, 3);
        assert.deepStrictEqual(sw.windowLayer.map((r) => r.el.id).sort(), ['galleryWindow', 'manualModal']);
        // transform-origin at the viewport centre expressed in the element's box: studio at (400,150) -> (400, 300)
        assert.strictEqual(studio.style.transformOrigin, '400.00px 300.00px');
        assert.strictEqual(wallpaper.style.transformOrigin, '800.00px 450.00px');
        const props = new Set();
        sw.layerAnims.forEach((a) => Object.keys(a.keyframes[0]).forEach((p) => props.add(p)));
        assert.deepStrictEqual([...props].sort(), ['opacity', 'scale']);
        const wallAnims = animations.filter((a) => a.el === wallpaper);
        assert.deepStrictEqual(wallAnims.map((a) => a.opts.duration).sort((x, y) => x - y), [PLANET_SWITCHER_TIMING.desktopFade, PLANET_SWITCHER_TIMING.desktopScale]);
        const winAnims = animations.filter((a) => a.el === studio);
        assert.deepStrictEqual(winAnims.map((a) => a.opts.duration).sort((x, y) => x - y), [PLANET_SWITCHER_TIMING.windowsFade, PLANET_SWITCHER_TIMING.windowsScale]);
        assert.strictEqual(winAnims.find((a) => a.opts.duration === 2500).keyframes[1].scale, '0.75');
        assert.strictEqual(wallAnims.find((a) => a.opts.duration === 3000).keyframes[1].scale, '0.5');
        assert.strictEqual(sw.count, 3);
        assert.strictEqual(sw.index, 0, 'current workspace starts centred');
        assert.strictEqual(sw.planets[0].el.style.transform, 'translate3d(0.0px, 0.0px, 0) scale(1.000)');
    });

    await test('bubble samples: packet rows, wallpaper fallback, two img slots', async () => {
        await tick(); await tick();
        assert.strictEqual(sw.planets[0].images.length, 2);
        assert.strictEqual(sw.planets[0].images[0].url, '/previews/a.webp');
        assert.strictEqual(sw.planets[1].images[0].url, '/images/wall.png', 'empty sample list falls back to the wallpaper');
        assert.strictEqual(sw.planets[2].images[0].url, '/previews/c.webp');
        assert.strictEqual(sw.planets[0].imgs.length, 2);
    });

    await test('arrow keys rotate the ring and are swallowed; the tween centres the next planet', async () => {
        const ev = key('ArrowRight');
        assert.ok(ev.stopped && ev.prevented);
        assert.strictEqual(sw.index, 1);
        assert.ok(sw.tween);
        const t0 = sw.tween.start;
        pump(t0 + 100);
        assert.ok(sw.tween, 'still tweening');
        pump(t0 + PLANET_SWITCHER_TIMING.navigate + 1);
        assert.strictEqual(sw.tween, null);
        assert.strictEqual(sw.planets[1].el.style.transform, 'translate3d(0.0px, 0.0px, 0) scale(1.000)');
        assert.ok(sw.planets[1].el.classList.contains('is-focused'));
        key('ArrowLeft');
        pump(sw.tween.start + 1000);
        assert.strictEqual(sw.index, 0);
        key('End');
        pump(sw.tween.start + 1000);
        assert.strictEqual(sw.index, 2);
        const fkey = key('F5');
        assert.ok(!fkey.stopped, 'function keys pass through');
    });

    await test('Esc cancels: quick undo animations, DOM removed, origins restored, state idle', async () => {
        const before = animations.length;
        key('Escape');
        assert.strictEqual(sw.state, 'cancelling');
        const undo = animations.slice(before).filter((a) => a.el === studio);
        assert.strictEqual(undo.length, 2);
        assert.ok(undo.every((a) => a.opts.duration === PLANET_SWITCHER_TIMING.cancel));
        assert.strictEqual(undo.find((a) => 'scale' in a.keyframes[0]).keyframes[1].scale, '1');
        await tick(); await tick(); await tick();
        assert.strictEqual(sw.state, 'idle');
        assert.ok(!document.body.classList.contains('planet-switcher-active'));
        assert.strictEqual(document.body.children.find((c) => c.className === 'planet-switcher'), undefined);
        assert.strictEqual(document.body.children.find((c) => c.className === 'planet-switcher-backdrop'), undefined);
        assert.strictEqual(studio.style.transformOrigin, '');
        assert.ok(!(windowListeners.keydown || []).length, 'key listeners removed');
    });

    await test('select loads the workspace, then zooms into the bubble and reveals the desktop 80% -> 100%', async () => {
        await sw.open();
        assert.strictEqual(sw.state, 'browsing');
        const planet = sw.planets[2];
        planet.bubble.rect = { left: 700, top: 350, width: 200, height: 200 };
        const selecting = sw.select(2);
        assert.strictEqual(sw.state, 'selecting');
        assert.ok(sw.root.classList.contains('is-selecting'));
        assert.strictEqual(sw.stars.targetSpeed, 1.7, 'star field warps while loading');
        await tick();
        assert.deepStrictEqual(activations, ['lab']);
        sw.updateProgress({ percent: 42 });
        assert.strictEqual(planet.status.textContent, '42%');
        pump(sw.tween.start + 500);
        assert.ok(sw.selectU > 0 && sw.selectU < 1);
        pump(sw.tween.start + PLANET_SWITCHER_TIMING.select + 1);
        assert.strictEqual(sw.selectU, 1);
        assert.strictEqual(planet.el.style.transform, 'translate3d(0.0px, 0.0px, 0) scale(1.550)');
        assert.strictEqual(sw.planets[0].el.style.opacity, '0.000', 'other planets fade out');
        await tick();
        assert.strictEqual(sw.state, 'selecting', 'waits for the load events');
        globalThis.activeWorkspace = 'lab';
        document.dispatchEvent(new CustomEvent('workspaceChanged', { detail: { workspaceId: 'lab' } }));
        document.dispatchEvent(new CustomEvent('workspaceSwitchComplete', { detail: { workspaceId: 'lab' } }));
        await tick(); await tick();
        const zoom = animations.find((a) => a.el === planet.bubble && a.opts.duration === PLANET_SWITCHER_TIMING.zoomIn);
        assert.ok(zoom, 'bubble zoom animation');
        const expectedK = (Math.hypot(1600, 900) / 200) * 1.04;
        assert.strictEqual(zoom.keyframes[1].transform, `translateZ(0) scale(${expectedK.toFixed(3)})`);
        await selecting;
        assert.strictEqual(sw.state, 'idle');
        const reveal = animations.filter((a) => a.el === wallpaper && a.opts.duration === PLANET_SWITCHER_TIMING.reveal);
        assert.strictEqual(reveal.length, 2);
        assert.strictEqual(reveal.find((a) => 'scale' in a.keyframes[0]).keyframes[0].scale, '0.8');
        assert.strictEqual(reveal.find((a) => 'opacity' in a.keyframes[0]).keyframes[1].opacity, 1);
        assert.ok(!document.body.classList.contains('planet-switcher-active'));
        assert.strictEqual(wallpaper.style.transformOrigin, '');
    });

    await test('selecting the current planet is a plain cancel', async () => {
        await sw.open();
        assert.strictEqual(sw.index, 2, 'lab is now current and centred');
        await sw.select(2);
        assert.strictEqual(sw.state, 'cancelling');
        await tick(); await tick(); await tick();
        assert.strictEqual(sw.state, 'idle');
        assert.strictEqual(activations.length, 1, 'no second activation');
    });

    await test('a failed switch returns to browsing with a toast', async () => {
        await sw.open();
        const selecting = sw.select(0);
        await tick();
        pump(sw.tween.start + PLANET_SWITCHER_TIMING.select + 1);
        document.dispatchEvent(new CustomEvent('workspaceSwitchFailed', { detail: { workspaceId: 'default', error: 'nope' } }));
        await selecting;
        assert.strictEqual(sw.state, 'browsing');
        assert.ok(toasts.some((t) => t.type === 'error' && /nope/.test(t.message)));
        assert.strictEqual(sw.stars.targetSpeed, 0.05);
        key('Escape');
        await tick(); await tick(); await tick();
        assert.strictEqual(sw.state, 'idle');
    });

    await test('open refuses while a workspace switch is running or off the desktop', async () => {
        globalThis.isWorkspaceSwitching = true;
        await sw.open();
        assert.strictEqual(sw.state, 'idle');
        globalThis.isWorkspaceSwitching = false;
        document.body.classList.remove('desktop-mode');
        globalThis.isDesktop = false;
        await sw.open();
        assert.strictEqual(sw.state, 'idle');
        assert.ok(toasts.some((t) => /Desktop mode/.test(t.message)));
        globalThis.isDesktop = true;
    });

    console.log(`\n${passed} planet switcher flow tests passed`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
