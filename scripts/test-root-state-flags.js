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

// Classes that live on html or body (any `html.x` / `body.x` in the stylesheets). A compound made of
// only these, like `.window-controls-overlay:has(.pswp)`, anchors on html/body just the same.
const rootClasses = new Set();

// The compound with :has(...) / :not(...) / :is(...) arguments cut out
function compoundOutsideParens(compound) {
    let out = '';
    let depth = 0;
    for (const c of compound) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (!depth) out += c;
    }
    return out;
}

function rootClassOnly(compound) {
    const bare = compoundOutsideParens(compound);
    if (/^[a-zA-Z*]/.test(bare) || /[#[]/.test(bare)) return false;
    const classes = (bare.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    return classes.length > 0 && classes.every((c) => rootClasses.has(c));
}

function rootAnchoredHas(selector) {
    const norm = selector.trim().replace(/\s*([>+~])\s*/g, ' ').replace(/\s+/g, ' ');
    const compounds = splitTop(norm, ' ').filter(Boolean);
    return compounds.some((compound) => compound.includes(':has(')
        && (/^(html|body|:root)\b/.test(compound) || rootClassOnly(compound)));
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

const sheets = cssFiles(path.join(root, 'public/css'))
    .map((file) => [file, fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]);
for (const [, css] of sheets) {
    for (const m of css.matchAll(/\b(?:html|body)((?:\.[\w-]+)+)/g)) {
        m[1].split('.').filter(Boolean).forEach((c) => rootClasses.add(c));
    }
}

const offenders = [];
for (const [file, css] of sheets) {
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
assert.ok(rootAnchoredHas('body:not(.desktop-mode) .window-controls-overlay:has(.pswp.pswp--open) #x'), 'guard catches a :has() on a class that lives on html (installed-app titlebar: every DOM change restyled the page)');
assert.ok(!rootAnchoredHas('.gallery-item:has(.x) .y'), 'a :has() on an ordinary class is not this guard');
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

// A tiny element tree: classes, parent links, simple `.a, .b` matching. querySelector answers
// from an explicit per-element set of "selectors that have a match inside me".
let queries = 0;
const registry = [];
function el(className, parent = null) {
    const set = new Set(className.split(/\s+/).filter(Boolean));
    const node = {
        nodeType: 1,
        parentElement: parent,
        inside: new Set(),
        classList: {
            contains: (c) => set.has(c),
            toggle: (c, on) => { if (on) set.add(c); else set.delete(c); return on; }
        },
        getAttribute: (name) => (name === 'class' ? [...set].join(' ') : null),
        matches: (sel) => sel.split(',').some((part) => /^\.[\w-]+$/.test(part.trim()) && set.has(part.trim().slice(1))),
        // relevance checks use plain class lists; count only the flag queries
        querySelector: (sel) => { if (!/^\.[\w-]+(, \.[\w-]+)*$/.test(sel)) queries++; return node.inside.has(sel) ? {} : null; },
        querySelectorAll: (sel) => registry.filter((n) => n !== node && n.matches(sel) && isInside(n, node))
    };
    registry.push(node);
    return node;
}
function isInside(n, ancestor) {
    for (let p = n.parentElement; p; p = p.parentElement) if (p === ancestor) return true;
    return false;
}

const matches = new Set();
const htmlEl = el('');
const bodyEl = el('desktop-mode', htmlEl);
const wrapperEl = el('gallery-container-wrapper', bodyEl);
const galleryEl = el('gallery', wrapperEl);
const itemEl = el('gallery-item', galleryEl);
const taskbarEl = el('desktop-taskbar', bodyEl);
const arrowUp = el('websocket-arrow-up', taskbarEl);
const wsStatus = el('', taskbarEl);
const modalEl = el('modal', bodyEl);
const otherModal = el('modal', bodyEl);
const previewContent = el('manual-preview-content', modalEl);
let observerCallback = null;
let observeOptions = null;

const doc = {
    documentElement: htmlEl,
    body: bodyEl,
    querySelector: (sel) => {
        queries++;
        if (matches.has(sel)) return {};
        return registry.find((n) => n.matches(sel)) || null;
    },
    querySelectorAll: (sel) => registry.filter((n) => n.matches(sel)),
    addEventListener: () => {}
};
const win = {};
class MO {
    constructor(cb) { observerCallback = cb; }
    observe(target, opts) { assert.strictEqual(target, bodyEl); observeOptions = opts; }
}
new Function('window', 'document', 'MutationObserver', read('public/scripts/comp/rootStateFlags.js'))(win, doc, MO);

const attr = (target, oldValue) => [{ type: 'attributes', target, oldValue }];
const setCls = (node, className) => { const old = node.getAttribute('class'); className.split(' ').forEach((c) => node.classList.toggle(c, true)); return old; };
const clearCls = (node, className) => { const old = node.getAttribute('class'); node.classList.toggle(className, false); return old; };

assert.strictEqual(typeof win.syncRootStateFlags, 'function', 'syncRootStateFlags is exposed');
assert.strictEqual(typeof win.setDesktopTaskbarNetFlags, 'function', 'setDesktopTaskbarNetFlags is exposed');
assert.ok(observerCallback && observeOptions.subtree && observeOptions.childList && observeOptions.attributeOldValue, 'observes the body subtree');
assert.deepStrictEqual(observeOptions.attributeFilter, ['class'], 'only class attributes');
assert.ok(!htmlEl.classList.contains('has-maximized-window') && !bodyEl.classList.contains('taskbar-orb'), 'flags start off');

// page flags (html / body)
const MAX = '.modal.modal-maximized:not(.hidden):not(.hidden-alt)';
const ACTIVE_MAX = '.modal.modal-maximized.active-window:not(.hidden):not(.hidden-alt):not(.minimised)';
const ORB = '#desktopTaskbar .taskbar-start-button.orb';
matches.add(MAX); matches.add(ACTIVE_MAX);
observerCallback(attr(modalEl, setCls(modalEl, 'modal-maximized active-window')));
assert.ok(htmlEl.classList.contains('has-maximized-window'), 'maximizing a window sets html.has-maximized-window');
assert.ok(bodyEl.classList.contains('has-active-maximized-window'), 'and body.has-active-maximized-window');
matches.clear();
const formerModal = el('something-else', bodyEl);
observerCallback(attr(formerModal, 'modal modal-maximized'));
assert.ok(!htmlEl.classList.contains('has-maximized-window'), 'a class change that drops .modal clears the flag');

// unrelated mutations (Director text, arrow flashes elsewhere) do not query
const before = queries;
const span = el('', bodyEl);
observerCallback([
    { type: 'childList', target: bodyEl, addedNodes: [{ nodeType: 3 }], removedNodes: [{ nodeType: 3 }] },
    { type: 'childList', target: span, addedNodes: [el('', span)], removedNodes: [] },
    ...attr(el('ws-arrow active', bodyEl), 'ws-arrow')
]);
assert.strictEqual(queries, before, 'irrelevant mutations skip the re-check');

matches.add(ORB);
observerCallback([{ type: 'childList', target: taskbarEl, addedNodes: [el('taskbar-start-button orb', taskbarEl)], removedNodes: [] }]);
assert.ok(bodyEl.classList.contains('taskbar-orb'), 'Orb start button sets body.taskbar-orb');
matches.clear();
observerCallback(attr(bodyEl, 'desktop-mode'));
assert.ok(!bodyEl.classList.contains('taskbar-orb'), 'body class change re-checks every flag');
matches.add('body.desktop-mode');
observerCallback(attr(bodyEl, ''));
assert.ok(htmlEl.classList.contains('has-desktop-mode'), 'html.has-desktop-mode follows body.desktop-mode');
matches.delete('body.desktop-mode');
observerCallback(attr(bodyEl, 'desktop-mode'));
assert.ok(!htmlEl.classList.contains('has-desktop-mode'), 'and clears when desktop mode ends');

// gallery: a context menu open on an item flags its gallery and wrapper (both ancestors)
const CTX = '.gallery-item.context-open';
galleryEl.inside.add(CTX); wrapperEl.inside.add(CTX);
observerCallback(attr(itemEl, setCls(itemEl, 'context-open')));
assert.ok(galleryEl.classList.contains('has-context-open-item') && wrapperEl.classList.contains('has-context-open-item'), 'context-open item flags .gallery and its wrapper');
assert.ok(!taskbarEl.classList.contains('has-context-open-item'), 'other hosts untouched');
galleryEl.inside.clear(); wrapperEl.inside.clear();
observerCallback(attr(itemEl, clearCls(itemEl, 'context-open')));
assert.ok(!galleryEl.classList.contains('has-context-open-item'), 'closing the menu clears it');

// taskbar globe: traffic arrows are set from websocket.js; ping wait stays observed
win.setDesktopTaskbarNetFlags({ send: true, recv: false });
assert.ok(taskbarEl.classList.contains('net-send') && !taskbarEl.classList.contains('net-recv'), 'setDesktopTaskbarNetFlags sets .net-send');
const LIMITED = '#taskbarWsStatus.ping-response-wait';
taskbarEl.inside.add(LIMITED);
observerCallback(attr(wsStatus, setCls(wsStatus, 'ping-response-wait')));
assert.ok(taskbarEl.classList.contains('net-limited'), 'ping wait sets .net-limited');
taskbarEl.inside.clear();
observerCallback(attr(wsStatus, clearCls(wsStatus, 'ping-response-wait')));
win.setDesktopTaskbarNetFlags({ send: false, recv: false, limited: false });
assert.ok(!taskbarEl.classList.contains('net-send') && !taskbarEl.classList.contains('net-limited'), 'flags clear when the arrows rest');

// window caption: only the window that changed is re-checked
const CAPTION = ':scope > .modal-window-title';
modalEl.inside.add(CAPTION);
const title = el('modal-window-title', modalEl);
const q0 = queries;
observerCallback([{ type: 'childList', target: modalEl, addedNodes: [title], removedNodes: [] }]);
assert.ok(modalEl.classList.contains('window-has-caption') && !otherModal.classList.contains('window-has-caption'), 'a caption child flags its own window only');
assert.ok(queries - q0 <= 3, `targeted: ${queries - q0} scoped queries, not one per window`);
modalEl.inside.delete(CAPTION);
observerCallback([{ type: 'childList', target: modalEl, addedNodes: [], removedNodes: [title] }]);
assert.ok(!modalEl.classList.contains('window-has-caption'), 'removing the caption clears it');

// a window inserted with its caption is flagged in the same microtask
const newModal = el('modal');
newModal.inside.add(CAPTION);
observerCallback([{ type: 'childList', target: bodyEl, addedNodes: [newModal], removedNodes: [] }]);
assert.ok(newModal.classList.contains('window-has-caption'), 'inserted window gets its caption flag');

// Studio preview: reasoning items arriving during a generation
const REASONING = '.progress-reasoning-container .progress-reasoning-item';
previewContent.inside.add(REASONING);
const reasoning = el('progress-reasoning-item', previewContent);
observerCallback([{ type: 'childList', target: previewContent, addedNodes: [reasoning], removedNodes: [] }]);
assert.ok(previewContent.classList.contains('has-reasoning-items'), 'reasoning items flag the preview');

// syncRootStateFlags(el) syncs the container flags in and around one element (openModal)
otherModal.inside.add(CAPTION);
win.syncRootStateFlags(otherModal);
assert.ok(otherModal.classList.contains('window-has-caption'), 'syncRootStateFlags(modal) applies immediately');
matches.add(MAX);
win.syncRootStateFlags();
assert.ok(htmlEl.classList.contains('has-maximized-window'), 'syncRootStateFlags() applies page flags immediately');

const modalUtils = read('public/scripts/comp/modalUtils.js');
assert.ok(/classList\.add\('modal-maximized'\);\s*window\.syncRootStateFlags\?\.\(\);/.test(modalUtils), 'maximize syncs the flags in the same task');
assert.ok(/classList\.remove\('modal-maximized'\);\s*window\.syncRootStateFlags\?\.\(\);/.test(modalUtils), 'restore syncs the flags in the same task');
assert.ok(/function openModal\(modal\) \{\s*if \(!modal\) return;\s*\/\/[^\n]*\n\s*window\.syncRootStateFlags\?\.\(modal\);/.test(modalUtils), 'openModal syncs the window flags before measuring');

// CSS reads the window / Studio flags
const toolbarCss = read('public/css/modal-window-title-toolbar.css').replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!toolbarCss.includes(':has(> .modal-window-title)') && (toolbarCss.match(/:where\(\.window-has-caption\)/g) || []).length === 9, 'Vista frame rules read .window-has-caption inside :where() (same specificity)');
const manualCss = read('public/css/manual-modal.css');
assert.ok(!manualCss.includes('.manual-preview-content:has(') && !manualCss.includes('.manual-preview-container:has('), 'Studio preview rules read flags');
assert.ok(read('public/css/generation-quips.css').includes('.generating .manual-preview-content.has-reasoning-items .generation-preview-quip'), 'quips hide behind reasoning items via the flag');

console.log('test-root-state-flags: ok');
