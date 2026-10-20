#!/usr/bin/env node
/**
 * Server pings (every few seconds) and other status refreshes must not rewrite identical values,
 * and looping animations off-screen must pause (Yukimi's Director-turn trace, 2026-10-16: a ping
 * made 52 no-op writes and a 238 ms style recalc; off-screen loops kept ~35 fps main-thread frames).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fnBody = (src, header) => {
    const i = src.indexOf(header);
    assert.ok(i >= 0, `missing ${header}`);
    return src.slice(i, src.indexOf('\n}\n', i));
};

// ---- domWrite helpers -------------------------------------------------------------------------
const h = new Function(read('public/scripts/utils/domWrite.js') + '\nreturn { setTextIfChanged, setClassNameIfChanged, setClassIfChanged, setAttrIfChanged, setStyleIfChanged };')();

let writes = 0;
function textEl(initial) {
    const text = { nodeType: 3, nextSibling: null, _d: initial, get data() { return this._d; }, set data(v) { writes++; this._d = v; } };
    const el = { firstChild: text, get textContent() { return text._d; }, set textContent(v) { writes++; text._d = v; this.replaced = true; } };
    return { el, text };
}
const t = textEl('63');
h.setTextIfChanged(t.el, 63);
assert.strictEqual(writes, 0, 'same text (number or string) writes nothing');
h.setTextIfChanged(t.el, 64);
assert.strictEqual(t.text.data, '64');
assert.ok(!t.el.replaced, 'a lone text node is edited in place, not replaced');
const empty = { firstChild: null, textContent: '', set _x(v) {} };
h.setTextIfChanged(empty, 'x');
assert.strictEqual(empty.textContent, 'x', 'no text child: falls back to textContent');
h.setTextIfChanged(null, 'x');

const cls = new Set(['a']);
const el = {
    className: 'a',
    classList: { contains: (c) => cls.has(c), toggle: (c, on) => { writes++; if (on) cls.add(c); else cls.delete(c); } },
    attrs: { title: 'T' },
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
    setAttribute(n, v) { writes++; this.attrs[n] = v; },
    style: { width: '10%' }
};
writes = 0;
h.setClassIfChanged(el, 'a', true);
h.setClassIfChanged(el, 'b', false);
h.setAttrIfChanged(el, 'title', 'T');
h.setClassNameIfChanged(el, 'a');
h.setStyleIfChanged(el, 'width', '10%');
assert.strictEqual(writes, 0, 'unchanged class / attribute / className / style write nothing');
h.setClassIfChanged(el, 'b', true);
h.setAttrIfChanged(el, 'title', 'U');
assert.strictEqual(writes, 2, 'real changes still write');

// ---- ping-path writers use them ---------------------------------------------------------------
const utilities = read('public/scripts/comp/utilities.js');
const genCount = fnBody(utilities, 'function updateManualGenCountDisplay() {');
assert.ok(genCount.includes('setTextIfChanged(genCountEl, count)') && !genCount.includes('.textContent ='), 'gen count writes only changes');
const genBtn = fnBody(utilities, 'function updateManualGenerateBtnState() {');
assert.ok(!genBtn.includes('.className =') && !genBtn.includes('classList.'), 'Generate button state writes only changes');
const balance = fnBody(read('public/scripts/comp/balanceDisplay.js'), 'function updateBalanceDisplay(balance) {');
assert.ok(!/\.textContent =|\.title =|className =|classList\./.test(balance), 'balance display writes only changes');
const usage = read('public/scripts/comp/usageToolManager.js');
for (const header of ['    sync() {', '    render() {', '    fillDataMgmtAccountUsage() {']) {
    const i = usage.indexOf(header); const body = usage.slice(i, usage.indexOf('\n    }\n', i));
    assert.ok(!/\.textContent =|\.style\.width =|\.title =/.test(body), `usageToolManager ${header.trim()} writes only changes`);
}
const wallet = read('public/scripts/comp/walletTray.js');
assert.ok(wallet.includes("if (icon.title !== title) icon.title = title;") && wallet.includes("if (icon.getAttribute('aria-label') !== title)"), 'wallet tray title / aria-label only on change');
const sidebar = read('public/scripts/comp/vistaSidebar.js');
assert.ok(/vsbZoneFormats\.get\(zone\)/.test(sidebar) && !/new Intl\.DateTimeFormat\('en-US', \{ timeZone: zone, hour/.test(sidebar.replace(/format = new Intl\.DateTimeFormat\('en-US', \{ timeZone: zone, hour/, '')), 'clock reuses one formatter per zone');
assert.ok(sidebar.includes('if (p.face.title !== title) p.face.title = title;'), 'clock title written once a minute, not every second');

const html = read('public/app.html');
const at = (s) => html.indexOf(s);
assert.ok(at('scripts/utils/domWrite.js') > 0 && at('scripts/utils/domWrite.js') < at('scripts/comp/toastManager.js'), 'domWrite.js loads before the app scripts');
assert.ok(at('scripts/utils/offscreenAnimationPause.js') > 0, 'offscreenAnimationPause.js is loaded');
assert.ok(read('public/css/hidden.css').includes('.offscreen-paused {\n    animation-play-state: paused !important;'), 'hidden.css pauses .offscreen-paused');

// ---- off-screen animation pause (stub DOM + IntersectionObserver) ------------------------------
const listeners = {};
let ioCallback = null; const observed = new Set();
function animEl(iterations) {
    const set = new Set();
    const node = {
        nodeType: 1, anims: [],
        classList: { contains: (c) => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); }, remove: (c) => set.delete(c) },
        getAnimations: () => node.anims
    };
    node.anims = iterations === null ? [] : [{ effect: { target: node, getTiming: () => ({ iterations }) } }];
    return node;
}
const rafQueue = [];
const sandbox = {
    document: { addEventListener: (type, fn) => { listeners[type] = fn; }, getAnimations: () => [] },
    IntersectionObserver: class { constructor(cb) { ioCallback = cb; } observe(el) { observed.add(el); } unobserve(el) { observed.delete(el); } },
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return 1; }
};
new Function('document', 'IntersectionObserver', 'requestAnimationFrame', read('public/scripts/utils/offscreenAnimationPause.js'))(
    sandbox.document, sandbox.IntersectionObserver, sandbox.requestAnimationFrame
);
function flushRaf() {
    const queued = rafQueue.splice(0);
    queued.forEach((fn) => fn());
}

const dot = animEl(Infinity);
const fade = animEl(1);
const named = animEl(Infinity);
listeners.animationstart({ target: dot });
listeners.animationstart({ target: fade });
listeners.animationstart({ target: named, animationName: 'fade-in' });
assert.ok(observed.has(dot) && !observed.has(fade), 'only looping animations are watched');
assert.ok(!observed.has(named), 'one-shot animation names are ignored');
ioCallback([{ target: dot, isIntersecting: false }]);
flushRaf();
assert.ok(dot.classList.contains('offscreen-paused'), 'off-screen loop is paused');
ioCallback([{ target: dot, isIntersecting: true }]);
flushRaf();
assert.ok(!dot.classList.contains('offscreen-paused'), 'back on screen it runs again');
ioCallback([{ target: dot, isIntersecting: false }]);
dot.anims = [];
listeners.animationcancel({ target: dot });
flushRaf();
assert.ok(!observed.has(dot) && !dot.classList.contains('offscreen-paused'), 'a cancelled loop (display: none) is unwatched and unflagged');

console.log('test-ping-dom-writes: ok');
