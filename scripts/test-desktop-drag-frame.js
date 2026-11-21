#!/usr/bin/env node
// Desktop icon drag, one frame per paint (Yozora #998): moves only store the pointer, one animation
// frame writes the positions, the insert mark and does one hit-test from geometry read when the drag
// started; .folder-drop-target changes only on the previous and the new folder; the drop flushes a
// pending frame first so it lands where the last move put the icons.
// Run: node scripts/test-desktop-drag-frame.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktopShortcuts.js'), 'utf8');
const classSrc = src.slice(src.indexOf('class DesktopShortcutsManager'), src.indexOf('desktopShortcuts = new DesktopShortcutsManager()'));

let rects = 0;
let classWrites = 0;
const el = (id, rect, extra = {}) => {
    const set = new Set(extra.classes || []);
    return {
        dataset: { shortcutId: id },
        style: {},
        isConnected: true,
        classList: {
            contains: (c) => set.has(c),
            add: (...c) => { classWrites++; c.forEach((x) => set.add(x)); },
            remove: (...c) => { classWrites++; c.forEach((x) => set.delete(x)); },
            toggle: (c, on) => { classWrites++; if (on) set.add(c); else set.delete(c); }
        },
        getBoundingClientRect: () => { rects++; return rect; },
        closest() { return this; },
        remove() { this.isConnected = false; },
        _classes: set
    };
};

const container = el(null, { left: 10, top: 20, width: 800, height: 600 });
container.appendChild = () => {};
container.querySelectorAll = () => [];
const iconA = el('a', { width: 75, height: 70 });
const iconB = el('b', { width: 75, height: 90 });
const folder = el('f', { width: 75, height: 70 });
const other = el('o', { width: 75, height: 70 }, { classes: ['folder-drop-target'] }); // stale from an earlier drag
const ghostA = el('a', null);
const ghostB = el('b', null);
let under = null;
const frames = [];

const ctx = vm.createContext({
    console, Math, Set, Map, setTimeout, clearTimeout, parseFloat, parseInt,
    window: { desktopIconView: {} },
    document: { elementFromPoint: () => under, getElementById: () => null },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: (id) => { frames[id - 1] = null; },
    noteDesktopPointerContentDrag: () => {}
});
vm.runInContext(`${classSrc}; this.DesktopShortcutsManager = DesktopShortcutsManager;`, ctx);
const m = Object.create(ctx.DesktopShortcutsManager.prototype);
Object.assign(m, {
    freeformContainer: container, desktopContainer: container, gridContainer: null, dropZoneOverlay: null,
    dragThreshold: 10, selectedShortcutIds: new Set(['a', 'b']),
    shortcuts: [{ id: 'a', type: 'app' }, { id: 'b', type: 'app' }, { id: 'f', type: 'folder' }, { id: 'o', type: 'app' }],
    _iconMetrics: null, _iconView: null, _insertMark: null
});
m.getAllShortcutElements = () => [iconA, iconB, folder, other, ghostA, ghostB];
m.prepareDragGroup = function () {
    this.dragGroup = [
        { element: iconA, shortcut: this.shortcuts[0], startX: 100, startY: 50 },
        { element: iconB, shortcut: this.shortcuts[1], startX: 180, startY: 50 }
    ];
    this.primaryDragStart = { x: 100, y: 50 };
};
m.createDragGhosts = function () { this.dragGroup[0].ghost = ghostA; this.dragGroup[1].ghost = ghostB; };
let dropped = null;
m.computeVistaDrop = (items) => { dropped = items.map((it) => [it.ghost.style.left, it.ghost.style.top]); return []; };
m.updateMultipleShortcutPositions = async () => {};

m.draggedShortcut = { element: iconA, shortcut: m.shortcuts[0], wasInGrid: false };
m.dragStartPos = { x: 120, y: 80 };
m.dragOffset = { x: 10, y: 10 };
m.isDragging = false;
const move = (x, y) => m.handleDragMove({ type: 'mousemove', clientX: x, clientY: y, preventDefault() {} });
const runFrames = () => { const list = frames.splice(0); list.forEach((fn) => fn && fn()); };

// under the threshold: nothing
move(122, 82);
assert.strictEqual(m.isDragging, false);
assert.strictEqual(frames.length, 0);

// the drag starts: geometry read once (container + both icons), then moves only store the pointer
move(160, 120);
assert.strictEqual(m.isDragging, true);
assert.strictEqual(rects, 3, 'container and each dragged icon read once at the start');
move(170, 125);
move(180, 130);
assert.strictEqual(frames.length, 1, 'one frame for any number of moves');
assert.strictEqual(rects, 3, 'a move reads no layout');
under = folder;
runFrames();
assert.strictEqual(rects, 3, 'the frame reads no layout either (its one hit-test is elementFromPoint)');
// the latest pointer: x = 180 - 10 - 10 = 160 (delta 60), y = 130 - 20 - 10 = 100 (delta 50)
assert.strictEqual(ghostA.style.left, '160px');
assert.strictEqual(ghostA.style.top, '100px');
assert.strictEqual(ghostB.style.left, '240px');
assert.strictEqual(ghostB.style.top, '100px');
assert.ok(folder._classes.has('folder-drop-target'), 'the folder under the pointer is the drop target');
assert.ok(!other._classes.has('folder-drop-target'), 'the first frame clears a stale highlight');

// the same target on the next frame: no class writes at all
classWrites = 0;
move(181, 131);
runFrames();
assert.strictEqual(classWrites, 0, 'same target: nothing toggled');

// a new target: only the old and the new one change
under = other;
move(182, 132);
runFrames();
assert.ok(!folder._classes.has('folder-drop-target'), 'the old target is cleared');
assert.ok(!other._classes.has('folder-drop-target'), 'a non-folder is never a drop target');
assert.strictEqual(classWrites, 1, 'one class write: the previous target');

// clamping uses the cached sizes: far right/bottom
move(5000, 5000);
runFrames();
assert.strictEqual(ghostA.style.left, '725px');
assert.strictEqual(ghostB.style.left, '725px');
assert.strictEqual(ghostB.style.top, `${600 - 90}px`, 'each icon clamped by its own size');

// the drop flushes the pending frame first
under = null;
move(300, 200);
assert.strictEqual(frames.length, 1);
m.handleDragEnd({ type: 'mouseup', clientX: 300, clientY: 200 }).then(() => {
    // x = 300 - 10 - 10 = 280 (delta 180), y = 200 - 20 - 10 = 170 (delta 120)
    assert.deepStrictEqual(dropped, [['280px', '170px'], ['360px', '170px']], 'the drop sees the last move');
    assert.ok(frames.every((f) => f === null), 'no frame left pending');
    assert.strictEqual(m.isDragging, false);
    console.log('test-desktop-drag-frame: ok');
}).catch((e) => { console.error(e); process.exit(1); });
