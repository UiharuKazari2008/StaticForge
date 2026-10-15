#!/usr/bin/env node
/**
 * Root state flags (public/scripts/comp/rootStateFlags.js) replace html/body-anchored :has() rules.
 * 1. No stylesheet may anchor a :has() on html/body again. `html:has(x) .y` makes Chrome recompute style
 *    for the whole page on every DOM insertion or text write (~45-50 ms each); `body:has(x) { }` ~4 ms.
 * 2. The flag script keeps each class equal to its old :has() argument, and only re-checks on
 *    mutations that can change it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ---- 1. CSS guard ---------------------------------------------------------------------------

function splitTop(s, chars) {
    const out = [];
    let depth = 0;
    let cur = '';
    let quote = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quote) {
            cur += c;
            if (c === quote && s[i - 1] !== '\\') quote = null;
            continue;
        }
        if (c === '"' || c === "'") { quote = c; cur += c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        if (depth === 0 && chars.includes(c)) { out.push(cur); cur = ''; continue; }
        cur += c;
    }
    out.push(cur);
    return out;
}

function rootAnchoredHas(selector) {
    const norm = selector.trim().replace(/\s*([>+~])\s*/g, ' ').replace(/\s+/g, ' ');
    const compounds = splitTop(norm, ' ').filter(Boolean);
    return compounds.some((compound) => /^(html|body|:root)\b/.test(compound) && compound.includes(':has('));
}

function cssFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...cssFiles(full));
        else if (entry.name.endsWith('.css')) out.push(full);
    }
    return out;
}

const offenders = [];
for (const file of cssFiles(path.join(root, 'public/css'))) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const preludes = css.match(/[^{}]+(?=\{)/g) || [];
    for (const prelude of preludes) {
        if (!prelude.includes(':has(') || prelude.trim().startsWith('@')) continue;
        for (const sel of splitTop(prelude, ',')) {
            if (rootAnchoredHas(sel)) offenders.push(`${path.relative(root, file)}: ${sel.trim()}`);
        }
    }
}
assert.deepStrictEqual(offenders, [], `html/body-anchored :has() (use a rootStateFlags.js class):\n${offenders.join('\n')}`);
assert.ok(rootAnchoredHas('html:has(.modal.modal-maximized).titlebar-windows #x .y'), 'guard catches html:has(...) .x');
assert.ok(rootAnchoredHas('body.desktop-mode:is(.a, :has(#b .c)) .d'), 'guard catches body:is(:has()) .x');
assert.ok(rootAnchoredHas('html:has(body.desktop-mode)'), 'guard catches subject :has() on html too (~4 ms per DOM change)');
assert.ok(!rootAnchoredHas('body.desktop-mode .modal:has(.x) .y'), 'a :has() anchored below body is not this guard');

const appCss = read('public/css/app.css');
const shellCss = read('public/css/desktop-shell.css');
const aeroCss = read('public/css/aero-glass.css');
assert.ok(appCss.includes('html.has-maximized-window.window-controls-overlay #titlebar-grab-area-container'), 'WCO caption band reads the maximized flag');
assert.ok(appCss.includes('html.has-maximized-gallery-window.titlebar-windows #titlebar-grab-area-container .menu-bar-left-gutter'), 'gallery gutters read the gallery flag');
assert.ok(appCss.includes('html.has-maximized-photo-window.titlebar-android #titlebar-grab-area-container #menu-bar-controls-right-gutter'), 'photo window gutters read the photo flag');
assert.ok(shellCss.includes('body.desktop-mode.taskbar-orb .desktop-taskbar'), 'the Orb taskbar reads body.taskbar-orb');
assert.ok(shellCss.includes('body.desktop-mode:not(.use-app-image-icons):not(.taskbar-orb) .taskbar-window-item i'), 'Luna keeps the <i> icon');
assert.ok(shellCss.includes('body.desktop-mode.taskbar-orb {') && shellCss.indexOf('body.desktop-mode.taskbar-orb {') < shellCss.indexOf('body.desktop-mode.taskbar-luna {'), 'Orb then Luna taskbar sizes, in the old order');
for (const f of ['public/css/gallery-move.css', 'public/css/manual-modal-generate.css']) {
    assert.ok(read(f).includes('html.has-desktop-mode {'), `${f} reads html.has-desktop-mode`);
}
assert.ok(aeroCss.includes('body.desktop-mode.has-active-maximized-window .desktop-taskbar::after'), 'the taskbar follows the active maximized window');

const glass = read('public/css/vista-glass-controls.css');
const globe = ['.net-limited #modemTrayIconGlyph', '.net-send #modemTrayIconGlyph', '.net-recv #modemTrayIconGlyph'].map((s) => glass.indexOf(s));
assert.ok(globe.every((i) => i > 0) && globe[0] < globe[1] && globe[1] < globe[2], 'globe: limited, then send, then receive (receive wins, limited loses, as with the old specificities)');
for (const f of ['public/css/app.css', 'public/css/gallery-core.css', 'public/css/gallery-move.css', 'public/css/manual-modal-generate.css', 'public/css/aero-glass.css', 'public/css/vista-glass-controls.css']) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!css.includes(':has(.gallery-item.context-open)'), `${f}: gallery context-open reads .has-context-open-item`);
    assert.ok(!/\.desktop-taskbar:has\(/.test(css), `${f}: no .desktop-taskbar:has()`);
}
assert.ok(read('public/css/gallery-move.css').includes('.modal:not(#manualModal):has(> .gallery-move-modal-content) {'), 'gallery-move window rule is child-only');
assert.ok(!read('public/css/gallery-move.css').includes('.modal:not(#manualModal):has(.gallery-move-modal-content) .gallery-move-modal-content {'), 'gallery-move content rule has no :has()');

const html = read('public/app.html');
const flagsTag = html.indexOf('<script src="scripts/comp/rootStateFlags.js"></script>');
assert.ok(flagsTag > 0 && flagsTag < html.indexOf('<script src="scripts/comp/modalUtils.js"></script>'), 'rootStateFlags.js loads before modalUtils.js');

// ---- 2. Flag script behaviour (DOM stub) ----------------------------------------------------

function classList(initial = '') {
    const set = new Set(initial.split(/\s+/).filter(Boolean));
    return {
        set,
        contains: (c) => set.has(c),
        toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; }
    };
}

const matches = new Set();
const htmlEl = { classList: classList() };
const bodyEl = { nodeType: 1, classList: classList('desktop-mode') };
let observerCallback = null;
let observeOptions = null;
let queries = 0;

// container hosts: each answers querySelector from its own set
function hostEl(className) {
    const inside = new Set();
    return { nodeType: 1, inside, classList: classList(className), querySelector: (sel) => { queries++; return inside.has(sel) ? {} : null; } };
}
const galleryEl = hostEl('gallery');
const wrapperEl = hostEl('gallery-container-wrapper');
const taskbarEl = hostEl('desktop-taskbar');
const hosts = {
    '.gallery, .gallery-container-wrapper': [galleryEl, wrapperEl],
    '.desktop-taskbar': [taskbarEl]
};

const sandbox = {
    window: {},
    document: {
        documentElement: htmlEl,
        body: bodyEl,
        querySelector: (sel) => { queries++; return matches.has(sel) ? {} : null; },
        querySelectorAll: (sel) => hosts[sel] || [],
        addEventListener: () => {}
    },
    MutationObserver: class {
        constructor(cb) { observerCallback = cb; }
        observe(target, opts) { assert.strictEqual(target, bodyEl); observeOptions = opts; }
    }
};
new Function('window', 'document', 'MutationObserver', read('public/scripts/comp/rootStateFlags.js'))(
    sandbox.window, sandbox.document, sandbox.MutationObserver);

assert.strictEqual(typeof sandbox.window.syncRootStateFlags, 'function', 'syncRootStateFlags is exposed');
assert.ok(observerCallback && observeOptions.subtree && observeOptions.childList && observeOptions.attributeOldValue, 'observes the body subtree');
assert.deepStrictEqual(observeOptions.attributeFilter, ['class'], 'only class attributes');
assert.ok(!htmlEl.classList.contains('has-maximized-window') && !bodyEl.classList.contains('taskbar-orb'), 'flags start off');

const MAX = '.modal.modal-maximized:not(.hidden):not(.hidden-alt)';
const ACTIVE_MAX = '.modal.modal-maximized.active-window:not(.hidden):not(.hidden-alt):not(.minimised)';
const ORB = '#desktopTaskbar .taskbar-start-button.orb';

const modalEl = { nodeType: 1, getAttribute: () => 'modal modal-maximized active-window' };
matches.add(MAX); matches.add(ACTIVE_MAX);
observerCallback([{ type: 'attributes', target: modalEl, oldValue: 'modal' }]);
assert.ok(htmlEl.classList.contains('has-maximized-window'), 'maximizing a window sets html.has-maximized-window');
assert.ok(bodyEl.classList.contains('has-active-maximized-window'), 'and body.has-active-maximized-window');

// a modal losing its .modal class still re-checks (oldValue)
const formerModal = { nodeType: 1, getAttribute: () => 'something-else' };
matches.clear();
observerCallback([{ type: 'attributes', target: formerModal, oldValue: 'modal modal-maximized' }]);
assert.ok(!htmlEl.classList.contains('has-maximized-window'), 'a class change that drops .modal clears the flag');

// unrelated mutations (Director text, arrow flashes) do not query
const before = queries;
const span = { nodeType: 1, matches: () => false, querySelector: () => null };
observerCallback([
    { type: 'childList', addedNodes: [{ nodeType: 3 }], removedNodes: [{ nodeType: 3 }] },
    { type: 'childList', addedNodes: [span], removedNodes: [] },
    { type: 'attributes', target: { nodeType: 1, getAttribute: () => 'ws-arrow active' }, oldValue: 'ws-arrow' }
]);
assert.strictEqual(queries, before, 'irrelevant mutations skip the re-check');

// a taskbar subtree arriving with the Orb button sets the flag
const taskbar = { nodeType: 1, matches: () => false, querySelector: (s) => (s.includes('.taskbar-start-button') ? {} : null) };
matches.add(ORB);
observerCallback([{ type: 'childList', addedNodes: [taskbar], removedNodes: [] }]);
assert.ok(bodyEl.classList.contains('taskbar-orb'), 'Orb start button sets body.taskbar-orb');

// body class changes re-check (photo flag depends on body.desktop-mode)
matches.clear();
observerCallback([{ type: 'attributes', target: bodyEl, oldValue: 'desktop-mode' }]);
assert.ok(!bodyEl.classList.contains('taskbar-orb'), 'body class change re-checks every flag');

matches.add('body.desktop-mode');
observerCallback([{ type: 'attributes', target: bodyEl, oldValue: '' }]);
assert.ok(htmlEl.classList.contains('has-desktop-mode'), 'html.has-desktop-mode follows body.desktop-mode');
matches.delete('body.desktop-mode');
observerCallback([{ type: 'attributes', target: bodyEl, oldValue: 'desktop-mode' }]);
assert.ok(!htmlEl.classList.contains('has-desktop-mode'), 'and clears when desktop mode ends');

// gallery: a context menu open on an item flags its gallery and wrapper only
const CTX = '.gallery-item.context-open';
galleryEl.inside.add(CTX); wrapperEl.inside.add(CTX);
observerCallback([{ type: 'attributes', target: { nodeType: 1, getAttribute: () => 'gallery-item context-open' }, oldValue: 'gallery-item' }]);
assert.ok(galleryEl.classList.contains('has-context-open-item') && wrapperEl.classList.contains('has-context-open-item'), 'context-open item flags .gallery and its wrapper');
assert.ok(!taskbarEl.classList.contains('has-context-open-item'), 'other hosts untouched');
galleryEl.inside.clear(); wrapperEl.inside.clear();
observerCallback([{ type: 'attributes', target: { nodeType: 1, getAttribute: () => 'gallery-item' }, oldValue: 'gallery-item context-open' }]);
assert.ok(!galleryEl.classList.contains('has-context-open-item'), 'closing the menu clears it');

// taskbar globe: traffic arrows and the ping wait
const SEND = '#taskbarWebsocketIndicator .websocket-arrow-up:is(.active, .active-http, .streaming-up:not(.streaming-stalled-up))';
const LIMITED = '#taskbarWsStatus.ping-response-wait';
taskbarEl.inside.add(SEND);
observerCallback([{ type: 'attributes', target: { nodeType: 1, getAttribute: () => 'websocket-arrow-up active' }, oldValue: 'websocket-arrow-up' }]);
assert.ok(taskbarEl.classList.contains('net-send') && !taskbarEl.classList.contains('net-recv'), 'up arrow flash sets .net-send');
taskbarEl.inside.add(LIMITED);
observerCallback([{ type: 'attributes', target: { nodeType: 1, getAttribute: () => 'ping-response-wait' }, oldValue: '' }]);
assert.ok(taskbarEl.classList.contains('net-limited'), 'ping wait sets .net-limited');
taskbarEl.inside.clear();
observerCallback([{ type: 'attributes', target: { nodeType: 1, getAttribute: () => 'websocket-arrow-up' }, oldValue: 'websocket-arrow-up active ping-response-wait' }]);
assert.ok(!taskbarEl.classList.contains('net-send') && !taskbarEl.classList.contains('net-limited'), 'flags clear when the arrows rest');

// direct sync (maximize / restore call it so same-task layout reads see the flag)
matches.add(MAX);
sandbox.window.syncRootStateFlags();
assert.ok(htmlEl.classList.contains('has-maximized-window'), 'syncRootStateFlags() applies immediately');

const modalUtils = read('public/scripts/comp/modalUtils.js');
assert.ok(/classList\.add\('modal-maximized'\);\s*window\.syncRootStateFlags\?\.\(\);/.test(modalUtils), 'maximize syncs the flags in the same task');
assert.ok(/classList\.remove\('modal-maximized'\);\s*window\.syncRootStateFlags\?\.\(\);/.test(modalUtils), 'restore syncs the flags in the same task');

console.log('test-root-state-flags: ok');
