#!/usr/bin/env node
// Slice 3 of the Melaton plan (Yozora #440): every resizable window gets a maximize box,
// a caption double-click maximizes / restores (minimizes without a maximize box), and a drag
// on a maximized caption restores the window under the pointer.
// Run: node scripts/test-window-maximize.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const src = read('public/scripts/comp/modalUtils.js');

function extractBlock(header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}
function extractLine(header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    return src.slice(start, src.indexOf('\n', start));
}

// ---- Tiny DOM stub: enough selector support for the caption helpers ----
function matchesCompound(el, compound) {
    if (!el || !el.classList) return false;
    const parts = compound.match(/[#.]?[^#.\[\]]+|\[[^\]]+\]/g) || [];
    return parts.every((p) => {
        if (p[0] === '.') return el.classList.contains(p.slice(1));
        if (p[0] === '#') return el.id === p.slice(1);
        if (p[0] === '[') {
            const m = p.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/);
            const v = el.attrs[m[1]];
            return m[2] === undefined ? v !== undefined : v === m[2];
        }
        return el.tagName === p.toUpperCase();
    });
}
function matchesSelector(el, selector) {
    return selector.split(',').some((sel) => {
        const chain = sel.trim().split(/\s+/);
        if (!matchesCompound(el, chain[chain.length - 1])) return false;
        let node = el.parentElement;
        for (let i = chain.length - 2; i >= 0; i--) {
            while (node && !matchesCompound(node, chain[i])) node = node.parentElement;
            if (!node) return false;
            node = node.parentElement;
        }
        return true;
    });
}
class El {
    constructor(tag, { id = '', cls = '', data = {}, attrs = {}, rect = null } = {}) {
        this.tagName = tag.toUpperCase();
        this.id = id;
        this._cls = new Set(cls.split(/\s+/).filter(Boolean));
        this.classList = {
            contains: (c) => this._cls.has(c),
            add: (c) => this._cls.add(c),
            remove: (c) => this._cls.delete(c)
        };
        this.dataset = { ...data };
        this.attrs = { ...attrs };
        this.children = [];
        this.parentElement = null;
        this.disabled = false;
        this.style = { display: '' };
        this._rect = rect;
        this.innerHTML = '';
        this.title = '';
        this.type = '';
    }
    set className(v) { this._cls = new Set(v.split(/\s+/).filter(Boolean)); }
    get className() { return Array.from(this._cls).join(' '); }
    append(...kids) { kids.forEach((k) => { k.parentElement = this; this.children.push(k); }); return this; }
    after(node) {
        const list = this.parentElement.children;
        node.parentElement = this.parentElement;
        list.splice(list.indexOf(this) + 1, 0, node);
    }
    *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
    querySelector(sel) { for (const n of this.walk()) if (matchesSelector(n, sel)) return n; return null; }
    closest(sel) { let n = this; while (n) { if (matchesSelector(n, sel)) return n; n = n.parentElement; } return null; }
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentElement; } return false; }
    getBoundingClientRect() { return this._rect || { left: 0, top: 0, width: 0, height: 0, bottom: 0 }; }
}

function buildWindow({ id = 'w', cls = 'modal resizeable-window', data = {}, minimize = true, extra = [] } = {}) {
    const modal = new El('div', { id, cls, data });
    const title = new El('div', { cls: 'modal-window-title', rect: { left: 0, top: 0, width: 800, height: 60, bottom: 60 } });
    const titleMain = new El('div', { cls: 'modal-window-title-main' });
    const toolbar = new El('div', { cls: 'modal-window-title-toolbar', rect: { left: 0, top: 30, width: 800, height: 30, bottom: 60 } });
    const toolbarBtn = new El('button', { cls: 'btn-secondary' });
    toolbar.append(toolbarBtn);
    title.append(titleMain, toolbar);
    const controls = new El('div', { cls: 'modal-window-controls' });
    extra.forEach((b) => controls.append(b));
    if (minimize) controls.append(new El('button', { cls: 'btn-secondary minimize-btn btn-small' }));
    controls.append(new El('button', { cls: 'btn-danger close-btn btn-small' }));
    modal.append(title, controls);
    return { modal, title, titleMain, toolbar, toolbarBtn, controls };
}

const calls = [];
const body = new El('body', { cls: 'desktop-mode' });
const ctx = {
    document: {
        body,
        createElement: (tag) => new El(tag)
    },
    getComputedStyle: (el) => ({ display: el.style.display || 'block', getPropertyValue: () => '0' }),
    toggleModalMaximize: (m) => calls.push(['toggle', m.id]),
    minimizeModalProgrammatically: (m) => calls.push(['minimize', m.id]),
    Math
};
vm.createContext(ctx);
vm.runInContext([
    extractLine('const MAXIMIZED_DRAG_RESTORE_THRESHOLD_PX'),
    extractLine('const MODAL_CUSTOM_MAXIMIZE_SELECTOR'),
    extractBlock('function ensureModalMaximizeButton('),
    extractBlock('function getModalCaptionBandTitleBar('),
    extractBlock('function isModalCaptionControlUsable('),
    extractBlock('function handleModalCaptionDoubleClick('),
    extractBlock('function restoreMaximizedModalUnderPointer('),
    'this.ensureModalMaximizeButton = ensureModalMaximizeButton;',
    'this.getModalCaptionBandTitleBar = getModalCaptionBandTitleBar;',
    'this.handleModalCaptionDoubleClick = handleModalCaptionDoubleClick;',
    'this.restoreMaximizedModalUnderPointer = restoreMaximizedModalUnderPointer;',
    'this.THRESHOLD = MAXIMIZED_DRAG_RESTORE_THRESHOLD_PX;'
].join('\n'), ctx);

// 1. A resizable window with a minimize box gets one maximize box, right after minimize.
{
    const w = buildWindow();
    const btn = ctx.ensureModalMaximizeButton(w.modal);
    assert.ok(btn, 'maximize box added');
    const names = w.controls.children.map((c) => c.classList.contains('minimize-btn') ? 'min'
        : c.classList.contains('modal-work-area-maximize') ? 'max' : c.classList.contains('close-btn') ? 'close' : '?');
    assert.deepStrictEqual(names, ['min', 'max', 'close'], 'order is minimize, maximize, close');
    assert.ok(btn.classList.contains('modal-maximize-auto'), 'marked as auto (desktop-only CSS)');
    assert.strictEqual(ctx.ensureModalMaximizeButton(w.modal), btn, 'idempotent');
    assert.strictEqual(w.controls.children.length, 3, 'no second box');
}

// 2. Skipped: fixed size, opt-out, no minimize box, own maximize, not resizable.
{
    assert.strictEqual(ctx.ensureModalMaximizeButton(buildWindow({ data: { windowFixedSize: 'true' } }).modal), null, 'fixed size');
    assert.strictEqual(ctx.ensureModalMaximizeButton(buildWindow({ data: { windowNoMaximize: 'true' } }).modal), null, 'opt-out');
    assert.strictEqual(ctx.ensureModalMaximizeButton(buildWindow({ minimize: false }).modal), null, 'dialog without minimize');
    assert.strictEqual(ctx.ensureModalMaximizeButton(buildWindow({ cls: 'modal' }).modal), null, 'not resizable');
    const studio = buildWindow({ id: 'manualModal', extra: [new El('button', { id: 'restoreManualBtn' })] });
    assert.strictEqual(ctx.ensureModalMaximizeButton(studio.modal), null, 'Studio keeps its own maximize');
    assert.strictEqual(studio.controls.querySelector('.modal-work-area-maximize'), null);
}

// 3. Caption double-click.
const dbl = (target, y = 10) => {
    let prevented = false;
    ctx.handleModalCaptionDoubleClick({ target, clientY: y, preventDefault: () => { prevented = true; } });
    return prevented;
};
{
    const w = buildWindow({ id: 'notes' });
    ctx.ensureModalMaximizeButton(w.modal);
    calls.length = 0;
    assert.ok(dbl(w.titleMain), 'handled');
    assert.deepStrictEqual(calls, [['toggle', 'notes']], 'maximize box: toggles maximize');

    calls.length = 0;
    dbl(w.toolbarBtn, 40);
    dbl(w.title, 40);
    assert.deepStrictEqual(calls, [], 'title toolbar and its buttons are not the caption band');

    w.toolbar.style.display = 'none';
    w.toolbar._rect = { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
    calls.length = 0;
    assert.ok(dbl(w.titleMain, 10), 'a hidden toolbar does not eat the caption');
    assert.deepStrictEqual(calls, [['toggle', 'notes']], 'hidden toolbar: caption still maximizes');
    w.toolbar.style.display = '';
    w.toolbar._rect = { left: 0, top: 30, width: 800, height: 30, bottom: 60 };

    const noMax = buildWindow({ id: 'tool', data: { windowFixedSize: 'true' } });
    ctx.ensureModalMaximizeButton(noMax.modal);
    calls.length = 0;
    dbl(noMax.titleMain);
    assert.deepStrictEqual(calls, [['minimize', 'tool']], 'no maximize box: minimizes');

    const dialog = buildWindow({ id: 'dlg', cls: 'modal', minimize: false });
    calls.length = 0;
    assert.ok(!dbl(dialog.titleMain), 'dialog without boxes ignores it');
    assert.deepStrictEqual(calls, []);

    const studio = buildWindow({ id: 'manualModal', cls: 'modal resizeable-window windowed' });
    const restoreBtn = new El('button', { id: 'restoreManualBtn' });
    restoreBtn.click = () => calls.push(['click', 'restoreManualBtn']);
    studio.controls.children.unshift(restoreBtn);
    restoreBtn.parentElement = studio.controls;
    calls.length = 0;
    dbl(studio.titleMain);
    assert.deepStrictEqual(calls, [['click', 'restoreManualBtn']], 'Studio window: its own maximize');
    studio.modal.classList.remove('windowed');
    calls.length = 0;
    dbl(studio.titleMain);
    assert.deepStrictEqual(calls, [], 'fullscreen Studio editor is not a window');

    body.classList.remove('desktop-mode');
    calls.length = 0;
    dbl(w.titleMain);
    assert.deepStrictEqual(calls, [], 'desktop mode only');
    body.classList.add('desktop-mode');

    w.modal.classList.add('minimised');
    calls.length = 0;
    dbl(w.titleMain);
    assert.deepStrictEqual(calls, [], 'minimised window ignores it');
}

// 4. Drag a maximized caption: restore under the pointer at the same caption fraction.
{
    assert.ok(ctx.THRESHOLD >= 3 && ctx.THRESHOLD <= 8, 'small move threshold');
    const modal = new El('div', { id: 'max', cls: 'modal resizeable-window modal-maximized' });
    modal._rect = { left: 0, top: 0, width: 1600, height: 900 };
    let placed = null;
    const rctx = Object.assign(ctx, {
        restoreModalFromMaximize: (m) => { m.classList.remove('modal-maximized'); m._rect = { left: 300, top: 200, width: 800, height: 500 }; },
        setModalPositionFromViewportRect: (m, rect) => { placed = rect; m._rect = { ...rect }; },
        prepareModalForDragOrResize: () => {},
        isModalTopAnchored: () => false,
        showWindowFrameForModal: () => calls.push(['frame'])
    });
    modal.setAttribute = (k, v) => { modal.attrs[k] = v; };
    const session = { modal, startX: 1200, startY: 12, pendingMaximizeRestore: true, livePreview: true };
    calls.length = 0;
    rctx.restoreMaximizedModalUnderPointer(session, 1210, 20);
    assert.strictEqual(session.pendingMaximizeRestore, false, 'restored once');
    // grabbed at 75 % of the maximized caption → 75 % of the restored 800 px caption
    assert.strictEqual(placed.left, 1210 - 0.75 * 800, 'keeps the pointer fraction');
    assert.strictEqual(placed.top, 20 - 12, 'keeps the pointer height in the caption');
    assert.strictEqual(placed.width, 800, 'restored width');
    assert.strictEqual(session.startX, 1210, 'drag continues from the pointer');
    assert.strictEqual(session.width, 800, 'session takes the restored size');
    assert.deepStrictEqual(calls, [['frame']], 'outline frame follows the restored window');
}

// 5. Wiring.
{
    const dragStart = extractBlock('function handleModalDragStart(');
    assert.ok(/pendingMaximizeRestore = isModalMaximized\(modal\)/.test(dragStart), 'drag start keeps a maximized window until it moves');
    assert.ok(/getModalCaptionBandTitleBar\(e\)/.test(dragStart), 'drag and double-click share the caption hit test');
    assert.ok(/pendingMaximizeRestore/.test(extractBlock('function handleModalDragEnd(')), 'press-release on a maximized caption commits nothing');
    assert.ok(/restoreMaximizedModalUnderPointer\(session/.test(extractBlock('function handleModalDrag(')), 'drag restores past the threshold');
    assert.ok(src.includes("document.addEventListener('dblclick', handleModalCaptionDoubleClick)"), 'dblclick listener registered');
    assert.ok(/ensureModalMaximizeButton\(modal\)/.test(extractBlock('function wireModalMaximizeButton(')), 'openModal path adds the box');
    assert.ok(read('public/css/app.css').includes('.modal.modal-maximized > .resize-handle'), 'maximized windows have no sizing border');
    assert.ok(read('public/css/modal-window-title-toolbar.css').includes('body:not(.desktop-mode) .modal .modal-window-controls .modal-maximize-auto'),
        'auto maximize box is desktop only');
}

console.log('test-window-maximize: ok');
