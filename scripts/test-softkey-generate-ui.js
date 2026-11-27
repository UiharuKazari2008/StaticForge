#!/usr/bin/env node
/**
 * Soft Key Bar > "Generate with AI..." and the link action (StaticForge #1414, public/scripts/comp/wmSettingsPersonal.js). Runs the
 * real script in a vm against a fake Settings kit, a fake phone page and fake bridges (AndroidSoftKeyProbe, wsClient).
 *
 *   node scripts/test-softkey-generate-ui.js [path/to/wmSettingsPersonal.js]
 *
 * Covers: the uri: action (valid links, the short text in lists, kind, the manual manager's Link: row and its binding, a half-made link
 * saved as None); the button only for a program (not Default); the design she types as the request's design; the whole run (default
 * saved only when asked and different, the probe's one-shot listener, the packets and their payloads, the phone's check, progress lines);
 * the result lists (via markers, why notes, "Could not make" visible); what the phone refuses leaves the profile into the problems with
 * its reason; "Use this profile" fills the draft (a side the answer left empty keeps what it was) and does not save; every error ends in
 * the view (no bridge, probe failed, probe timeout, server error, no key, hard stop) and Close ends a run in flight.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp/wmSettingsPersonal.js'), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
let step = 0;
const ok = (msg) => console.log(`  ${++step}. ${msg}`);
const tick = () => new Promise((r) => setImmediate(r));
async function until(fn, what) { for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 2)); } throw new Error(`timed out waiting for ${what}`); }

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kit = {
    esc,
    check: (name, label, checked, attrs = '') => `<label class="wm-check"><input type="checkbox" name="${esc(name)}"${checked ? ' checked' : ''} ${attrs}><span>${esc(label)}</span></label>`,
    row: (label, control, o = {}) => `<div class="wm-form-row${o.wide ? ' is-wide' : ''}"><span class="wm-form-label">${esc(label)}</span>${control}</div>`,
    edit: (id, value, attrs = '') => `<input class="wm-edit" type="text" value="${esc(value)}" ${attrs}>`,
    comboHtml: (act, label, disabled = false) => `<button type="button" class="wm-combo" data-act="${esc(act)}"${disabled ? ' disabled' : ''}><span>${esc(label)}</span></button>`,
    sub: (t) => `<div class="wm-form-sub">${esc(t)}</div>`,
    note: (t) => `<p class="wm-form-note">${esc(t)}</p>`,
    text: (t) => `<p>${esc(t)}</p>`,
    gap: () => '<div class="wm-form-gap"></div>',
    buttons: (list) => `<div class="wm-buttons">${list.map(([act, label, off]) => `<button type="button" class="wm-button" data-act="${esc(act)}"${off ? ' disabled' : ''}>${esc(label)}</button>`).join('')}</div>`,
    listbox: () => '<div class="wm-listbox"></div>',
    bindListbox() {},
    bindCombo(btn, options, current, onPick) { if (btn) { btn.combo = { options, current, onPick }; } },
    trackbar() {}
};

/** A page element that records what the page binds on it; el.node(selector) is the element a query for the selector returned. */
function makeEl() {
    const nodes = new Map();
    const make = (sel) => {
        const n = { sel, value: '', checked: false, disabled: false, handlers: {}, parentElement: { sel: `${sel}:parent` }, combo: null,
            addEventListener(t, fn) { (this.handlers[t] || (this.handlers[t] = [])).push(fn); },
            fire(t, ev) { (this.handlers[t] || []).forEach((fn) => fn(Object.assign({ target: this, stopPropagation() {} }, ev))); } };
        return n;
    };
    const el = {
        html: '',
        set innerHTML(v) { this.html = v; nodes.clear(); },
        get innerHTML() { return this.html; },
        querySelector(sel) {
            const m = /^(?:\[data-act="([^"]+)"\]|\[data-f="([^"]+)"\]|input\[name="([^"]+)"\]|textarea\[name="([^"]+)"\])$/.exec(sel);
            if (!m) return null;
            const present = m[1] ? this.html.includes(`data-act="${m[1]}"`) : m[2] ? this.html.includes(`data-f="${m[2]}"`) : m[3] ? this.html.includes(`<input type="checkbox" name="${m[3]}"`) : this.html.includes(`<textarea class="wm-edit" name="${m[4]}"`);
            if (!present) return null;
            if (!nodes.has(sel)) nodes.set(sel, make(sel));
            return nodes.get(sel);
        },
        querySelectorAll() { return []; },
        node(sel) { return this.querySelector(sel); },
        text() { return this.html.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').split('\n').map((x) => x.trim()).filter(Boolean); }
    };
    return el;
}

function makePage(opts = {}) {
    const listeners = [];
    const state = { sent: [], reads: [], checks: [], dropdowns: [], barConfig: [], timeouts: [] };
    const window = {
        uiShell: 'mobile',
        addEventListener(type, fn, o) { listeners.push({ type, fn, signal: o && o.signal }); },
        dispatch(type, detail) { listeners.filter((l) => l.type === type && !(l.signal && l.signal.aborted)).forEach((l) => l.fn({ type, detail })); },
        liveListeners: (type) => listeners.filter((l) => l.type === type && !(l.signal && l.signal.aborted)).length,
        wmShell: {
            todaySoftKeys: { programs: () => [{ id: 'android:com.example.shop/.Main', label: 'Shop' }, { id: 'android:com.example.news/.Main', label: 'News' }], get: () => ({ left: 'back', right: 'menu' }), defaults: () => ({ left: 'back', right: 'menu' }), actions: () => [], set() {} },
            dropdown(anchor, items) { state.dropdowns.push({ anchor, items }); },
            refreshSoftKeys() {}
        },
        AndroidBars: {
            getState: () => JSON.stringify({ config: { softProfiles: opts.profiles || undefined } }),
            setConfig: (j) => state.barConfig.push(JSON.parse(j))
        }
    };
    const defs = [];
    window.wmSettings = { ui: kit, registerPage: (d) => defs.push(d), extendPage() {} };
    // the engines and the answer the fake server gives
    const server = Object.assign({
        engines: { engines: [{ id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat', ready: true, models: ['deepseek-chat', 'deepseek-reasoner'] }, { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-x', ready: false, models: ['gpt-x'] }], saved: { engine: 'deepseek', model: 'deepseek-chat' } },
        handle: null
    }, opts.server || {});
    window.wsClient = {
        isConnected: () => true,
        handlesErrors: (fn) => fn(),
        async sendMessage(type, data) {
            state.sent.push({ type, data: plain(data) });
            if (server.handle) { const r = await server.handle(type, data); if (r !== undefined) return r; }
            if (type === 'softkeys_engines') return server.engines;
            if (type === 'softkeys_default_set') return { saved: { engine: data.engine, model: data.model } };
            throw new Error(`unexpected ${type}`);
        }
    };
    const probe = {
        mode: 'ok', // ok | late | silent | fail | notok
        read(pkg) {
            state.reads.push(pkg);
            const id = `r${state.reads.length}`;
            const detail = { id, pkg, ok: probe.mode !== 'notok', label: 'Shop', versionName: '1', routes: probe.mode === 'notok' ? [{ route: 'activities', ok: false, error: 'no permission' }] : [{ route: 'activities', ok: true }], activities: ['.Main', '.Subs'], links: ['https://shop.example/subs'], shortcuts: [], keyboardShortcuts: [], notes: [] };
            if (probe.mode === 'ok' || probe.mode === 'notok') setImmediate(() => window.dispatch('softkeyprobe', detail));
            else if (probe.mode === 'sync') window.dispatch('softkeyprobe', detail);
            else if (probe.mode === 'fail') throw new Error('bridge broke');
            else if (probe.mode === 'empty') return '';
            return id;
        },
        verdict: (a) => ({ action: a, ok: true, why: '' }),
        check(json) { state.checks.push(JSON.parse(json)); return JSON.stringify(JSON.parse(json).map((a) => probe.verdict(a))); }
    };
    if (!opts.noProbe) window.AndroidSoftKeyProbe = probe;
    const timers = new Set();
    const ctx = {
        window, document: { addEventListener() {}, documentElement: { dataset: {}, classList: { contains: () => true } }, hidden: false }, console, Promise, JSON, Map, Set, String, Number, Array, Object, Math, Date, AbortController, Error, Symbol, RegExp,
        setTimeout: (fn, ms) => { const t = setTimeout(fn, opts.fastProbe && ms === 30000 ? opts.fastProbe : opts.fastTimeout && ms >= 100000 ? opts.fastTimeout : ms); timers.add(t); state.timeouts.push(ms); return t; },
        clearTimeout: (t) => { timers.delete(t); clearTimeout(t); }
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'wmSettingsPersonal.js' });
    const def = defs.find((x) => x.id === 'buttons');
    assert(def, 'the Buttons page is registered');
    const gen = window.wmSoftKeyGen;
    assert(gen, 'the pure pieces are exported');
    return { window, def, gen, probe, server, state, timers, ctx };
}

const GOOD = {
    profile: {
        left: { action: 'uri:intent://shop.example/subs#Intent;scheme=https;package=com.example.shop;end', label: 'Subscriptions' },
        center: { action: 'tasks', label: '' },
        right: { action: 'ownmenu', label: 'Menu', menu: [{ label: 'Orders', action: 'uri:https://shop.example/orders' }, { label: '-', action: 'sep' }, { label: 'Search', action: 'key:KEYCODE_SEARCH' }, { label: 'Back', action: 'back' }] }
    },
    items: [{ side: 'left', menuIndex: null, label: 'Subscriptions', action: 'uri:intent://shop.example/subs#Intent;scheme=https;package=com.example.shop;end', via: 'link', why: 'The Subs activity is exported.' },
        { side: 'right', menuIndex: 0, label: 'Orders', action: 'uri:https://shop.example/orders', via: 'link', why: 'Orders page link.' }],
    problems: [{ side: 'right', menuIndex: 5, label: 'Wishlist', action: '', reason: 'No way to open it from outside.' }],
    engine: 'deepseek', model: 'deepseek-chat', ms: 1234
};

/** Open the manager on `Shop` (a program profile) with an open dialog; draws it. */
function openDialog(page, profilesFrom) {
    const d = page.def.init();
    d.sk.prof = 'com.example.shop';
    if (!d.sk.profiles['com.example.shop']) d.sk.profiles['com.example.shop'] = JSON.parse(JSON.stringify(d.sk.profiles.default));
    const el = makeEl();
    let paints = 0;
    const api = { rerender: () => { paints += 1; draw(); }, get paints() { return paints; } };
    function draw() { el.innerHTML = ''; page.def.render(el, 'softkey', d, api); }
    draw();
    return { d, el, api, draw };
}
const profilesFixture = () => ({ default: { left: { action: 'back', label: '' }, center: { action: 'tasks', label: '' }, right: { action: 'menu', label: '' } } });

(async () => {
    // ---- the pure pieces
    {
        const { gen } = makePage({ profiles: profilesFixture() });
        assert.strictEqual(gen.skUriOk('https://shop.example/a'), true);
        assert.strictEqual(gen.skUriOk('intent://shop.example/a#Intent;scheme=https;end'), true);
        assert.strictEqual(gen.skUriOk('intent:#Intent;action=android.intent.action.VIEW;end'), true);
        for (const bad of ['', 'https:', 'intent:', 'http://x.example', 'javascript:alert(1)', 'shop.example', 'HTTPS://x.example', 'https://' + 'a'.repeat(600)]) assert.strictEqual(gen.skUriOk(bad), false, bad);
        ok('a link is valid only when it starts with intent: or https: and has something after it (600 characters at most)');
        assert.strictEqual(gen.skLinkText('https://www.example.com/a/b?x=1'), 'www.example.com/a/b');
        assert.strictEqual(gen.skLinkText('https://example.com/'), 'example.com');
        assert.strictEqual(gen.skLinkText('intent://shop.example/subs#Intent;scheme=https;end'), 'shop.example/subs');
        assert.strictEqual(gen.skLinkText('https://example.com/' + 'x'.repeat(60)).length, 34);
        assert(gen.skLinkText('https://example.com/' + 'x'.repeat(60)).endsWith('...'));
        assert.strictEqual(gen.skLinkText('intent:#Intent;action=a.b.VIEW;end'), 'action=a.b.VIEW');
        assert.strictEqual(gen.skActionText('uri:https://example.com/a'), 'Link: example.com/a');
        assert.strictEqual(gen.skActionText('uri:'), '<Open a Link>');
        assert.strictEqual(gen.skKind('uri:https://x.example'), 'uri');
        assert.strictEqual(gen.skKind('uri:'), 'uri');
        assert(gen.skgDefs.SK_ACTIONS.some(([k, l]) => k === 'uri' && l === '<Open a Link>'));
        ok('a link shows as "Link: host/path" (shortened), its kind is uri, the action list has <Open a Link>');
        assert.strictEqual(gen.skCleanAction('uri:'), 'none');
        assert.strictEqual(gen.skCleanAction('uri:http://x.example'), 'none');
        assert.strictEqual(gen.skCleanAction('uri:https://x.example'), 'uri:https://x.example');
        assert.strictEqual(gen.skCleanAction('key:KEYCODE_A'), 'key:KEYCODE_A');
        ok('a half-made link is saved as None; every other action is left alone');

        assert.strictEqual(gen.skgDesign({ left: '', center: '', right: '', menu: '' }), undefined);
        assert.deepStrictEqual(plain(gen.skgDesign({ left: ' Subscriptions ', center: '', right: 'Menu', menu: 'Orders\n\n-\n--\nSearch\r\n-\n' })),
            { left: { label: 'Subscriptions' }, right: { label: 'Menu', menu: [{ label: 'Orders' }, { sep: true }, { label: 'Search' }] } });
        assert.deepStrictEqual(plain(gen.skgDesign({ left: '', center: 'Home', right: '', menu: 'Only' })), { center: { label: 'Home' }, right: { menu: [{ label: 'Only' }] } });
        assert.strictEqual(gen.skgDesign({ left: '', center: '', right: '', menu: '-\n-' }), undefined);
        assert.strictEqual(gen.skgDesign({ left: 'x'.repeat(50) }).left.label.length, 24);
        ok('the design she types: names clamped, one item per line, - is a divider (none leading, trailing or doubled), nothing typed = no design');

        assert.deepStrictEqual(plain(gen.skgActions(GOOD)).sort(), ['back', 'key:KEYCODE_SEARCH', 'tasks', 'uri:https://shop.example/orders', 'uri:intent://shop.example/subs#Intent;scheme=https;package=com.example.shop;end'].sort());
        ok('the actions the phone is asked about: every key and menu action once, never the menu marker or a divider');

        const verdicts = {
            'uri:intent://shop.example/subs#Intent;scheme=https;package=com.example.shop;end': { ok: true }, tasks: { ok: true }, back: { ok: true },
            'uri:https://shop.example/orders': { ok: false, why: 'The phone cannot open that link.' }, 'key:KEYCODE_SEARCH': { ok: true }
        };
        const r = gen.skgResult(GOOD, verdicts);
        assert.deepStrictEqual(plain(r.keys.right.menu.map((m) => m.action)), ['key:KEYCODE_SEARCH', 'back'], 'a refused row leaves the menu and the divider that led it');
        assert.strictEqual(r.keys.left.label, 'Subscriptions');
        assert.deepStrictEqual(plain(r.problems.map((p) => [p.side, p.menuIndex, p.label, p.reason])),
            [['right', 5, 'Wishlist', 'No way to open it from outside.'], ['right', 0, 'Orders', 'The phone cannot open that link.']]);
        ok('what the phone refuses leaves the profile into the problems with its reason (after the server\'s own), and the divider left at the top goes');
        const none = gen.skgResult(GOOD, {});
        assert.strictEqual(none.keys.left, null);
        assert.strictEqual(none.keys.right, null);
        assert.strictEqual(none.problems.filter((p) => /no answer/.test(p.reason)).length, 5);
        assert.strictEqual(none.keys.center, null);
        ok('an action the phone gave no verdict for counts as refused: nothing is accepted unchecked');
        const bare = gen.skgResult({ profile: { left: { action: 'ownmenu', label: 'Menu', menu: [] } } }, null);
        assert.strictEqual(bare.keys.left, null);
        assert.strictEqual(bare.problems.length, 1);
        const keyMenu = gen.skgKey({ action: 'menu', label: 'M', menu: [{ label: 'A', action: 'back' }] });
        assert.strictEqual(keyMenu.action, 'ownmenu');
        ok('a menu with no items is a problem, a key that carries a menu is the menu of its own');

        const cur = { left: { action: 'back', label: '' }, center: { action: 'home', label: 'Mine' }, right: { action: 'menu', label: '' } };
        const merged = gen.skgMerge(cur, { left: { action: 'uri:https://x.example', label: 'L' }, center: null, right: null });
        assert.strictEqual(merged.left.action, 'uri:https://x.example');
        assert.deepStrictEqual(plain(merged.center), cur.center);
        assert.deepStrictEqual(plain(merged.right), cur.right);
        merged.left.label = 'changed';
        ok('a side the answer left empty keeps what it was (her center)');
        assert.strictEqual(gen.skgVia('uri:https://x', false), 'by link');
        assert.strictEqual(gen.skgVia('uri:https://x', true), 'opens by link');
        assert.strictEqual(gen.skgVia('key:KEYCODE_A', false), 'by key presses (the program is driven with keys)');
        assert.strictEqual(gen.skgVia('combo:KEYCODE_A+KEYCODE_B', true), 'by key presses (the program is driven with keys)');
        assert.strictEqual(gen.skgVia('back', false), '');
        ok('the via marker: link, key presses, nothing for built-ins');
    }

    // ---- the manual manager: the Link: row
    {
        const page = makePage({ profiles: profilesFixture() });
        const d = page.def.init();
        d.sk.prof = 'default';
        d.sk.profiles.default.left = { action: 'uri:', label: '' };
        const el = makeEl();
        const api = { rerender: () => {} };
        page.def.render(el, 'softkey', d, api);
        assert(/class="wm-form-label">Link:</.test(el.html), 'a Link: row');
        assert(/data-f="sk-uri" maxlength="600"/.test(el.html));
        assert(el.text().includes('<Open a Link>'), 'the action combo shows <Open a Link>');
        assert(!/data-act="sk-gen"/.test(el.html), 'no Generate button on Default');
        const box = el.node('[data-f="sk-uri"]');
        box.value = 'ftp://nope';
        box.fire('input');
        assert.strictEqual(d.sk.profiles.default.left.action, 'uri:', 'an invalid link is not taken');
        box.value = '  https://shop.example/subs  ';
        box.fire('input');
        assert.strictEqual(d.sk.profiles.default.left.action, 'uri:https://shop.example/subs', 'a valid link is kept as typed (trimmed) on every input');
        // selecting the action sets uri: until typed
        const act = el.node('[data-act="sk-act"]');
        act.combo.onPick('back');
        act.combo.onPick('uri');
        assert.strictEqual(d.sk.profiles.default.left.action, 'uri:');
        // saved: a half-made link is None
        page.def.commit(d);
        assert.strictEqual(page.state.barConfig.length, 1);
        assert.strictEqual(page.state.barConfig[0].softProfiles.default.left.action, 'none');
        ok('the manager has the Link: row (maxlength 600), takes only valid links as typed, picking the action sets uri:, a half-made link is saved as None');
    }

    // ---- the button and the dialog
    {
        const page = makePage({ profiles: profilesFixture() });
        const d = page.def.init();
        const el = makeEl();
        page.def.render(el, 'softkey', d, { rerender() {} });
        assert(!/Generate with AI/.test(el.html));
        d.sk.prof = 'com.example.shop';
        d.sk.profiles['com.example.shop'] = JSON.parse(JSON.stringify(d.sk.profiles.default));
        page.def.render(el, 'softkey', d, { rerender() {} });
        assert(/data-act="sk-remove"[^>]*>Remove Program</.test(el.html));
        assert(/data-act="sk-gen"[^>]*>Generate with AI\.\.\.</.test(el.html));
        ok('"Generate with AI..." is next to Remove Program for a program, not for Default');
    }

    // a full run: form, engines, generate, result, use
    {
        const page = makePage({ profiles: profilesFixture(), server: { handle: async (type) => (type === 'softkeys_generate' ? GOOD : undefined) } });
        const { d, el, draw } = openDialog(page);
        assert.strictEqual(page.def.viewDepth(d), 0);
        el.node('[data-act="sk-gen"]').fire('click');
        assert.strictEqual(page.def.viewDepth(d), 1, 'the view is open');
        assert.strictEqual(page.def.viewTitle(d), 'Soft keys for Shop');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        assert.deepStrictEqual(plain(page.state.sent[0]), { type: 'softkeys_engines', data: {} });
        let t = el.text();
        assert(t.includes("Melaton reads this program's activities on the phone and asks an AI to build its soft keys."));
        assert(t.includes('What do you want?'));
        assert(t.includes('Design it myself first'));
        assert(t.includes('DeepSeek'), 'the saved engine is the start');
        assert.strictEqual(el.node('[data-f="gen-model"]').value, '', 'the value is in the attribute');
        assert(/data-f="gen-model"/.test(el.html) && /value="deepseek-chat"/.test(el.html), 'the saved model is pre-filled');
        assert(/data-act="gen-go"[^>]*>Generate</.test(el.html) && !/data-act="gen-go"[^>]*disabled/.test(el.html));
        assert(/data-act="gen-close"/.test(el.html));
        assert(!/name="gen-menu"/.test(el.html), 'no design rows until the check is on');
        const engOptions = el.node('[data-act="gen-engine"]').combo.options;
        assert.deepStrictEqual(plain(engOptions), [['deepseek', 'DeepSeek'], ['openai', 'OpenAI (no key)']]);
        assert.deepStrictEqual(plain(page.def.softKeys(d).left && { label: page.def.softKeys(d).left.label, disabled: page.def.softKeys(d).left.disabled }), { label: 'Generate', disabled: false });
        assert.strictEqual(page.def.softKeys(d).right.label, 'Close');
        ok('the dialog opens as a view of the page: heading, step text, wish, design check, engines with (no key), the saved model, Generate and Close');

        // the design rows
        el.node('input[name="gen-design"]').checked = true;
        el.node('input[name="gen-design"]').fire('change', { target: { checked: true } });
        assert(/Left soft key name:/.test(el.html) && /Center button name:/.test(el.html) && /Right soft key name:/.test(el.html));
        assert(/Right key menu \(one item per line, - for a divider\):/.test(el.html));
        el.node('textarea[name="gen-wish"]').value = 'Open my subscriptions from the left key';
        el.node('textarea[name="gen-wish"]').fire('input');
        el.node('[data-f="gen-left"]').value = 'Subscriptions'; el.node('[data-f="gen-left"]').fire('input');
        el.node('[data-f="gen-right"]').value = 'Menu'; el.node('[data-f="gen-right"]').fire('input');
        el.node('textarea[name="gen-menu"]').value = 'Orders\n-\nSearch'; el.node('textarea[name="gen-menu"]').fire('input');
        assert.strictEqual(d.sk.gen.wish, 'Open my subscriptions from the left key');
        ok('"Design it myself first" shows the three names and the menu box; what she types is kept in the view');

        // an engine and model pick, the default
        const modelsBtn = el.node('[data-act="gen-models"]');
        modelsBtn.fire('click');
        assert.strictEqual(page.state.dropdowns.length, 1);
        assert.deepStrictEqual(plain(page.state.dropdowns[0].items.map((i) => i.label)), ['deepseek-chat', 'deepseek-reasoner']);
        page.state.dropdowns[0].items[1].action();
        assert.strictEqual(d.sk.gen.model, 'deepseek-reasoner');
        el.node('[data-act="gen-engine"]').combo.onPick('openai');
        assert.strictEqual(d.sk.gen.engine, 'openai');
        assert.strictEqual(d.sk.gen.model, 'gpt-x');
        assert(/name="gen-default"[^>]*disabled/.test(el.html), 'an engine with no key cannot be made the default');
        el.node('[data-act="gen-engine"]').combo.onPick('deepseek');
        assert.strictEqual(d.sk.gen.model, 'deepseek-chat', 'back on the saved engine: the saved model');
        el.node('[data-f="gen-model"]').value = 'deepseek-reasoner'; el.node('[data-f="gen-model"]').fire('input');
        el.node('input[name="gen-default"]').checked = true; el.node('input[name="gen-default"]').fire('change');
        assert.strictEqual(d.sk.gen.makeDefault, true);
        ok('engine and model: the models list, a typed model, an engine with no key cannot be the default');

        // Generate
        page.state.sent.length = 0;
        const before = page.state.timeouts.length;
        el.node('[data-act="gen-go"]').fire('click');
        assert.strictEqual(d.sk.gen.phase, 'running');
        assert(/data-act="gen-go"[^>]*disabled/.test(el.html), 'Generate is disabled while it runs');
        assert(page.def.softKeys(d).left.disabled);
        assert.strictEqual(d.sk.gen.progress[0], undefined, 'the default is saved before the first line');
        await until(() => d.sk.gen.phase === 'result', 'the result');
        assert.deepStrictEqual(plain(page.state.sent.map((s) => s.type)), ['softkeys_default_set', 'softkeys_generate']);
        assert.deepStrictEqual(plain(page.state.sent[0].data), { engine: 'deepseek', model: 'deepseek-reasoner' });
        const sent = page.state.sent[1].data;
        assert.deepStrictEqual(Object.keys(sent).sort(), ['design', 'engine', 'label', 'model', 'pkg', 'probe', 'wish']);
        assert.strictEqual(sent.pkg, 'com.example.shop');
        assert.strictEqual(sent.label, 'Shop');
        assert.strictEqual(sent.wish, 'Open my subscriptions from the left key');
        assert.deepStrictEqual(sent.design, { left: { label: 'Subscriptions' }, right: { label: 'Menu', menu: [{ label: 'Orders' }, { sep: true }, { label: 'Search' }] } });
        assert.strictEqual(sent.engine, 'deepseek');
        assert.strictEqual(sent.model, 'deepseek-reasoner');
        assert.strictEqual(sent.probe.pkg, 'com.example.shop');
        assert.deepStrictEqual(sent.probe.activities, ['.Main', '.Subs']);
        assert.deepStrictEqual(plain(d.sk.gen.progress), ['Reading the program on the phone...', 'Asking DeepSeek deepseek-reasoner...', 'Checking the answer...']);
        assert.deepStrictEqual(page.state.reads, ['com.example.shop']);
        assert.strictEqual(page.window.liveListeners('softkeyprobe'), 0, 'the probe listener is gone');
        assert.strictEqual(page.timers.size, 0, 'no timer left running');
        assert.deepStrictEqual(page.state.timeouts.slice(before).sort((a, b) => a - b), [30000, 120000], 'a 30 s probe wait and the 120 s hard stop, both one-shot');
        assert.deepStrictEqual(plain(page.state.checks[0]).sort(), ['back', 'key:KEYCODE_SEARCH', 'tasks', 'uri:https://shop.example/orders', 'uri:intent://shop.example/subs#Intent;scheme=https;package=com.example.shop;end'].sort());
        assert.strictEqual(d.sk.gen.saved.model, 'deepseek-reasoner');
        ok('Generate: the default saved first (when asked and different), the probe, softkeys_generate with { pkg, label, probe, wish, design, engine, model }, the phone\'s check, three progress lines, no listener or timer left');

        // the result view
        draw();
        t = el.text();
        assert(t.includes('Left soft key: Subscriptions (opens by link)'), t.join(' | '));
        assert(t.includes('Center button: Running Programs') || t.includes('Center button: <Running Programs>'), t.join(' | '));
        assert(t.includes('Right soft key: Menu (3 items)'), t.join(' | '));
        assert(t.includes('Orders (by link)'));
        assert(t.includes('Search (by key presses (the program is driven with keys))'));
        assert(t.includes('Back'));
        assert(t.includes('The Subs activity is exported.') && t.includes('Orders page link.'), 'the why notes');
        assert(t.includes('Could not make'));
        assert(t.includes('Right soft key menu: Wishlist - No way to open it from outside.'), t.join(' | '));
        assert(/data-act="gen-use"[^>]*>Use this profile</.test(el.html) && /data-act="gen-close"/.test(el.html));
        assert.strictEqual(page.def.softKeys(d).left.label, 'Use');
        ok('the result lists the keys with their via markers and why notes, and "Could not make" is shown, not behind a click');

        // use it
        d.sk.profiles['com.example.shop'].center = { action: 'home', label: 'Mine' };
        const savedBefore = d.skSaved;
        el.node('[data-act="gen-use"]').fire('click');
        const prof = d.sk.profiles['com.example.shop'];
        assert.strictEqual(prof.left.action, GOOD.profile.left.action);
        assert.strictEqual(prof.left.label, 'Subscriptions');
        assert.strictEqual(prof.right.action, 'ownmenu');
        assert.deepStrictEqual(plain(prof.right.menu), [{ label: 'Orders', action: 'uri:https://shop.example/orders' }, { label: '-', action: 'sep' }, { label: 'Search', action: 'key:KEYCODE_SEARCH' }, { label: 'Back', action: 'back' }]);
        assert.deepStrictEqual(plain(prof.center), { action: 'tasks', label: '' }, 'the answer has a center, so it is used');
        assert.strictEqual(page.def.viewDepth(d), 0, 'the view closes and the manager is drawn again');
        assert(/data-act="sk-gen"/.test(el.html));
        assert.strictEqual(page.state.barConfig.length, 0, 'nothing is saved by Use');
        assert.strictEqual(d.skSaved, savedBefore);
        assert.notStrictEqual(JSON.stringify(d.sk.profiles), d.skSaved, 'the draft differs from what was saved: ok saves it');
        page.def.commit(d);
        assert.strictEqual(page.state.barConfig.length, 1);
        assert.strictEqual(page.state.barConfig[0].softProfiles['com.example.shop'].right.menu[1].action, 'sep');
        ok('Use this profile fills the draft, closes the view, saves nothing by itself; ok (commit) writes it');

        // what she typed is kept for the next time
        el.node('[data-act="sk-gen"]').fire('click');
        assert.strictEqual(d.sk.gen.wish, 'Open my subscriptions from the left key');
        assert.strictEqual(d.sk.gen.designOn, true);
        ok('closing the view keeps her request for the next time');
    }

    // keep her center when the answer leaves it empty
    {
        const noCenter = JSON.parse(JSON.stringify(GOOD)); delete noCenter.profile.center;
        const page = makePage({ profiles: profilesFixture(), server: { handle: async (type) => (type === 'softkeys_generate' ? noCenter : undefined) } });
        const { d, el } = openDialog(page);
        d.sk.profiles['com.example.shop'].center = { action: 'home', label: 'Mine' };
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase === 'result', 'the result');
        assert(!el.text().includes('Center button'), 'no center row in the result');
        assert(el.text().includes('A key that is not listed stays as it is now.'));
        d.sk.gen.paint = () => {};
        page.def.softKeys(d).left.action();
        assert.deepStrictEqual(plain(d.sk.profiles['com.example.shop'].center), { action: 'home', label: 'Mine' });
        assert(!page.state.sent.some((s) => s.type === 'softkeys_default_set'), 'no default is sent unless asked');
        ok('her center stays when the answer leaves it empty; the default is sent only when she asked');
    }

    // the phone refuses a key
    {
        const page = makePage({ profiles: profilesFixture(), server: { handle: async (type) => (type === 'softkeys_generate' ? GOOD : undefined) } });
        page.probe.verdict = (a) => (a === 'tasks' ? { action: a, ok: false, why: 'Running Programs is not allowed here.' } : { action: a, ok: true, why: '' });
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase === 'result', 'the result');
        const t = el.text();
        assert(t.includes('Center button: Running Programs is not allowed here.') || t.some((x) => /^Center button: .*Running Programs is not allowed here\.$/.test(x)), t.join(' | '));
        assert(!t.some((x) => /^Center button: <?Running Programs>?( |$)/.test(x) && !/not allowed/.test(x)));
        assert.strictEqual(d.sk.gen.result.keys.center, null);
        ok('a key the phone refuses is listed under "Could not make" with the phone\'s reason, not in the profile');
    }

    // errors stay in the view
    const errCase = async (name, opts, expectRe, arrange) => {
        const page = makePage(Object.assign({ profiles: profilesFixture() }, opts));
        if (arrange) arrange(page);
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState !== 'loading', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase !== 'running' && d.sk.gen.error, `${name} to end`);
        assert.strictEqual(d.sk.gen.phase, 'form', name);
        assert(expectRe.test(d.sk.gen.error), `${name}: ${d.sk.gen.error}`);
        assert(expectRe.test(el.text().join(' ')), `${name}: shown in the view`);
        assert.strictEqual(page.def.viewDepth(d), 1, `${name}: the view stays open`);
        assert(/data-act="gen-go"/.test(el.html) && !/data-act="gen-go"[^>]*disabled/.test(el.html), `${name}: Generate is back`);
        assert.strictEqual(page.window.liveListeners('softkeyprobe'), 0, `${name}: no listener`);
        assert.strictEqual(page.timers.size, 0, `${name}: no timer`);
        return page;
    };
    await errCase('no bridge', { noProbe: true }, /cannot read programs on the phone yet\. Update the app/);
    await errCase('probe throws', {}, /could not read the program\. bridge broke/, (p) => { p.probe.mode = 'fail'; });
    await errCase('probe returns no id', {}, /could not start reading/, (p) => { p.probe.mode = 'empty'; });
    await errCase('probe not ok', {}, /could not read Shop\. no permission/, (p) => { p.probe.mode = 'notok'; });
    await errCase('server error', { server: { handle: async (type) => { if (type === 'softkeys_generate') throw new Error('DeepSeek said: quota used up'); } } }, /DeepSeek said: quota used up\. Check the engine and model/);
    await errCase('success false', { server: { handle: async (type) => (type === 'softkeys_generate' ? { success: false, error: 'Bad key' } : undefined) } }, /Bad key\. Check the engine/);
    await errCase('no profile', { server: { handle: async (type) => (type === 'softkeys_generate' ? { engine: 'x' } : undefined) } }, /answer had no soft keys/);
    await errCase('phone check fails', { server: { handle: async (type) => (type === 'softkeys_generate' ? GOOD : undefined) } }, /did not check the answer/, (p) => { p.probe.check = () => 'not json'; });
    await errCase('no engine ready', { server: { engines: { engines: [{ id: 'openai', name: 'OpenAI', defaultModel: 'gpt-x', ready: false, models: [] }], saved: { engine: '', model: '' } } } }, /No AI engine has a key yet\. Add a key/);
    await errCase('engines fail to load', { server: { handle: async (type) => { if (type === 'softkeys_engines') throw new Error('socket closed'); } } }, /socket closed/);
    ok('errors end in the view as plain text with what to do (no bridge, probe failures, server errors, no phone check, no key, engines unreadable), the view stays open, Generate is back, no listener or timer is left');

    // a no-key engine is not sent
    {
        const page = makePage({ profiles: profilesFixture() });
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-engine"]').combo.onPick('openai');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase !== 'running', 'the end');
        assert(/OpenAI has no key\. Pick another engine/.test(d.sk.gen.error));
        assert.deepStrictEqual(plain(page.state.sent.map((s) => s.type)), ['softkeys_engines']);
        ok('an engine marked (no key) is not asked: the view says so');
    }

    // a probe that answers before read() returns, and one that never answers (30 s), and the hard stop (120 s)
    {
        const page = makePage({ profiles: profilesFixture(), server: { handle: async (type) => (type === 'softkeys_generate' ? GOOD : undefined) } });
        page.probe.mode = 'sync';
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase === 'result', 'the result');
        ok('an answer that comes before read() returns its id is not lost');
    }
    {
        const page = makePage({ profiles: profilesFixture() });
        page.probe.mode = 'silent';
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await tick();
        assert.strictEqual(d.sk.gen.phase, 'running');
        page.window.liveListeners('softkeyprobe') === 1 || assert.fail('one probe listener while waiting');
        // Close during the run ends it: the listener and timers go, and the late answer is ignored
        const k = page.def.softKeys(d);
        k.right.action();
        assert.strictEqual(page.def.viewDepth(d), 0);
        await tick(); await tick();
        assert.strictEqual(page.window.liveListeners('softkeyprobe'), 0, 'Close removed the listener');
        assert.strictEqual(page.timers.size, 0, 'Close cleared the timers');
        ok('Close in the middle of a run ends it: no listener, no timer, nothing drawn later');
    }
    {
        // the phone never answers the probe: the 30 s wait (20 ms here) ends with an error line
        const page = makePage({ profiles: profilesFixture(), fastProbe: 20 });
        page.probe.mode = 'silent';
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase !== 'running' && d.sk.gen.error, 'the probe wait');
        assert(/did not answer in 30 seconds\. Try again/.test(d.sk.gen.error), d.sk.gen.error);
        assert.strictEqual(page.window.liveListeners('softkeyprobe'), 0);
        assert.strictEqual(page.timers.size, 0);
        ok('a phone that never answers the probe ends the wait after 30 s with an error line, the listener removed');
    }
    {
        // the hard stop: the 120 s timer (shortened to 20 ms by the test's timer) with a server that never answers
        const page = makePage({ profiles: profilesFixture(), fastTimeout: 25, server: { handle: (type) => (type === 'softkeys_generate' ? new Promise(() => {}) : undefined) } });
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        el.node('[data-act="gen-go"]').fire('click');
        await until(() => d.sk.gen.phase !== 'running', 'the hard stop');
        assert(/took longer than 2 minutes, so it was stopped\. Try again/.test(d.sk.gen.error));
        assert.strictEqual(page.timers.size, 0);
        assert.strictEqual(page.window.liveListeners('softkeyprobe'), 0);
        ok('the hard stop ends a run that never answers with an error line, and nothing is left running');
    }

    // back key, ok
    {
        const page = makePage({ profiles: profilesFixture() });
        const { d, el } = openDialog(page);
        el.node('[data-act="sk-gen"]').fire('click');
        await until(() => d.sk.gen.engState === 'ok', 'the engines');
        assert.strictEqual(page.def.back(d), true);
        assert.strictEqual(page.def.viewDepth(d), 0);
        assert.strictEqual(page.def.back(d), false, 'with no view the back key leaves the page as before');
        el.node('[data-act="sk-gen"]').fire('click');
        assert.strictEqual(page.def.viewOk(d), true);
        assert.strictEqual(page.def.viewDepth(d), 0);
        assert.strictEqual(page.def.viewOk(d), false);
        ok('the back key and the corner ok close the view; with no view they are the page\'s');
    }

    console.log(`softkey generate UI: ${step} checks passed`);
})().catch((err) => { console.error(err); process.exit(1); });
