#!/usr/bin/env node
'use strict';
// Default contextmenu handler: block the browser menu except plain text fields and selected text.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/contextMenu.js'), 'utf8');
assert.match(src, /addEventListener\('contextmenu', \(e\) => \{\s*if \(this\._keepsBrowserContextMenu\(e\.target\)\) return;\s*e\.preventDefault\(\);\s*\}, true\)/);
let selection = { isCollapsed: true, rangeCount: 0, toString: () => '', containsNode: () => false };
const noop = () => {};
// Anything the script touches at load: callable, chainable, never throws.
const any = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : any), apply: () => any, construct: () => any });
const ctx = { console, setTimeout, clearTimeout, navigator: { userAgent: 'node' },
    document: new Proxy({ addEventListener: noop, removeEventListener: noop, readyState: 'loading', querySelector: () => null, querySelectorAll: () => [] }, { get: (t, k) => (k in t ? t[k] : any) }),
    window: { addEventListener: noop, removeEventListener: noop, getSelection: () => selection, matchMedia: () => ({ matches: false, addEventListener: noop }) } };
ctx.window.document = ctx.document;
vm.createContext(ctx);
vm.runInContext(src + '\n;this.__C = ContextMenuController;', ctx);
const proto = ctx.__C.prototype;
function el(tag, opts = {}) {
    return { tagName: tag, type: opts.type, isContentEditable: !!opts.editable,
        closest(sel) {
            if (sel === '[data-context-menu]') return opts.menu ? {} : null;
            if (/input, textarea/.test(sel)) return ['INPUT', 'TEXTAREA'].includes(tag) || opts.editable ? this : null;
            return null;
        } };
}
const keeps = (e) => proto._keepsBrowserContextMenu.call(proto, e);
assert.strictEqual(keeps(el('TEXTAREA')), true, 'textarea keeps copy/paste');
assert.strictEqual(keeps(el('INPUT', { type: 'text' })), true);
assert.strictEqual(keeps(el('INPUT', { type: 'checkbox' })), false);
assert.strictEqual(keeps(el('TEXTAREA', { menu: true })), false, 'custom menu wins');
assert.strictEqual(keeps(el('DIV')), false, 'desktop/chrome is ours');
selection = { isCollapsed: false, rangeCount: 1, toString: () => 'hello', containsNode: () => true };
assert.strictEqual(keeps(el('DIV')), true, 'selected text keeps Copy');
assert.strictEqual(keeps(el('DIV', { menu: true })), false, 'custom menu still wins over a selection');
assert.strictEqual(keeps(null), false);
console.log('test-context-menu-default-block: ok');
