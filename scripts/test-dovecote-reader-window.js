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
    _matchesSelector(node, sel) {
        const parts = sel.trim().split(/\s+/);
        const last = parts.pop();
        if (!this._match(last)(node)) return false;
        let parent = node.parentNode;
        for (let i = parts.length - 1; i >= 0; i--) {
            const fn = this._match(parts[i]);
            while (parent && !fn(parent)) parent = parent.parentNode;
            if (!parent) return false;
            parent = parent.parentNode;
        }
        return true;
    }
    querySelectorAll(sel) {
        const groups = sel.split(',').map((s) => s.trim()).filter(Boolean);
        return this._all().filter((n) => groups.some((group) => this._matchesSelector(n, group)));
    }
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

const { doveOpenReaderWindow, doveReaderWindows, ensureDesktopDovecoteModal, doveDisplayAddress, doveBareAddress, doveFormatAddressList } = vm.runInContext(src + '\n;({ doveOpenReaderWindow, doveReaderWindows, ensureDesktopDovecoteModal, doveDisplayAddress, doveBareAddress, doveFormatAddressList });', context, { filename: 'dovecote.js' });

async function openReaderFromSidebarWithoutMainWindow() {
    // The Mail gadget calls doveOpenReaderWindow before Dovecote itself has been opened,
    // so desktopDovecoteEls is still null. The reader must show the message, not
    // "Cannot read properties of null (reading 'rows')".
    assert.strictEqual(document.getElementById('desktopDovecoteModal'), null);
    sandbox.wsClient = {
        sendMessage(type, message) {
            if (type === 'dovecote_get_mail') {
                return Promise.resolve({
                    mail: {
                        id: message.id,
                        from: 'menma',
                        to: ['yukimi'],
                        cc: [],
                        subject: 'Hello from Menma',
                        body: 'plain',
                        format: 'text',
                        read: true,
                        attachments: [],
                        createdAt: '2026-10-14T18:00:00.000Z'
                    }
                });
            }
            if (type === 'dovecote_render_body') {
                return Promise.resolve({ html: '<p>plain</p>', strippedCounts: {}, remoteImages: [] });
            }
            if (type === 'dovecote_list_mailboxes') {
                return Promise.resolve({ mailboxes: [{ owner: 'yukimi', unread: 1 }] });
            }
            return Promise.resolve({ mail: [], mailboxes: [] });
        }
    };
    doveOpenReaderWindow('mail-42');
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
    delete sandbox.wsClient;
    const state = doveReaderWindows.get('mail-42');
    assert.strictEqual(state.els.oeSubject.textContent, 'Hello from Menma');
    assert.strictEqual(state.els.oeFrom.textContent, 'menma@dream.co.jp');
    assert.strictEqual(state.els.loadingHint.textContent.includes('rows'), false);
    assert.strictEqual(document.getElementById('desktopDovecoteModal'), null);
}

async function main() {
    await openReaderFromSidebarWithoutMainWindow();

    // Opening from the mail-row menu must not throw and must mount one reader window.
    assert.doesNotThrow(() => doveOpenReaderWindow('mail-42'));
    const readers = body.querySelectorAll('.dovecote-reader-window');
    assert.strictEqual(readers.length, 1, 'reader window appended to <body>');
    const state = doveReaderWindows.get('mail-42');
    assert.ok(state && state.modal === readers[0], 'doveReaderWindows stores the state object whose modal is mounted');

    // Reading-pane wiring: badge + body tools are real elements inside the body pane.
    assert.ok(state.els.safetyBar instanceof FakeNode, 'safetyBar is an element');
    assert.ok(state.els.safetyBar.classList.contains('dovecote-sanitized-badge'));
    const hdr = readers[0].querySelector('.dovecote-oe-header');
    const headerFields = hdr.querySelectorAll('.dovecote-oe-header-row').map((row) => row.dataset.doveField);
    assert.ok(headerFields.includes('to'), 'reader header has a To line');
    assert.ok(headerFields.includes('cc'), 'reader header has a Cc line');
    assert.ok(hdr.querySelector('.dovecote-oe-header-tools').querySelector('.dovecote-sanitized-badge'), 'Safe badge sits in the header tools column');
    assert.ok(hdr.querySelector('.dovecote-body-view-toggle'), 'reader has its own Rendered/Raw toggle in the header');
    assert.strictEqual(state.els.bodyWrap.querySelector('.dovecote-oe-header-tools'), null, 'nothing overlays the body');
    assert.ok(!readers[0].classList.contains('toolbar-visible'), 'reader caption has no toolbar row (#473)');
    assert.strictEqual(readers[0].querySelector('.modal-content').children[0].className, 'dovecote-command-bar', 'reader command bar is the client\'s first row (#473)');

    // Re-opening the same mail focuses the existing window instead of mounting a second one.
    assert.doesNotThrow(() => doveOpenReaderWindow('mail-42'));
    assert.strictEqual(body.querySelectorAll('.dovecote-reader-window').length, 1);

    // Double compose regression: one click on Create Mail must open exactly ONE compose window.
    // Bubble a click from the button through every ancestor's listeners like a real DOM would.
    const modal = ensureDesktopDovecoteModal();
    const createBtn = modal.querySelectorAll('button').find((b) => b.dataset.doveAction === 'create');
    assert.ok(createBtn, 'Create Mail button exists');
    const ev = {
        target: { closest: (sel) => (sel === '[data-dove-action]' ? createBtn : null) },
        preventDefault() {}, stopPropagation() {}
    };
    for (let n = createBtn; n; n = n.parentNode) (n.listeners.click || []).forEach((fn) => fn(ev));
    assert.strictEqual(body.querySelectorAll('.dovecote-compose-window').length, 1, 'one click -> one compose window');

    // Preview hidden with nothing selected.
    assert.ok(modal.querySelector('.dovecote-main-pane').classList.contains('dovecote-no-selection'));

    // Display-only @dream.co.jp suffix; input with or without it maps back to the bare name.
    assert.strictEqual(doveDisplayAddress('menma'), 'menma@dream.co.jp');
    assert.strictEqual(doveDisplayAddress(''), '');
    assert.strictEqual(doveBareAddress('yukimi@dream.co.jp'), 'yukimi');
    assert.strictEqual(doveBareAddress(' menma '), 'menma');
    assert.strictEqual(doveBareAddress('Menma@Dream.co.jp'), 'Menma');
    assert.strictEqual(doveFormatAddressList(['menma', 'yukimi']), 'menma@dream.co.jp, yukimi@dream.co.jp');
    assert.strictEqual(doveFormatAddressList('rook'), 'rook@dream.co.jp');
    assert.strictEqual(doveFormatAddressList(''), '');

    console.log('dovecote reader window open tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
