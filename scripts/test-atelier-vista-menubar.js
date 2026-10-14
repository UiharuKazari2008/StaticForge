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
// Yukimi 2026-10-14: "Atelier should use a blue control bar instead of the caption bar design"
// (replaces 2026-10-13's "back to the titlebar"): on the Vista desktop the caption's controls move
// into a blue command bar under the menu bar, the search group into the menu band; back elsewhere.
assert.ok(js.includes("this.commandBar.className = 'naxt-command-bar'") && js.includes('moveToolbar(on)'), 'the caption controls move into the command bar on the Vista desktop');
assert.ok(js.includes("(isSearch ? this.searchSlot : this.commandBar).appendChild(child)") && js.includes("this.modal.classList.add('toolbar-visible')"), 'search goes to the menu band; everything returns to the caption off the Vista desktop');
assert.ok(js.includes("naxtBagDropdownBtn: 'Tag Bag'") && js.includes("naxtQuickGoatBtn: 'GOAT'"), 'command bar buttons carry labels');
// Yukimi 2026-10-14: "too many items, we should keep the home, filters and marks in the menu bar"
assert.ok(js.includes("const MOVED = [['naxtHomeBtn', 'Home'], ['naxtMarkFilterDropdownBtn', 'Marks'], ['naxtElevatePinsDropdownBtn', 'Pins']];"), 'Home, Marks and Pins are menu-bar titles');
assert.ok(read('public/css/vista-atelier.css').includes('#naxtModal.naxt-vista .naxt-command-bar #naxtFilterToggleBtn {\n    display: none;'), 'no separate Filters button: View > Filter Bar / Reset Filters cover it');
assert.ok(js.includes('this.bar.insertBefore(btn, this.searchSlot)') && js.includes('if (btn.parentNode === home.parent) return;'), 'menu titles sit before the search box; caption order survives the round trip');
assert.ok(read('public/css/vista-atelier.css').includes('#naxtModal.naxt-vista .naxt-command-bar {') && read('public/css/vista-atelier.css').includes('background: linear-gradient(#8fbbed 1px, #4b90df 1px, #295591 15px, #183d76 15px, #325f9e calc(100% - 1px), #819ec4 calc(100% - 1px));'), "Windows Mail's blue command bar");
assert.ok(js.includes("this.modal.dataset.windowClient = 'light'") && js.includes('[...this.homes].reverse()'), 'light on the Vista desktop, caption order restored elsewhere');
const css = read('public/css/vista-atelier.css');
assert.ok(css.includes('background: linear-gradient(#fefeff, #e5eaf5 7px, #d4dbed 7px, #e1e6f6 20px);') && css.includes('border-bottom: 1px solid #b6bccc;'), "Vista's menu bar (the VM's Explorer)");
assert.ok(/\.naxt-menu-title:is\(:hover, :focus-visible, \.context-open\) \{\s*background: #3399ff;/.test(css), 'flat highlight, held while the menu is open');
assert.ok(css.includes('#naxtModal.naxt-vista #naxtFilterToolbar.modal-content-toolbar-overlay {\n    position: static;'), 'the filter bar flows under the menu bar');

console.log('test-atelier-vista-menubar: ok');
