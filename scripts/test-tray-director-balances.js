#!/usr/bin/env node
// Wallet tray "Service keys" target and Director picker balances (menma follow-up to #659).
// - walletTray.js runAction('keys') opens Control Panel's Dreamscape CardSpace on its Service keys
//   section (cplAuthentication.open('service')), loading the control_panel feature first when it is
//   not loaded yet; Security Center's auth view is only the fallback.
// - director.js: a balance reply repaints an Engine / runtime menu that is already open, and every
//   socket (re)connect asks for balances again.
// Run: node scripts/test-tray-director-balances.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---- a small DOM: just what contextMenu's item markup and paintEngineBalances use ----
class El {
    constructor(tag, className) { this.tag = tag; this.className = className || ''; this.children = []; this.parent = null; this.textContent = ''; }
    get classList() { const el = this; return { contains: (c) => el.className.split(/\s+/).includes(c) }; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
    all() { return this.children.flatMap((c) => [c, ...c.all()]); }
    querySelectorAll(sel) { const cls = sel.replace(/^\./, ''); return this.all().filter((e) => e.classList.contains(cls)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function menuRow(item) {
    // contextMenu.js: .context-menu-item (+ item.className) > .context-menu-item-text-container > text, subtext
    const row = new El('div', ['context-menu-item'].concat(item.className ? [item.className] : []).join(' '));
    const box = row.appendChild(new El('div', 'context-menu-item-text-container'));
    box.appendChild(new El('span', 'context-menu-item-text')).textContent = item.text;
    if (item.subtext != null) box.appendChild(new El('span', 'context-menu-item-subtext')).textContent = item.subtext;
    return row;
}
const subtextOf = (row) => { const s = row.querySelector('.context-menu-item-subtext'); return s ? s.textContent : null; };

(async () => {
    // ---- wallet tray ----
    const ui = require('../public/scripts/comp/walletTray.js');
    const opened = [];
    const loads = [];
    delete globalThis.cplAuthentication;
    globalThis.openSecurityCenterDsap = (view) => opened.push(['security-center', view]);
    globalThis.featureLoader = {
        loadFeature: async (name) => {
            loads.push(name);
            globalThis.cplAuthentication = { open: (section) => { opened.push(['cardspace', section]); return true; } };
        }
    };
    assert.strictEqual(await ui._test.runAction('keys'), 'cardspace');
    assert.deepStrictEqual(loads, ['control_panel'], 'Control Panel is loaded on demand');
    assert.deepStrictEqual(opened, [['cardspace', 'service']], 'CardSpace opens on Service keys, not Security Center');
    opened.length = 0;
    assert.strictEqual(await ui._test.runAction('keys'), 'cardspace');
    assert.deepStrictEqual(loads, ['control_panel'], 'already loaded: no second load');
    assert.deepStrictEqual(opened, [['cardspace', 'service']]);
    // No Control Panel at all: Security Center's auth view is the fallback.
    opened.length = 0;
    delete globalThis.cplAuthentication;
    delete globalThis.featureLoader;
    assert.strictEqual(await ui._test.openServiceKeys(), 'security-center');
    assert.deepStrictEqual(opened, [['security-center', 'auth']]);
    delete globalThis.openSecurityCenterDsap;
    assert.strictEqual(await ui._test.openServiceKeys(), null, 'nothing to open: no throw');

    // ---- director ----
    const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/director.js'), 'utf8');
    const start = src.indexOf('class Director {');
    const classSrc = src.slice(start, src.indexOf('\n}\n', start) + 2);
    const handlers = {};
    const sent = [];
    let connected = false;
    const page = new El('body');
    const ctx = {
        localStorage: { getItem: () => null, setItem: () => {} },
        window: {
            wsClient: { isConnected: () => connected, send: (m) => sent.push(m), on: (type, fn) => { handlers[type] = fn; } }
        },
        document: { createElement: (tag) => new El(tag), querySelectorAll: (sel) => page.querySelectorAll(sel), getElementById: () => null },
        console
    };
    vm.createContext(ctx);
    vm.runInContext(`${classSrc}\nthis.Director = Director;`, ctx);
    const d = Object.create(ctx.Director.prototype);
    Object.assign(d, { engine: 'tokenrouter', persona: 'wren', customProviders: [{ engine: 'custom:sloproxy' }, { engine: 'custom:nvidia' }], engineBalances: {}, _engineBalancesAt: 0 });
    ctx.window.directorInstance = d;
    d.setupDirectorWebSocketHandlers();
    assert.ok(handlers.director_custom_providers_balance_response && handlers.connected, 'balance reply and connect handlers are wired');

    // Created before the socket was up: the first ask is dropped.
    d.requestEngineBalances();
    assert.strictEqual(sent.length, 0);
    connected = true;
    handlers.connected();
    assert.deepStrictEqual(sent.map((m) => m.type), ['director_custom_providers_balance'], 'connect asks for balances');
    handlers.connected();
    assert.strictEqual(sent.length, 2, 'every reconnect asks again, past the once-a-minute limit');

    // The Engine menu opens before the reply: no subtext yet.
    const items = d.engineMenuItem().optionsfn();
    assert.deepStrictEqual(Array.from(items, (i) => i.subtext), [null, null, null, null, null]);
    assert.ok(items.every((i) => /^director-engine-bal-/.test(i.className)), 'each row carries its engine class');
    assert.strictEqual(items[3].className, 'director-engine-bal-custom_sloproxy');
    const rows = Array.from(items, (item) => page.appendChild(menuRow(item))); // main-realm array
    handlers.director_custom_providers_balance_response({ data: { balances: [
        { engine: 'tokenrouter', balanceText: '$17.80' },
        { engine: 'custom:sloproxy', balanceText: '' },
        { engine: 'custom:nvidia', balanceText: 'Free tier' }
    ] } });
    assert.deepStrictEqual(rows.map(subtextOf), [null, null, '$17.80', null, 'Free tier'], 'the open menu is repainted');
    // A later reply updates and clears the text in place.
    handlers.director_custom_providers_balance_response({ data: { balances: [{ engine: 'tokenrouter', balanceText: '$16.10' }] } });
    assert.deepStrictEqual(rows.map(subtextOf), [null, null, '$16.10', null, null]);
    assert.strictEqual(rows[2].querySelectorAll('.context-menu-item-subtext').length, 1, 'no duplicate subtext');
    // A menu opened after the reply draws the text itself.
    assert.strictEqual(d.engineMenuItem().optionsfn()[2].subtext, '$16.10');
    console.log('tray + director balances: ok');
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
