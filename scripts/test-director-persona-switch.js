'use strict';
// #1319 finding 3: changing persona must not flicker the mascot. The stage keeps the persona on it until the
// next one is ready (pictures decoded, shader body built OFF the stage with its first sheet uploaded), then
// swaps in one synchronous block. directorMascot.js runs in a vm with a fake DOM, a WebGL stub (every
// context is counted and every loseContext is counted), an Image whose decode() the test can hold, and a
// fetch that serves the real manifests. After EVERY microtask the stage is checked: it has a body (a canvas
// on the shader slot, or a picture layer with a source). Also: the old shader body is freed exactly once, a
// switch that is replaced while it builds leaks no WebGL context, the last request wins, and the chat's
// messages that came during the build are read against the persona that lands.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'public/static_images/director-mascots');

// ---------------------------------------------------------------- fake DOM
let tick = 0;
const log = [];            // every mutation: { tick, el, op, detail }
const note = (el, op, detail) => log.push({ tick, el: el.label, op, detail });
let nextId = 1;

function styleOf() {
    const vars = new Map();
    return { setProperty(k, v) { vars.set(k, String(v)); }, getPropertyValue: (k) => vars.get(k) || '', removeProperty(k) { vars.delete(k); } };
}

class El {
    constructor(tag, label) {
        this.tag = String(tag).toUpperCase();
        this.label = label || `${tag}#${nextId++}`;
        this.children = [];
        this.parent = null;
        this.attrs = new Map();
        this.classes = new Set();
        this.style = styleOf();
        this.dataset = {};
        this._q = new Map();
        this._text = '';
        this.width = 0;
        this.height = 0;
        this.isDocRoot = false;
        const self = this;
        this.classList = {
            add: (...c) => c.forEach((x) => self.classes.add(x)),
            remove: (...c) => c.forEach((x) => self.classes.delete(x)),
            toggle: (c, force) => { const on = force === undefined ? !self.classes.has(c) : !!force; if (on) self.classes.add(c); else self.classes.delete(c); return on; },
            contains: (c) => self.classes.has(c)
        };
    }

    get className() { return [...this.classes].join(' '); }
    set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); note(this, 'text', this._text); }
    set innerHTML(v) { this._html = v; }
    get isConnected() { let e = this; while (e) { if (e.isDocRoot) return true; e = e.parent; } return false; }
    get clientWidth() { return this.tag === 'CANVAS' && this.isConnected ? 300 : 0; }
    get clientHeight() { return this.tag === 'CANVAS' && this.isConnected ? 400 : 0; }
    get offsetWidth() { return 0; }
    get offsetHeight() { return 0; }
    get hidden() { return false; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); note(this, 'attr', `${k}=${v}`); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { if (this.attrs.delete(k)) note(this, 'unattr', k); }
    appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); note(this, 'append', c.label); return c; }
    after() {}
    remove() {
        if (!this.parent) return;
        const at = this.parent.children.indexOf(this);
        if (at >= 0) this.parent.children.splice(at, 1);
        note(this.parent, 'remove', this.label);
        this.parent = null;
    }
    replaceChildren(...nodes) {
        this.children.forEach((c) => { c.parent = null; });
        this.children = [];
        nodes.forEach((c) => { if (c.parent) c.remove(); c.parent = this; this.children.push(c); });
        note(this, 'replace', nodes.map((n) => n.label).join(','));
    }
    querySelector(sel) {
        if (!this._q.has(sel)) { const c = new El('div', sel); c.parent = this; this._q.set(sel, c); }
        return this._q.get(sel);
    }
    querySelectorAll() { return []; }
    closest() { return null; }
    addEventListener() {}
    removeEventListener() {}
    getBoundingClientRect() { return { top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 }; }
    getContext(type) {
        if (type !== 'webgl') return null;
        const rec = { live: this.className === 'dm-gl', lost: 0, canvas: this, draws: 0 };
        contexts.push(rec);
        const known = {
            getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => { rec.lost += 1; } } : null),
            getShaderPrecisionFormat: () => ({ precision: 23 }),
            getParameter: () => 8192,
            getShaderParameter: () => true,
            getProgramParameter: () => true,
            drawArrays: () => { rec.draws += 1; }
        };
        return new Proxy({}, {
            get: (t, p) => {
                if (p in known) return known[p];
                if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return 1;
                return () => ({});
            }
        });
    }
}

// ---------------------------------------------------------------- the world the module runs in
const contexts = [];
const frames = [];
const gate = { hold: false, waiters: [], wait() { return this.hold ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }, open() { this.hold = false; this.waiters.splice(0).forEach((r) => r()); } };
const world = { reduceMotion: false, failSheet: null, hosted: true };
const manifestCache = {};
const observers = [];
class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    observe(el) { this.targets.push(el); }
    disconnect() { this.targets = []; }
}

function makeSandbox() {
    const doc = {
        hidden: false,
        documentElement: { dataset: {} },
        createElement: (tag) => new El(tag),
        getElementById: () => null,
        addEventListener() {}
    };
    class FakeImage {
        constructor() { this.attrs = {}; }
        set src(v) { this._src = v; }
        get src() { return this._src; }
        decode() { return gate.wait(); }
    }
    const win = {
        matchMedia: () => ({ matches: world.reduceMotion }),
        addEventListener() {},
        uiShell: 'desktop'
    };
    const sandbox = {
        module: { exports: {} },
        document: doc,
        window: win,
        Image: FakeImage,
        localStorage: { getItem: () => null, setItem() {} },
        performance: { now: () => Date.now() },
        devicePixelRatio: 1,
        getComputedStyle: () => ({ marginTop: '10px', marginBottom: '0px' }),
        requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
        cancelAnimationFrame() {},
        // no real timers: nothing may keep the process alive, and nothing here advances by itself
        setTimeout: () => 1,
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        ResizeObserver: FakeResizeObserver,
        createImageBitmap: async () => ({ close() {} }),
        fetch: async (url) => {
            if (/manifest\.json$/.test(url)) {
                const persona = url.split('/').slice(-2)[0];
                const text = manifestCache[persona] || (manifestCache[persona] = fs.readFileSync(path.join(ROOT, persona, 'manifest.json'), 'utf8'));
                return { ok: true, json: async () => JSON.parse(text) };
            }
            if (world.failSheet && url.includes(world.failSheet)) return { ok: false, status: 404 };
            return { ok: true, blob: async () => ({}) };
        },
        console
    };
    sandbox.window.document = doc;
    return sandbox;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/directorMascot.js'), 'utf8');
const sandbox = makeSandbox();
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'directorMascot.js' });
const { DirectorMascot } = sandbox.module.exports;
assert.ok(DirectorMascot, 'the module loads in the vm');

function makeHost() {
    const host = new El('div', 'host');
    host.isDocRoot = true;
    host.querySelector = (sel) => (sel === '#directorComposer' ? null : El.prototype.querySelector.call(host, sel));
    return host;
}

function newMascot() {
    contexts.length = 0;          // each case counts its own WebGL contexts
    const m = new DirectorMascot({ isHosted: () => world.hosted });
    m.mount(makeHost());
    return m;
}

// ---------------------------------------------------------------- the stage, measured
const slotCanvases = (m) => m.el.glSlot.children.filter((c) => c.tag === 'CANVAS' && c.isConnected);
const bodySrc = (m) => m.el.body.getAttribute('src');
// a shader canvas shows her only once a frame of her sheet was drawn into it (drawn: the sheet's url)
const drawnCanvas = (m) => slotCanvases(m).filter((c) => m.glBody && m.glBody.canvas === c && m.glBody.drawn).length;
const boundaries = [];
let checking = null;
function checkpoint(m, label) {
    // a frame may come between any two microtasks: its animation callbacks run, then it is painted
    frames.splice(0).forEach((fn) => fn());
    tick += 1;
    const snap = { tick, label, canvas: drawnCanvas(m), img: !!bodySrc(m), persona: m.persona };
    boundaries.push(snap);
    if (checking) assert.ok(snap.canvas > 0 || snap.img, `the stage is empty after ${label} (tick ${tick}, persona ${m.persona}, canvases ${slotCanvases(m).length})`);
    assert.ok(slotCanvases(m).length <= 1, `two shader bodies on the stage after ${label}`);
}

// run the microtask queue one step at a time, checking the stage after each
async function drive(m, promise, each) {
    let done = false;
    promise.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 600 && !done; i++) {
        await Promise.resolve();
        checkpoint(m, `microtask ${i}`);
        if (each) each(i);
    }
    assert.ok(done, 'the switch settles');
    checkpoint(m, 'settled');
}

// the very first show has nothing to hold: its stage is empty until her first sheet is drawn (as before)
async function firstShow(m, persona) {
    await drive(m, m.setPersona(persona));
    for (let i = 0; i < 200 && !(m.glBody ? m.glBody.drawn : bodySrc(m)); i++) { await Promise.resolve(); checkpoint(m, 'first frame'); }
    assert.ok(m.glBody ? m.glBody.drawn : bodySrc(m), 'her first frame is drawn');
}

const liveOpen = () => contexts.filter((c) => c.live && c.lost === 0);
const liveAll = () => contexts.filter((c) => c.live);

function settled(m, label) {
    assert.ok(contexts.every((c) => c.lost <= 1), `${label}: no context is freed twice`);
    if (m.glBody) {
        assert.strictEqual(liveOpen().length, 1, `${label}: exactly one open WebGL context (the one on stage)`);
        assert.strictEqual(liveOpen()[0].canvas, m.glBody.canvas, `${label}: it is the one on stage`);
        assert.strictEqual(slotCanvases(m).length, 1);
        assert.strictEqual(m.el.glSlot.children[0], m.glBody.canvas);
    } else {
        assert.strictEqual(liveOpen().length, 0, `${label}: no shader body, no open context`);
        assert.strictEqual(slotCanvases(m).length, 0);
    }
    assert.ok(!m._build, `${label}: no build is left`);
    assert.ok(!m._switchKey);
}

const NAMES = {};
['wren', 'kabuki', 'xi'].forEach((p) => { NAMES[p] = JSON.parse(fs.readFileSync(path.join(ROOT, p, 'manifest.json'), 'utf8')).name; });

(async () => {
    // ------------------------------------------------------------ 1. the shader body, wren -> kabuki -> xi -> wren
    {
        const m = newMascot();
        await firstShow(m, 'wren');          // the very first show: nothing to hold, behaves as before
        assert.strictEqual(m.persona, 'wren');
        assert.ok(m.glOn(), 'first show builds her shader body');
        assert.strictEqual(m.el.name.textContent, NAMES.wren);
        assert.strictEqual(slotCanvases(m).length, 1);
        settled(m, 'first show');
        checking = m;
        const steps = [['kabuki'], ['xi'], ['wren']];
        for (const [next] of steps) {
            const before = { persona: m.persona, canvas: slotCanvases(m)[0], ctx: liveOpen()[0], name: m.el.name.textContent };
            const logFrom = log.length;
            let swappedAt = -1;
            await drive(m, m.setPersona(next), (i) => {
                if (m.persona === before.persona) {
                    // still building: the old persona is on stage, her body is untouched and not freed
                    assert.strictEqual(slotCanvases(m)[0], before.canvas, `${next}: the old body stays until the swap`);
                    assert.strictEqual(before.ctx.lost, 0, `${next}: the old context is not freed before the swap`);
                    assert.strictEqual(m.el.name.textContent, before.name);
                    assert.strictEqual(m.manifest.name, before.name);
                } else if (swappedAt < 0) {
                    swappedAt = tick;
                    assert.strictEqual(m.persona, next);
                    assert.strictEqual(m.manifest.name, NAMES[next]);
                    assert.strictEqual(m.el.name.textContent, NAMES[next], `${next}: her name changes with her body`);
                    assert.notStrictEqual(slotCanvases(m)[0], before.canvas, `${next}: a new body on stage`);
                    assert.strictEqual(before.ctx.lost, 1, `${next}: the old context is freed exactly once, at the swap`);
                    assert.ok(liveOpen()[0].draws > 0, `${next}: the first frame is drawn in the swap's own step`);
                    // her head is hers at once, and no old picture is left to fade over her as a ghost
                    assert.ok(m.el.headImg.getAttribute('src').includes(`/${next}/`), `${next}: her head comes with her body`);
                    assert.strictEqual(m.el.headPrev.getAttribute('src'), null, `${next}: no old head fades over her`);
                    assert.strictEqual(m.el.facePrev.getAttribute('src'), null);
                    assert.ok(m.el.face.getAttribute('src').includes(`/${next}/`), `${next}: her face comes with her body`);
                }
            });
            assert.ok(swappedAt > 0, `${next}: it swapped`);
            // every stage-changing mutation of the swap happened in the same tick (one synchronous block)
            const mine = log.slice(logFrom).filter((e) => (e.el === '.dm-gl-slot' && e.op === 'replace') || (e.el === '.dm-name' && e.op === 'text'));
            assert.ok(mine.length >= 2, `${next}: the body and the name both changed`);
            assert.strictEqual(new Set(mine.map((e) => e.tick)).size, 1, `${next}: the body and the name change in one step`);
            assert.strictEqual(m.persona, next);
            assert.strictEqual(before.ctx.lost, 1);
            settled(m, `to ${next}`);
        }
        assert.strictEqual(liveAll().length, 4, 'one body per persona shown, none more');
        assert.strictEqual(liveAll().filter((c) => c.lost === 1).length, 3);
        checking = null;
    }

    // ------------------------------------------------------------ 2. a decode that is slow: the old body holds
    {
        const m = newMascot();
        await firstShow(m, 'wren');
        checking = m;
        const oldCanvas = slotCanvases(m)[0];
        gate.hold = true;
        const p = m.setPersona('kabuki');
        for (let i = 0; i < 60; i++) { await Promise.resolve(); checkpoint(m, `held ${i}`); }
        assert.strictEqual(m.persona, 'wren', 'still her while the next one decodes');
        assert.strictEqual(slotCanvases(m)[0], oldCanvas);
        // the body building off the stage holds her sheet but draws nothing and runs no loop of its own
        const building = liveOpen().filter((c) => c.canvas !== oldCanvas);
        assert.strictEqual(building.length, 1, 'the next body exists, off the stage');
        assert.ok(!building[0].canvas.isConnected, 'and is not on the stage');
        assert.strictEqual(building[0].draws, 0, 'the off-stage body draws no frame');
        frames.splice(0).forEach((fn) => fn());
        frames.splice(0).forEach((fn) => fn());
        assert.ok(m._build && m._build.gl && !m._build.gl._raf, 'it queued one frame at most and no loop: nothing is waiting on it now');
        assert.strictEqual(building[0].draws, 0, 'still nothing drawn');
        gate.open();
        await drive(m, p);
        assert.strictEqual(m.persona, 'kabuki');
        settled(m, 'slow decode');
        checking = null;
    }

    // ------------------------------------------------------------ 3. the pictures (no WebGL: reduced motion)
    {
        world.reduceMotion = true;
        const m = newMascot();
        await firstShow(m, 'wren');
        assert.ok(!m.glOn());
        assert.ok(bodySrc(m), 'her picture layer is on');
        checking = m;
        const oldSrc = bodySrc(m);
        gate.hold = true;
        const p = m.setPersona('xi');
        for (let i = 0; i < 60; i++) { await Promise.resolve(); checkpoint(m, `held ${i}`); assert.strictEqual(bodySrc(m), oldSrc, 'her picture stays while the next decodes'); }
        gate.open();
        await drive(m, p);
        assert.strictEqual(m.persona, 'xi');
        assert.notStrictEqual(bodySrc(m), oldSrc);
        assert.ok(bodySrc(m).includes('/xi/'));
        assert.strictEqual(m.el.bodyPrev.getAttribute('src'), null, 'the old body does not fade over her (another size)');
        assert.strictEqual(m.el.headPrev.getAttribute('src'), null);
        assert.ok(m.el.headImg.getAttribute('src').includes('/xi/'), 'her head came with her body');
        assert.ok(m.el.face.getAttribute('src').includes('/xi/'));
        assert.strictEqual(contexts.length, 0, 'no WebGL context for the pictures');
        settled(m, 'pictures');
        checking = null;
        world.reduceMotion = false;
    }

    // ------------------------------------------------------------ 4. the next persona's sheet will not load: back to the pictures
    {
        const m = newMascot();
        await firstShow(m, 'wren');
        assert.ok(m.glOn());
        checking = m;
        const old = liveOpen()[0];
        const before = contexts.length;
        world.failSheet = '/kabuki/';
        await drive(m, m.setPersona('kabuki'));
        world.failSheet = null;
        assert.strictEqual(m.persona, 'kabuki');
        assert.strictEqual(old.lost, 1, 'the old body is freed once');
        assert.ok(contexts.length > before, 'a body was built for her');
        assert.ok(!m.glOn(), 'back to pictures');
        assert.ok(bodySrc(m).includes('/kabuki/'));
        assert.strictEqual(m._glOff, true, 'for good this session, as ensureGL does');
        settled(m, 'failed sheet');
        checking = null;
        m._glOff = false;
    }

    // ------------------------------------------------------------ 5. a second switch while the first builds: nothing leaks
    // the second request is made after i microtasks, for every i from before the manifest arrives to after the swap
    for (let i = 0; i <= 45; i++) {
        const m = newMascot();
        await firstShow(m, 'wren');
        checking = m;
        const first = m.setPersona('kabuki');
        for (let k = 0; k < i; k++) await Promise.resolve();
        checkpoint(m, `before the second request (${i})`);
        const second = m.setPersona('xi');
        await drive(m, Promise.all([first, second]));
        assert.strictEqual(m.persona, 'xi', `the last request wins (${i})`);
        assert.strictEqual(m.manifest.name, NAMES.xi);
        assert.strictEqual(m.el.name.textContent, NAMES.xi);
        settled(m, `double switch after ${i} microtasks`);
        // every context that is not on the stage was freed, and once
        contexts.filter((c) => c.live && c.canvas !== m.glBody.canvas).forEach((c) => assert.strictEqual(c.lost, 1, 'a build that lost the race is freed'));
        checking = null;
    }

    // ------------------------------------------------------------ 6. back to the persona on stage while another builds
    for (let i = 0; i <= 30; i += 3) {
        const m = newMascot();
        await firstShow(m, 'wren');
        checking = m;
        const canvas = slotCanvases(m)[0];
        const away = m.setPersona('kabuki');
        for (let k = 0; k < i; k++) await Promise.resolve();
        // the build may already have landed by now: then this is a real switch back, not a cancel
        const landed = m.persona !== 'wren';
        const back = m.setPersona('wren');
        await drive(m, Promise.all([away, back]));
        assert.strictEqual(m.persona, 'wren', `it ends on her (${i})`);
        if (!landed) assert.strictEqual(slotCanvases(m)[0], canvas, `her body was never touched (${i})`);
        else assert.notStrictEqual(slotCanvases(m)[0], canvas, 'a real switch back builds her again');
        settled(m, `back to the same after ${i}`);
        assert.strictEqual(liveOpen().length, 1, 'the abandoned build is freed');
        checking = null;
    }

    // ------------------------------------------------------------ 7. nothing to hold (the stage is hidden): the plain swap, no body made
    {
        world.hosted = false;
        const m = newMascot();
        const before = contexts.length;
        await drive(m, m.setPersona('wren'));
        await drive(m, m.setPersona('kabuki'));
        assert.strictEqual(m.persona, 'kabuki');
        assert.strictEqual(m.manifest.name, NAMES.kabuki);
        assert.strictEqual(contexts.length, before, 'a hidden stage builds no WebGL body');
        assert.strictEqual(m.glBody, null);
        world.hosted = true;
    }

    // ------------------------------------------------------------ 8. the chat's messages that came during the build
    {
        const card = (scores) => ({ role: 'assistant', data: { report: { summary: 's', card: { items: scores.map((score, i) => ({ item: `i${i}`, score })) } } } });
        const perfect = Array.from({ length: 10 }, () => card(['hit', 'hit', 'hit', 'hit']));
        const m = newMascot();
        await firstShow(m, 'wren');
        checking = m;
        gate.hold = true;
        const p = m.setPersona('kabuki');
        for (let i = 0; i < 20; i++) await Promise.resolve();
        m.onMessages(perfect);                         // her chat lands while she is still building
        assert.strictEqual(m.growthPoints, 0, 'the old persona is not graded with her chat');
        assert.strictEqual(m.debugState().stage, 'base');
        gate.open();
        await drive(m, p);
        assert.strictEqual(m.persona, 'kabuki');
        assert.strictEqual(m.growthPoints, 20, 'her chat is read against her manifest once she lands');
        assert.strictEqual(m.debugState().stage, 'bigger');
        checking = null;
    }

    // ------------------------------------------------------------ 9. (#1319 finding 5) the reply box is watched by the mascot's own observer
    {
        const m = newMascot();
        const ro = observers[observers.length - 1];
        assert.ok(ro.targets.includes(m.el.result), 'the reply box is observed (it shows, hides and grows)');
        const calls = [];
        m.layout = () => calls.push('layout');
        m.refitLog = () => calls.push('refit');
        ro.cb([{ target: m.el.result }]);
        assert.deepStrictEqual(calls, ['refit'], 'the box alone only refits the log');
        ro.cb([{ target: m.el.result }, { target: m.host }]);
        ro.cb([{ target: m.host }]);
        assert.deepStrictEqual(calls, ['refit', 'layout', 'layout'], 'anything else lays her out');
    }

    console.log(`test-director-persona-switch: ok (${boundaries.length} checkpoints)`);
})().catch((err) => { console.error(err); process.exit(1); });
