#!/usr/bin/env node
// Desktop observers that woke for nothing (Yozora #998): vistaDialogs.js re-tags its dialogs only when an
// appended element is or holds one of them, or a body class flip moves the desktop in or out of Vista
// mode; windowCapture.js keeps a window's picture through its stacking attributes and the task
// monitor's busy flags. Run: node scripts/test-desktop-observers-998.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- vistaDialogs.js: the body observer ----------------------------------------------------------
{
    const observers = [];
    const bodyClasses = new Set(['desktop-mode']);
    let theme = 'classic';
    let lookups = 0;
    let themeChecks = 0; // apply() reads the mode first
    const dialog = { id: 'confirmationDialog', nodeType: 1 };
    let dialogConnected = false;
    const doc = {
        readyState: 'complete',
        body: { classList: { contains: (c) => bodyClasses.has(c) } },
        getElementById: (id) => { lookups += 1; return id === 'confirmationDialog' && dialogConnected ? dialog : null; },
        addEventListener: () => {}
    };
    const ctx = vm.createContext({
        document: doc,
        window: { uiTheme: { is: (t) => { themeChecks += 1; return t === theme; } } },
        MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() {} },
        NodeFilter: {}, Array, Set, WeakMap
    });
    ctx.window.document = doc;
    vm.runInContext(`${read('public/scripts/comp/vistaDialogs.js').replace(/\(typeof window !== 'undefined' \? window : null\);\s*$/, '(window);')}`, ctx);
    assert.strictEqual(observers.length, 1, 'one body observer');
    const fire = (records) => observers[0].fn(records);
    const applies = () => { const n = lookups; return () => lookups - n; };

    // a body class flip that leaves Vista mode as it was: nothing re-read
    let since = applies();
    fire([{ type: 'attributes', attributeName: 'class' }]);
    assert.strictEqual(since(), 0, 'a class flip inside the same mode re-reads nothing');
    // one that changes it: the dialogs are read again
    theme = 'vista';
    since = applies();
    fire([{ type: 'attributes', attributeName: 'class' }]);
    assert.ok(since() >= 4, 'entering Vista mode re-reads the dialogs');
    theme = 'classic';
    fire([{ type: 'attributes', attributeName: 'class' }]);

    // an unrelated element (a window, a toast, the taskbar preview): no re-read, no subtree walk
    const toast = { nodeType: 1, id: 'toast', firstElementChild: { }, contains: () => false, querySelector: () => { throw new Error('no subtree walk'); } };
    since = applies();
    const checks = themeChecks;
    fire([{ type: 'childList', addedNodes: [toast] }]);
    assert.strictEqual(themeChecks, checks, 'no apply');
    assert.strictEqual(since(), 4, 'only the four id lookups');
    const leaf = { nodeType: 1, id: '', firstElementChild: null };
    since = applies();
    fire([{ type: 'childList', addedNodes: [leaf] }]);
    assert.strictEqual(since(), 0, 'an empty element costs no lookup');
    // the dialog itself, or a wrapper that holds it: re-read
    since = applies();
    fire([{ type: 'childList', addedNodes: [dialog] }]);
    assert.ok(since() >= 4, 'the dialog appended: re-read');
    dialogConnected = true;
    const wrapper = { nodeType: 1, id: 'host', firstElementChild: dialog, contains: (n) => n === dialog };
    since = applies();
    fire([{ type: 'childList', addedNodes: [wrapper] }]);
    assert.ok(since() > 4, 'a wrapper holding the dialog: re-read');
}

// ---- windowCapture.js: what does not change a window's picture ------------------------------------
{
    const src = read('public/scripts/comp/windowCapture.js');
    const body = src.slice(src.indexOf('    const UNPAINTED_ATTRS'), src.indexOf('    // ---- letting go while unused'));
    let cb = null;
    const ctx = vm.createContext({ MutationObserver: class { constructor(fn) { cb = fn; } observe() {} disconnect() {} }, Array, Set });
    vm.runInContext(`${body}; this.watch = watch;`, ctx);
    const win = { classList: ['modal', 'active-window'], addEventListener() {}, removeEventListener() {} };
    const entry = {};
    ctx.watch(win, entry);
    const attr = (name, target = win) => ({ target, type: 'attributes', attributeName: name, oldValue: '' });
    cb([attr('data-modal-z-index'), attr('data-modal-stack-position'), attr('aria-busy'), attr('data-task-busy'), attr('style')]);
    assert.ok(!entry.dirty, 'stacking, busy flags and style keep the picture');
    cb([attr('aria-busy', { inner: true })]);
    assert.strictEqual(entry.dirty, true, 'a busy flag inside the window still counts');
    ctx.watch(win, entry);
    entry.dirty = false;
    cb([attr('data-modal-z-index'), attr('title')]);
    assert.strictEqual(entry.dirty, true, 'any other attribute marks it dirty');
}

console.log('test-desktop-observers-998: ok');
