#!/usr/bin/env node
// Atelier on the Vista desktop (Yukimi 2026-10-13): a light window, the caption's controls in a
// menu bar (File, View, Dataset, Marks, Pins, Tag Bag), search left on the glass.
// Run: node scripts/test-atelier-vista-menubar.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Chrome = require('../public/scripts/comp/naxtVistaChrome.js');

const clicks = [];
const btn = (name, extra = {}) => ({ name, disabled: false, dataset: {}, classList: { contains: (c) => !!extra[c] }, click: () => clicks.push(name), ...extra });
const app = {
    homeBtn: btn('home'), refreshBtn: btn('refresh'), closeBtn: btn('close'),
    openCustomTagBtn: btn('custom', { hidden: true }),
    quickGoatBtn: btn('goat'), quickGemsBtn: btn('gems'), quickDebatedBtn: btn('debated'),
    filterToggleBtn: btn('filters'), resetFiltersBtn: btn('reset')
};
app.quickGemsBtn.dataset.state = 'on';
app.filterToggleBtn.dataset.state = 'on';
const c = Object.create(Chrome.prototype);
c.app = app;

const file = c.fileItems();
assert.deepStrictEqual(file.filter((i) => !i.separator).map((i) => i.text), ['Home', 'Refresh', 'Add Custom Tag…', 'Close']);
assert.strictEqual(file.find((i) => i.action === 'custom').disabled, true, 'Add Custom Tag follows the hidden button');
const view = c.viewItems();
assert.deepStrictEqual(view.filter((i) => i.checked).map((i) => i.text), ['Hidden Gems', 'Filter Bar'], 'checks follow the buttons');
['home', 'goat', 'filters', 'reset', 'close'].forEach((a) => c.run(a));
assert.deepStrictEqual(clicks, ['home', 'goat', 'filters', 'reset', 'close'], 'menu entries drive the window\'s own buttons');

// wiring and look
assert.ok(read('public/scripts/comp/featureLoader.js').includes("scripts: ['scripts/comp/naxtVistaChrome.js', 'scripts/comp/naxtApplet.js']"));
assert.ok(read('public/scripts/comp/featureLoader.js').includes("'css/vista-atelier.css'"));
assert.ok(read('public/scripts/comp/naxtApplet.js').includes('this.vista = new NaxtVistaChrome(this)'));
const js = read('public/scripts/comp/naxtVistaChrome.js');
assert.ok(js.includes('const MOVED = [];') && !/naxt-quick-filters, #naxtHomeBtn[^{]*\{\s*display: none/.test(read('public/css/vista-atelier.css')), 'the caption keeps its controls (Yukimi: back to the titlebar)');
assert.ok(js.includes("this.modal.dataset.windowClient = 'light'") && js.includes('[...this.homes].reverse()'), 'light on the Vista desktop, caption order restored elsewhere');
const css = read('public/css/vista-atelier.css');
assert.ok(css.includes('background: linear-gradient(#fefeff, #e5eaf5 7px, #d4dbed 7px, #e1e6f6 20px);') && css.includes('border-bottom: 1px solid #b6bccc;'), "Vista's menu bar (the VM's Explorer)");
assert.ok(/\.naxt-menu-title:is\(:hover, :focus-visible, \.context-open\) \{\s*background: #3399ff;/.test(css), 'flat highlight, held while the menu is open');
assert.ok(css.includes('#naxtModal.naxt-vista #naxtFilterToolbar.modal-content-toolbar-overlay {\n    position: static;'), 'the filter bar flows under the menu bar');

console.log('test-atelier-vista-menubar: ok');
