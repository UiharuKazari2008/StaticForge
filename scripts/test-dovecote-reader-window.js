'use strict';

// Dovecote reader window (#fix5): executes the real dovecote.js against a tiny fake DOM and
// opens a reader window the way the mail-row context menu does (dove-row-open-window ->
// doveOpenReaderWindow). Regression for "appendChild: parameter 1 is not of type 'Node'":
// doveBuildReaderWindow returned the modal while doveOpenReaderWindow used result.modal.
// Also checks every node the reading-pane builders append is a real element.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/desktop-apps/dovecote.js'), 'utf8');

class FakeClassList {
    constructor(el) { this.el = el; }
    _get() { return (this.el.className || '').split(/\s+/).filter(Boolean); }
    _set(list) { this.el.className = list.join(' '); }
    add(...c) { const l = this._get(); c.forEach((x) => { if (!l.includes(x)) l.push(x); }); this._set(l); }
    remove(...c) { this._set(this._get().filter((x) => !c.includes(x))); }
    contains(c) { return this._get().includes(c); }
    toggle(c, force) { const has = this.contains(c); const want = force === undefined ? !has : !!force; if (want) this.add(c); else this.remove(c); return want; }
}

class FakeNode {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.className = '';
        this.id = '';
        this.dataset = {};
        this.style = { setProperty() {}, removeProperty() {} };
        this.attributes = {};
        this.textContent = '';
        this.classList = new FakeClassList(this);
        this.listeners = {};
    }
    appendChild(child) {
        if (!(child instanceof FakeNode)) {
            throw new TypeError("Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.");
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    insertBefore(child) { return this.appendChild(child); }
    append(...nodes) { nodes.forEach((n) => { if (n instanceof FakeNode) this.appendChild(n); }); }
    prepend(...nodes) { this.append(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener() {}
    _all() { const out = []; const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); }); walk(this); return out; }
    _match(sel) {
        sel = sel.trim();
        if (sel.startsWith('#')) return (n) => n.id === sel.slice(1);
        if (sel.startsWith('.')) { const cls = sel.slice(1).split('.'); return (n) => cls.every((c) => n.classList.contains(c)); }
        if (sel.startsWith('[')) { const k = sel.slice(1, -1).split('=')[0]; return (n) => k in n.attributes; }
        return (n) => n.tagName === sel.toUpperCase();
    }
    querySelectorAll(sel) { const fns = sel.split(',').map((s) => this._match(s)); return this._all().filter((n) => fns.some((f) => f(n))); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    closest() { return null; }
    contains(n) { return n === this || this._all().includes(n); }
    getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
    focus() {}
}

const body = new FakeNode('body');
const document = {
    body,
    documentElement: new FakeNode('html'),
    createElement: (t) => new FakeNode(t),
    createTextNode: (t) => { const n = new FakeNode('#text'); n.textContent = t; return n; },
    createDocumentFragment: () => new FakeNode('#fragment'),
    getElementById: (id) => body.querySelector('#' + id),
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    addEventListener() {},
    removeEventListener() {}
};

// Catch-all for app globals (contextMenu, wsClient, modal helpers…): callable, chainable,
// never thenable so `await` on it resolves immediately.
const noop = new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : noop),
    apply: () => noop
});

const sandbox = {
    document,
    console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Map, Set, WeakMap, Promise, Date, JSON, Math, Object, Array, String, Number, Error, TypeError, RegExp, Symbol, encodeURIComponent, decodeURIComponent
};
sandbox.window = sandbox;
const context = vm.createContext(new Proxy(sandbox, {
    has: () => true,
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? noop : undefined))
}));

const { doveOpenReaderWindow, doveReaderWindows } = vm.runInContext(src + '\n;({ doveOpenReaderWindow, doveReaderWindows });', context, { filename: 'dovecote.js' });

function main() {
    // Opening from the mail-row menu must not throw and must mount one reader window.
    assert.doesNotThrow(() => doveOpenReaderWindow('mail-42'));
    const readers = body.querySelectorAll('.dovecote-reader-window');
    assert.strictEqual(readers.length, 1, 'reader window appended to <body>');
    const state = doveReaderWindows.get('mail-42');
    assert.ok(state && state.modal === readers[0], 'doveReaderWindows stores the state object whose modal is mounted');

    // Reading-pane wiring: badge + body tools are real elements inside the body pane.
    assert.ok(state.els.safetyBar instanceof FakeNode, 'safetyBar is an element');
    assert.ok(state.els.safetyBar.classList.contains('dovecote-sanitized-badge'));
    assert.ok(state.els.bodyWrap.querySelector('.dovecote-body-tools'), 'Safe badge floats in the body pane, not the header');
    assert.strictEqual(readers[0].querySelector('.dovecote-oe-header').querySelector('.dovecote-body-tools'), null);

    // Re-opening the same mail focuses the existing window instead of mounting a second one.
    assert.doesNotThrow(() => doveOpenReaderWindow('mail-42'));
    assert.strictEqual(body.querySelectorAll('.dovecote-reader-window').length, 1);

    console.log('dovecote reader window open tests passed');
}

main();
