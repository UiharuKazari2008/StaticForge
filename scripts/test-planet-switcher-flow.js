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
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter((f) => f !== fn); }
    dispatch(t, ev) { (this.listeners[t] || []).forEach((fn) => fn(ev)); }
    getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
    animate(k, o) { return new Anim(this, k, o); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = document.body; }
    setPointerCapture() {} releasePointerCapture() {}
    getContext() { if (!this._ctx) { const noop = () => {}; this._ctx = { _fill: '#6366f1', get fillStyle() { return this._fill; }, set fillStyle(v) { this._fill = typeof v === 'string' && v.startsWith('#') ? v : '#6366f1'; }, globalAlpha: 1, globalCompositeOperation: 'source-over', strokeStyle: '', lineWidth: 1, setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, drawImage: noop, save: noop, restore: noop, translate: noop, scale: noop, createRadialGradient: () => ({ addColorStop: noop }) }; } return this._ctx; }
    decode() { this.complete = true; if (!this.naturalWidth) this.naturalWidth = 512; return this.src && this.src.includes('broken') ? Promise.reject(new Error('broken')) : Promise.resolve(); }
    set src(v) { this._src = v; const img = this; setTimeout(() => { if (v && v.includes('broken')) { if (img.onerror) img.onerror(); } else { img.complete = true; img.naturalWidth = v.includes('planet-sheets') ? 576 : 512; img.naturalHeight = v.includes('planet-sheets') ? 192 : 512; if (img.onload) img.onload(); } }, 0); }
    get src() { return this._src || ''; }
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
let rafCbs = [];
const windowListeners = {};
Object.assign(globalThis, {
    Image: class extends Element { constructor() { super('img'); } },
    document,
    window: globalThis,
    innerWidth: 1600,
    innerHeight: 900,
    devicePixelRatio: 2,
    isDesktop: true,
    isWorkspaceSwitching: false,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ transform: 'none', opacity: '1', display: 'block', scale: 'none', getPropertyValue: () => '180px' }),
    requestAnimationFrame: (cb) => { rafCbs.push(cb); return rafCbs.length; },
    cancelAnimationFrame: () => { rafCbs = []; },
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
    getWorkspacePreviewSamples: async () => ({ samples: {
        default: { recent: [{ base: 'a', preview: 'a.webp', blurhash: null }, { base: 'b', preview: 'b.webp' }], favorites: [{ base: 'fav' }], slides: [{ base: 'fav' }, { base: 'a' }, { base: 'b' }], sheet: { url: '/planet-sheets/0123456789abcdef0123.webp', tile: 192, count: 3 }, imageCount: 321 },
        art: { recent: [], favorites: [], slides: [], sheet: null, imageCount: 0 },
        lab: [{ base: 'c' }, { base: 'broken' }, { base: 'd' }]
    } })
};
globalThis.desktopSounds = { play() { return Promise.resolve(false); } };
globalThis.resolveWorkspaceWallpaperUrl = (w) => (w ? '/images/wall.png' : null);
globalThis.formatWorkspaceProgressStatusText = (p) => (p && typeof p.blocksLeft === 'number' ? `Loading gallery (${p.blocksLeft} Blocks Left)` : '');
globalThis.shouldGalleryProgressUseDeterminate = (p) => Boolean(p && typeof p.progress === 'number' && p.phase !== 'hash_probe');

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

const { PLANET_SWITCHER_TIMING, planetSwitcherImageCache, planetSwitcherTileCache } = require('../public/scripts/comp/planetSwitcher.js');
const PLANET_SWITCHER_SLIDE_FADE_FOR_TEST = 1600;
const sw = globalThis.planetSwitcher;
assert.ok(sw, 'module exposes window.planetSwitcher');

const tick = () => new Promise((r) => setTimeout(r, 2));
const pump = (t) => { const list = rafCbs; rafCbs = []; list.forEach((cb) => cb(t)); };
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
        const winProps = new Set();
        sw.layerAnims.filter((a) => a.el === studio || a.el === gallery).forEach((a) => Object.keys(a.keyframes[0]).forEach((p) => winProps.add(p)));
        assert.deepStrictEqual([...winProps].sort(), ['opacity', 'scale'], 'windows: scale + opacity only, their transform is untouched');
        const deskProps = new Set();
        sw.layerAnims.filter((a) => a.el === wallpaper).forEach((a) => Object.keys(a.keyframes[0]).forEach((p) => deskProps.add(p)));
        assert.deepStrictEqual([...deskProps].sort(), ['opacity', 'scale', 'transform'], 'desktop layers add the perspective tilt');
        const wallAnims = animations.filter((a) => a.el === wallpaper);
        assert.deepStrictEqual(wallAnims.map((a) => a.opts.duration).sort((x, y) => x - y), [PLANET_SWITCHER_TIMING.desktopFade, PLANET_SWITCHER_TIMING.desktopScale, PLANET_SWITCHER_TIMING.desktopScale], 'fade, scale and tilt');
        const winAnims = animations.filter((a) => a.el === studio);
        assert.deepStrictEqual(winAnims.map((a) => a.opts.duration).sort((x, y) => x - y), [PLANET_SWITCHER_TIMING.windowsFade, PLANET_SWITCHER_TIMING.windowsScale]);
        assert.strictEqual(winAnims.find((a) => a.opts.duration === 2500).keyframes[1].scale, '0.75');
        assert.strictEqual(wallAnims.find((a) => a.opts.duration === 3000).keyframes[1].scale, '0.5');
        assert.strictEqual(sw.count, 3);
        assert.strictEqual(sw.index, 0, 'current workspace starts centred');
        assert.strictEqual(sw.planets[0].el.style.transform, `translate3d(0.0px, ${sw.radiusY.toFixed(1)}px, 0)`, 'planet layer only translates');
        assert.strictEqual(sw.planets[0].wrap.style.transform, 'scale(1.000)', 'depth scale sits on the bubble wrap');
        assert.ok(sw.planets[1].wrap.style.transform !== 'scale(1.000)' && sw.planets[1].labels.style.transform.startsWith('translate3d(0, -'), 'side planet labels move up to meet the smaller bubble');
        const tilt = animations.find((a) => a.el === wallpaper && a.keyframes[1].transform && a.keyframes[1].transform.includes('rotateX(-12deg)'));
        assert.ok(tilt && tilt.opts.duration === PLANET_SWITCHER_TIMING.desktopScale, 'desktop layers tilt back as they shrink');
        assert.ok(!animations.some((a) => a.el === studio && a.keyframes[0].transform), 'windows keep their own transform');
        assert.ok(sw.sun && sw.sun.parentNode === sw.ring, 'sun sits in the ring');
        assert.strictEqual(sw.sun.children.length, 5);
        assert.ok(sw.root.children.some((c) => c.className === 'planet-switcher-brand'), 'brand mark present');
        assert.strictEqual(sw.planets[0].count.textContent, '', 'no count until the list carries one');
    });

    await test('bubble samples: sprite sheet planet, canvas-tile fallback planet, wallpaper fallback, counts', async () => {
        for (let i = 0; i < 6; i++) await tick();
        const first = sw.planets[0];
        const lab = sw.planets[2];
        // sheet planet: one strip, slides by background-position, no tiles baked
        assert.ok(first.sheet && first.sheet.count === 3, 'sheet accepted');
        assert.strictEqual(first.images.length, 3, 'slide list mirrors the strip order');
        assert.strictEqual(first.images[0].url, '/previews/fav.webp');
        assert.strictEqual(first.count.textContent, '321 images');
        assert.strictEqual(first.slots.length, 2, 'two canvas slots, created at build time');
        assert.strictEqual(first.slots[0].tagName, 'CANVAS');
        assert.ok(first.sheetImg && first.sheetImg.src === '/planet-sheets/0123456789abcdef0123.webp', 'strip decoded by the image loader');
        assert.strictEqual(first.slots[0].dataset.frame, String(first.slideIndex), 'bottom slot holds the first strip frame');
        assert.ok(!planetSwitcherTileCache.get(planetSwitcherTileCache.key('/previews/fav.webp', first.color, sw.tileSize)), 'no tile baked for a sheet planet');
        pump(performance.now());
        assert.ok(first.shown);
        assert.strictEqual(first.slots[0].dataset.shown, '1', 'bottom slot revealed with a WAAPI fade');
        assert.ok(first.slots[0].planetFade && first.slots[0].planetFade.keyframes[1].opacity === 1);
        assert.ok(first.wobbleAnim && first.wobbleAnim.opts.iterations === Infinity, 'idle wobble runs on the compositor');
        assert.strictEqual(sw.planets.reduce((n, p) => n + p.slots.length, 0), 6, 'every planet got its two slots up front');
        assert.ok(first.reflect && first.reflect.tagName === 'CANVAS' && first.reflect.classList.contains('is-shown'), 'reflection canvas shown with the first slide');
        // swap 1: top slot painted with the next strip frame, then faded in a frame later; no z-index churn
        first.nextAt = 0;
        sw.tickSlides();
        assert.ok(first.swapping, 'strip slides need no baking');
        assert.ok(!first.slots[0].style.zIndex && !first.slots[1].style.zIndex, 'no z-index churn');
        const nextFrame = (first.slideIndex + 1) % 3;
        assert.strictEqual(first.slots[1].dataset.frame, String(nextFrame));
        assert.ok(!first.slots[1].planetFade, 'fade waits for the next frame');
        pump(performance.now());
        assert.strictEqual(first.slots[1].dataset.shown, '1', 'top fades in');
        assert.strictEqual(first.slots[0].dataset.shown, '1', 'bottom stays visible underneath during the fade');
        // swap 2 (after the fade): bottom repainted while covered, top fades out
        await new Promise((r) => setTimeout(r, PLANET_SWITCHER_SLIDE_FADE_FOR_TEST + 150));
        assert.ok(!first.swapping && first.topShown);
        const idxAfterFirst = first.slideIndex;
        first.nextAt = 0;
        sw.tickSlides();
        assert.strictEqual(first.slots[0].dataset.frame, String((idxAfterFirst + 1) % 3), 'covered bottom slot takes the next frame');
        pump(performance.now());
        assert.strictEqual(first.slots[1].dataset.shown, '0', 'top fades out to reveal it');
        // wallpaper fallback
        assert.strictEqual(sw.planets[1].images[0].url, '/images/wall.png', 'empty sample lists fall back to the wallpaper');
        assert.strictEqual(sw.planets[1].sheet, null);
        // legacy array sample: client-side canvas tiles, broken image dropped
        assert.strictEqual(lab.sheet, null);
        assert.strictEqual(lab.images.length, 2, 'broken image dropped from the list');
        assert.deepStrictEqual(lab.images.map((i) => i.url).sort(), ['/previews/c.webp', '/previews/d.webp']);
        assert.strictEqual(lab.slots.length, 2, 'two canvas slots');
        assert.strictEqual(lab.slots[0].tagName, 'CANVAS');
        assert.strictEqual(lab.sheetImg, null);
        assert.ok(!planetSwitcherImageCache.ready(lab.images[0].url, sw.tileSize), 'source released once its tile is baked');
        assert.ok(planetSwitcherTileCache.get(planetSwitcherTileCache.key(lab.images[0].url, lab.color, sw.tileSize)), 'first tile baked');
        assert.ok(lab.shown);
        // remaining tiles bake in idle slices; wait, then crossfade through the tiles
        await new Promise((r) => setTimeout(r, 90));
        lab.nextAt = 0;
        sw.tickSlides();
        assert.ok(lab.swapping, 'second tile baked in the idle slice');
        pump(performance.now());
        assert.strictEqual(lab.slots[1].dataset.shown, '1');
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
        sw.wobble = 0; sw.applyRing();
        assert.strictEqual(sw.planets[1].el.style.transform, `translate3d(0.0px, ${sw.radiusY.toFixed(1)}px, 0)`);
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
        sw.planets[2].el.dispatch('click', { stopPropagation() {} });
        assert.strictEqual(sw.state, 'browsing', 'first tap only centres the planet');
        assert.strictEqual(sw.index, 2);
        pump(sw.tween.start + 1000);
        const selecting = sw.select(2); // what the second tap calls
        assert.strictEqual(sw.state, 'selecting', 'second tap travels');
        assert.ok(sw.root.classList.contains('is-selecting'));
        assert.strictEqual(sw.stars.targetSpeed, 1.7, 'star field warps while loading');
        await tick();
        assert.deepStrictEqual(activations, [], 'no switch until the ring has settled');
        pump(sw.tween.start + 500);
        assert.ok(sw.selectU > 0 && sw.selectU < 1);
        pump(sw.tween.start + PLANET_SWITCHER_TIMING.select + 1);
        assert.strictEqual(sw.selectU, 1);
        sw.wobble = 0; sw.applyRing();
        assert.strictEqual(planet.el.style.transform, 'translate3d(0.0px, 0.0px, 0)');
        assert.strictEqual(planet.wrap.style.transform, 'scale(1.900)', 'focused bubble grows, labels stay unscaled');
        assert.strictEqual(sw.planets[0].el.style.opacity, '0.000', 'other planets fade out');
        const sunFade = animations.find((a) => a.el === sw.sun && a.keyframes[1].opacity === 0);
        assert.ok(sunFade && sunFade.keyframes[1].scale === '1.5', 'sun fades and grows away on the compositor');
        assert.ok(sw.planets.every((p) => !p.wobbleAnim), 'wobble stopped for the selection');
        await new Promise((r) => setTimeout(r, PLANET_SWITCHER_TIMING.settle + 30));
        assert.deepStrictEqual(activations, ['lab'], 'switch starts after the settle');
        assert.ok(planet.el.classList.contains('is-loading'));
        assert.ok(sw.root.classList.contains('is-loading-workspace'));
        sw.updateProgress({ phase: 'block_fetch', progress: 0.42, blocksLeft: 7 });
        assert.ok(/7 Blocks Left/.test(planet.status.textContent) || planet.status.textContent === '42%');
        assert.strictEqual(planet.progressFill.style.width, '42%');
        assert.ok(!planet.progress.classList.contains('marquee'));
        sw.updateProgress({ phase: 'hash_probe' });
        assert.ok(planet.progress.classList.contains('marquee'), 'indeterminate phases fall back to the marquee');
        await tick();
        assert.strictEqual(sw.state, 'selecting', 'waits for the load events');
        globalThis.activeWorkspace = 'lab';
        document.dispatchEvent(new CustomEvent('workspaceChanged', { detail: { workspaceId: 'lab' } }));
        document.dispatchEvent(new CustomEvent('workspaceSwitchComplete', { detail: { workspaceId: 'lab' } }));
        await tick(); await tick();
        const zoom = animations.find((a) => a.el === planet.bubble && a.opts.duration === PLANET_SWITCHER_TIMING.zoomIn);
        assert.ok(zoom, 'bubble zoom animation');
        const expectedK = (Math.hypot(1600, 900) / 200) * 1.3;
        assert.strictEqual(zoom.keyframes[1].transform, `translateZ(0) scale(${expectedK.toFixed(3)})`);
        await selecting;
        assert.strictEqual(sw.state, 'idle');
        const reveal = animations.filter((a) => a.el === wallpaper && a.opts.duration === PLANET_SWITCHER_TIMING.reveal);
        assert.strictEqual(reveal.length, 3, 'scale, tilt and fade');
        assert.strictEqual(reveal.find((a) => 'scale' in a.keyframes[0]).keyframes[0].scale, '0.8');
        assert.ok(reveal.find((a) => 'transform' in a.keyframes[0]).keyframes[1].transform.includes('rotateX(0deg)'), 'tilt returns to flat');
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

    await test('Esc during the selection tween pulls the planet back and cancels', async () => {
        await sw.open();
        const selecting = sw.select(0);
        await tick();
        pump(sw.tween.start + 300);
        key('Escape');
        assert.strictEqual(sw.state, 'cancelling');
        await selecting;
        await tick(); await tick(); await tick();
        assert.strictEqual(sw.state, 'idle');
        assert.strictEqual(activations.length, 1, 'no switch was started');
    });

    await test('a failed switch returns to browsing with a toast', async () => {
        await sw.open();
        const selecting = sw.select(0);
        await tick();
        pump(sw.tween.start + PLANET_SWITCHER_TIMING.select + 1);
        await new Promise((r) => setTimeout(r, PLANET_SWITCHER_TIMING.settle + 30));
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
