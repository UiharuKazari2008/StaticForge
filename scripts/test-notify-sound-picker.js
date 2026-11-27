#!/usr/bin/env node
/**
 * The Notification sound picker (StaticForge #1298, public/scripts/comp/wmNotifySound.js) against a fake phone page and a
 * fake AndroidSounds bridge (3 categories, 120 sounds in one). Runs the real script; no sound is played.
 *
 *   node scripts/test-notify-sound-picker.js [path/to/wmNotifySound.js]
 *
 * Covers: the row only where the bridge exists; level 1 lists the two defaults and the categories, never a sound; a
 * category shows 50 + Show more and pages on; search goes through the bridge, debounced; Select writes
 * AndroidSounds.set('sound', id, title, category) on commit; None and Event sounds map to their modes; Back goes up a
 * level and then leaves; a preview starts only from a tap and stops when the picker or the page is left; the Play / Stop
 * button follows the androidsoundpreview event; the settings hooks (viewDepth, softKeys, back, viewOk) the shell uses;
 * the screen off / page hidden / behind an Android program end the preview only; the sound in use is pinned as the first
 * row of its category; opening the picker stops the Notifications tab's preview; every way out sends stop to the app.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// an optional path argument runs the same checks on another copy of the file (to prove they can fail)
const SRC = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp/wmNotifySound.js'), 'utf8');

// ---------------------------------------------------------------- the fake bridge
function makeBridge(opts = {}) {
    const calls = [];
    const sounds = {
        notification: Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, title: `Notify ${String(i).padStart(3, '0')}${i % 10 === 7 ? ' chime' : ''}` })),
        ringtone: [{ id: 'r0', title: 'Old phone' }, { id: 'r1', title: 'Chime ring' }],
        melaton: [{ id: 'm0', title: 'Melaton Ding' }]
    };
    const cats = [{ id: 'notification', label: 'Notifications', count: 120 }, { id: 'ringtone', label: 'Ringtones', count: 2 }, { id: 'melaton', label: 'Melaton', count: 1 }];
    let current = opts.current || { mode: 'default', id: '', title: '', category: '' };
    const b = {
        calls,
        version: () => { calls.push(['version']); return '1'; },
        categories: () => { calls.push(['categories']); return JSON.stringify(cats); },
        list: (cat, q, offset, limit) => {
            calls.push(['list', cat, q, offset, limit]);
            const all = (sounds[cat] || []).filter((s) => !q || s.title.toLowerCase().includes(String(q).toLowerCase()));
            return JSON.stringify({ total: all.length, items: all.slice(offset, offset + limit) });
        },
        get: () => { calls.push(['get']); return JSON.stringify(current); },
        set: (mode, id, title, category) => { calls.push(['set', mode, id, title, category]); if (opts.refuse) return false; current = { mode, id, title, category }; return true; },
        preview: (id) => { calls.push(['preview', id]); return true; },
        stop: () => { calls.push(['stop']); return true; },
        playing: () => ''
    };
    return b;
}

// ---------------------------------------------------------------- the fake page
function makePage(bridge) {
    const listeners = new Map(); // event -> [{ fn, signal, who }]
    const timers = [];
    let seq = 0;
    const addOn = (who) => (type, fn, o) => { (listeners.get(type) || listeners.set(type, []).get(type)).push({ fn, signal: o && o.signal, who }); };
    const add = addOn('window');
    const fire = (type, detail) => (listeners.get(type) || []).filter((l) => !(l.signal && l.signal.aborted)).forEach((l) => l.fn({ type, detail }));
    const live = (type, who) => (listeners.get(type) || []).filter((l) => !(l.signal && l.signal.aborted) && (!who || l.who === who)).length;
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const ui = {
        esc,
        comboHtml: (act, label) => `<button type="button" class="wm-combo" data-act="${esc(act)}"><span>${esc(label)}</span></button>`,
        row: (label, control, o = {}) => `<div class="wm-form-row${o.wide ? ' is-wide' : ''}"><span class="wm-form-label">${esc(label)}</span>${control}</div>`,
        edit: (id, value, attrs = '') => `<input id="${esc(id)}" class="wm-edit" type="text" value="${esc(value)}" ${attrs}>`,
        note: (t) => `<p class="wm-form-note">${esc(t)}</p>`,
        gap: () => '<div class="wm-form-gap"></div>'
    };
    // a list element with the bits the picker touches
    const list = { scrollTop: 0, innerHTML: '' };
    const input = { value: '', handlers: {}, addEventListener(t, fn) { this.handlers[t] = fn; } };
    const playButton = { classes: new Set(), attrs: {}, classList: { contains: (c) => playButton.classes.has(c), toggle: (c, on) => { if (on) playButton.classes.add(c); else playButton.classes.delete(c); } }, getAttribute: (k) => playButton.attrs[k], setAttribute: (k, v) => { playButton.attrs[k] = v; } };
    const root = {
        _html: '',
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = v; list.innerHTML = (/<div class="wm-listbox wmns-list"[^>]*>([\s\S]*)<\/div>$/.exec(v) || [])[1] || ''; },
        handlers: {},
        addEventListener(t, fn) { this.handlers[t] = fn; },
        querySelector(sel) {
            if (sel === '.wmns-list') return list;
            if (sel === '#wmns-q') return /id="wmns-q"/.test(this._html) ? input : null;
            if (sel === '.wmns-play') return /wmns-play/.test(list.innerHTML) ? playButton : null;
            return null;
        }
    };
    const keyOf = (key) => ({ target: { closest: (s) => (s === '[data-key]' ? { dataset: { key } } : null) } });
    const sk = { refreshed: 0 };
    const window = {
        uiShell: 'mobile',
        addEventListener: add,
        wmSettings: { ui },
        wmShell: { refreshSoftKeys: () => { sk.refreshed += 1; }, sounds: { stop: () => { sk.wmStopped += 1; } } },
        AndroidSounds: bridge
    };
    sk.wmStopped = 0;
    // hidden / documentElement.dataset are what the page reads for "not seen" (the screen off, behind an Android program)
    const document = { addEventListener: addOn('document'), hidden: false, documentElement: { dataset: {} } };
    const ctx = {
        window, document, console, Promise, JSON, Map, Set, String, Number, Array, Object, Math, Date, AbortController,
        setTimeout: (fn, ms) => { const t = { id: ++seq, fn, ms }; timers.push(t); return t.id; },
        clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'wmNotifySound.js' });
    const page = {
        window, document, root, list, input, playButton, timers, sk,
        ns: window.wmNotifySound,
        rerenders: 0,
        // the Settings page: an api whose rerender draws the picker (or the row) again, as renderPage does
        api: null,
        draw(d) { root.handlers = {}; this.ns.viewDepth(d) ? this.ns.render(root, d, this.api) : (root.innerHTML = this.ns.rowHtml(d)); },
        tap: (key) => root.handlers.click(keyOf(key)),
        tapPlay: () => root.handlers.click({ target: { closest: (s) => (s === '.wmns-play' ? {} : null) } }),
        type(text) { input.value = text; input.handlers.input(); },
        flush() { const due = timers.splice(0); due.forEach((t) => t.fn()); },
        fire, live
    };
    page.api = { rerender: () => { page.rerenders += 1; } };
    return page;
}

// objects made inside the vm context have another prototype: compare their JSON
const plain = (x) => JSON.parse(JSON.stringify(x));
const keys = (html) => [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
const names = (b, n) => b.calls.filter((c) => c[0] === n);
let step = 0;
const ok = (msg) => console.log(`  ${++step}. ${msg}`);

function fresh(opts, bridgeOpts) {
    const bridge = opts === null ? null : makeBridge(bridgeOpts || {});
    const p = makePage(bridge);
    const d = {};
    p.ns.init(d);
    p.draw(d);
    return { p, d, b: bridge };
}

async function main() {
    // ---------------------------------------------------------------- 1. no bridge, no row
    {
        const { p, d } = fresh(null);
        assert.strictEqual(d.nsound, null);
        assert.strictEqual(p.ns.rowHtml(d), '', 'no AndroidSounds: the row is not drawn');
        assert.strictEqual(p.ns.viewDepth(d), 0);
        assert.strictEqual(p.ns.available(), false);
        ok('without window.AndroidSounds the page has no row and no picker');
    }

    // ---------------------------------------------------------------- 2. the row
    {
        const { p, d, b } = fresh({}, { current: { mode: 'sound', id: 'm0', title: 'Melaton Ding', category: 'melaton' } });
        const html = p.ns.rowHtml(d);
        assert(html.includes('Notification sound:'), 'label');
        assert(html.includes('class="wm-combo"') && html.includes('data-act="nsound"') && html.includes('Melaton Ding'), 'a combo-looking button with the current choice');
        assert(!html.includes('<select'), 'never a <select>');
        assert(html.includes('Used by notifications that have no sound of their own on the Notifications tab.'), 'the note');
        assert.strictEqual(names(b, 'categories').length, 0, 'categories() is not asked for until the picker opens');
        assert.strictEqual(names(b, 'list').length, 0, 'nothing is listed before it is needed');
        const dflt = fresh({}, {});
        assert(dflt.p.ns.rowHtml(dflt.d).includes('<span>Event sounds</span>'), 'default reads Event sounds');
        const none = fresh({}, { current: { mode: 'none', id: '', title: '', category: '' } });
        assert(none.p.ns.rowHtml(none.d).includes('<span>None</span>'), 'none reads None');
        ok('the row: label, combo button with the choice (Event sounds / None / the sound), the note, no bridge reads beyond get()');
    }

    // ---------------------------------------------------------------- 3. level 1 lists no sound
    {
        const { p, d, b } = fresh({}, { current: { mode: 'sound', id: 'r1', title: 'Chime ring', category: 'ringtone' } });
        p.ns.bindRow({ querySelector: () => ({ addEventListener: (t, fn) => fn() }) }, d, p.api);
        assert.strictEqual(p.ns.viewDepth(d), 1, 'the picker is open at level 1');
        assert.strictEqual(p.rerenders, 1);
        assert.strictEqual(names(b, 'categories').length, 1, 'categories() once per open');
        p.draw(d);
        const html = p.root.innerHTML;
        assert.deepStrictEqual(keys(html), ['default', 'none', 'cat:notification', 'cat:ringtone', 'cat:melaton']);
        assert(html.includes('Event sounds (default)') && html.includes('>None<'), 'the two defaults');
        assert(html.includes('Notifications') && html.includes('Ringtones') && html.includes('Melaton'), 'category labels');
        assert(html.includes('wmns-count">120<') && html.includes('wmns-count">2<'), 'counts');
        assert.strictEqual((html.match(/wmns-chevron/g) || []).length, 3, 'a chevron on each category');
        assert(!/Notify 0|Old phone|Chime ring|Melaton Ding/.test(html), 'level 1 names no individual sound');
        assert.strictEqual(names(b, 'list').length, 0, 'level 1 reads no sound list');
        // the tick: the category the chosen sound belongs to; the highlight starts on it
        assert(/wmns-row is-selected is-chosen"[^>]*data-key="cat:ringtone"/.test(html), 'the chosen sound\'s category is highlighted and ticked');
        assert(!/data-key="default"[^>]*>(<span class="wmns-mark is-chosen")/.test(html) && !/is-chosen"[^>]*data-key="default"/.test(html), 'Event sounds is not ticked');
        assert.strictEqual(p.ns.viewTitle(d), 'Notification sound');
        const keysNow = p.ns.softKeys(d);
        assert.strictEqual(keysNow.left.label, 'Select');
        assert.strictEqual(keysNow.right.label, 'Back');
        assert(!keysNow.left.disabled);
        ok('level 1: Event sounds, None, the categories with count + chevron, never a sound; the tick and the highlight on the choice\'s category; soft keys Select / Back');
    }

    // ---------------------------------------------------------------- 4. a category: 50 + Show more, paging
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open();
        p.draw(d);
        p.tap('cat:notification'); // highlights
        assert.strictEqual(p.ns.viewDepth(d), 1, 'a tap on a category only highlights it');
        p.ns.softKeys(d).left.action(); // Select opens it
        assert.strictEqual(p.ns.viewDepth(d), 2);
        assert.deepStrictEqual(names(b, 'list')[0], ['list', 'notification', '', 0, 50], 'asked for 50, from 0');
        p.draw(d);
        let ks = keys(p.root.innerHTML);
        assert.strictEqual(ks.filter((k) => k.startsWith('s:')).length, 50, '50 sounds');
        assert.strictEqual(ks[ks.length - 1], 'more', 'Show more ends the list');
        assert(p.root.innerHTML.includes('Show more'));
        assert(p.root.innerHTML.includes('id="wmns-q"'), 'the search box at the top');
        assert.strictEqual(p.ns.viewTitle(d), 'Notifications');
        p.tap('more');
        assert.deepStrictEqual(names(b, 'list')[1], ['list', 'notification', '', 50, 50]);
        ks = keys(p.list.innerHTML);
        assert.strictEqual(ks.filter((k) => k.startsWith('s:')).length, 100);
        assert.strictEqual(ks[ks.length - 1], 'more');
        p.tap('more');
        ks = keys(p.list.innerHTML);
        assert.strictEqual(ks.filter((k) => k.startsWith('s:')).length, 120);
        assert(!ks.includes('more'), 'all shown: no Show more');
        assert(names(b, 'list').every((c) => c[4] <= 50), 'never more than 50 at a time');
        assert.strictEqual(p.rerenders, 2, 'a page of sounds repaints the list only, not the whole page');
        ok('a category: 50 sounds + Show more, then 100, then all 120 with no Show more; the list repaints in place');
    }

    // ---------------------------------------------------------------- 5. search through the bridge, debounced
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open();
        p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification'); // the second tap opens it
        p.draw(d);
        const before = names(b, 'list').length;
        p.type('c'); p.type('ch'); p.type('chime');
        assert.strictEqual(p.timers.length, 1, 'one pending search, each key restarts it');
        assert.strictEqual(p.timers[0].ms, 250);
        assert.strictEqual(names(b, 'list').length, before, 'nothing asked until the pause');
        p.flush();
        const last = names(b, 'list').pop();
        assert.deepStrictEqual(last, ['list', 'notification', 'chime', 0, 50]);
        const found = keys(p.list.innerHTML).filter((k) => k.startsWith('s:'));
        assert.strictEqual(found.length, 12, '12 titles hold "chime"');
        assert(!keys(p.list.innerHTML).includes('more'));
        p.type('zzz'); p.flush();
        assert(p.list.innerHTML.includes('No sound matches.'));
        p.type(''); p.flush();
        assert.strictEqual(keys(p.list.innerHTML).filter((k) => k.startsWith('s:')).length, 50, 'cleared: the first page again');
        assert.strictEqual(p.rerenders, 2, 'typing never redraws the page (the box keeps its focus)');
        ok('search: debounced 250 ms, goes through list(cat, query, 0, 50), no match is said, clearing returns the first page, the box is not redrawn');
    }

    // ---------------------------------------------------------------- 6. highlight + preview, Select writes on commit
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open();
        p.draw(d);
        p.tap('cat:ringtone'); p.tap('cat:ringtone');
        p.draw(d);
        assert.strictEqual(names(b, 'preview').length, 0, 'opening a category plays nothing');
        assert(p.ns.softKeys(d).left.disabled, 'nothing highlighted: Select is off');
        p.tap('s:r1');
        assert.deepStrictEqual(names(b, 'preview'), [['preview', 'r1']], 'a tap on a row plays it');
        assert(!p.ns.softKeys(d).left.disabled);
        assert(/is-selected[^>]*data-key="s:r1"/.test(p.list.innerHTML), 'the row is highlighted');
        assert.strictEqual((p.list.innerHTML.match(/wmns-play/g) || []).length, 1, 'Play on the highlighted row only');
        assert(p.list.innerHTML.includes('aria-label="Play"'));
        // the app's event drives Stop
        p.fire('androidsoundpreview', { id: 'r1', state: 'playing' });
        assert(p.playButton.classes.has('is-playing') && p.playButton.attrs['aria-label'] === 'Stop', 'Stop while it plays');
        p.tapPlay();
        assert.strictEqual(names(b, 'stop').length, 1, 'Stop asks the app to stop');
        p.fire('androidsoundpreview', { id: 'r1', state: 'stopped' });
        assert(!p.playButton.classes.has('is-playing') && p.playButton.attrs['aria-label'] === 'Play', 'Play again once it stopped');
        p.tapPlay();
        assert.strictEqual(names(b, 'preview').length, 2, 'Play plays it again');
        p.tap('s:r0');
        assert.deepStrictEqual(names(b, 'preview').pop(), ['preview', 'r0'], 'another row: that one plays');
        // Select
        p.ns.softKeys(d).left.action();
        assert.strictEqual(p.ns.viewDepth(d), 0, 'Select returns to the page');
        assert.deepStrictEqual(plain(d.nsound), { mode: 'sound', id: 'r0', title: 'Old phone', category: 'ringtone' });
        assert.strictEqual(names(b, 'set').length, 0, 'nothing is written until the page is saved (ok)');
        assert(names(b, 'stop').length >= 2, 'leaving the picker stopped the preview');
        assert.strictEqual(p.live('androidsoundpreview'), 0, 'the preview listener went with the picker');
        assert.strictEqual(p.ns.changed(d), true);
        assert.strictEqual(await (p.ns.commit(d)), true);
        assert.deepStrictEqual(names(b, 'set'), [['set', 'sound', 'r0', 'Old phone', 'ringtone']], 'AndroidSounds.set(sound, id, title, category)');
        assert.strictEqual(p.ns.changed(d), false);
        await (p.ns.commit(d));
        assert.strictEqual(names(b, 'set').length, 1, 'saved again unchanged: no second write');
        ok('tap = highlight + preview; Play / Stop follow the app\'s event; Select chooses and leaves; commit writes set(sound, id, title, category) once');
    }

    // ---------------------------------------------------------------- 7. None and Event sounds
    {
        const { p, d, b } = fresh({}, { current: { mode: 'sound', id: 'n3', title: 'Notify 003', category: 'notification' } });
        d.nsoundUi.host = p.api;
        d.nsoundUi.open();
        p.draw(d);
        p.tap('none');
        p.ns.softKeys(d).left.action();
        assert.deepStrictEqual(plain(d.nsound), { mode: 'none', id: '', title: '', category: '' });
        assert.strictEqual(p.ns.viewDepth(d), 0);
        await (p.ns.commit(d));
        assert.deepStrictEqual(names(b, 'set').pop(), ['set', 'none', '', '', '']);
        d.nsoundUi.open();
        p.tap('default'); p.tap('default'); // the second tap on a default row is Select
        assert.deepStrictEqual(plain(d.nsound), { mode: 'default', id: '', title: '', category: '' });
        await (p.ns.commit(d));
        assert.deepStrictEqual(names(b, 'set').pop(), ['set', 'default', '', '', '']);
        assert.strictEqual(names(b, 'list').length, 0, 'choosing a default never lists a sound');
        ok('None and Event sounds map to set(none) / set(default) with empty id, title and category');
    }

    // ---------------------------------------------------------------- 8. Back goes up one level, then leaves; previews stop
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open();
        p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification');
        p.draw(d);
        p.tap('s:n4');
        assert.strictEqual(names(b, 'preview').length, 1);
        p.fire('androidsoundpreview', { id: 'n4', state: 'playing' });
        assert.strictEqual(p.ns.back(d), true, 'level 2 -> level 1');
        assert.strictEqual(p.ns.viewDepth(d), 1);
        assert.strictEqual(names(b, 'stop').length, 1, 'going up stops the preview');
        assert.strictEqual(d.nsound.mode, 'default', 'Back chooses nothing');
        p.draw(d);
        assert(/is-selected[^>]*data-key="cat:notification"/.test(p.root.innerHTML), 'the category it came from stays highlighted');
        assert.strictEqual(p.ns.back(d), true, 'level 1 -> the page');
        assert.strictEqual(p.ns.viewDepth(d), 0);
        assert.strictEqual(p.ns.back(d), false, 'on the page, back is the page\'s (it saves and closes)');
        assert.strictEqual(p.live('wmAppChange'), 0, 'no listener is left');
        // the corner ok: confirms the layer
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification'); p.draw(d);
        assert.strictEqual(p.ns.viewOk(d), true);
        assert.strictEqual(p.ns.viewDepth(d), 1, 'ok with nothing highlighted goes up one level');
        p.draw(d);
        p.tap('none');
        assert.strictEqual(p.ns.viewOk(d), true);
        assert.strictEqual(d.nsound.mode, 'none', 'ok on a default row chooses it and leaves');
        assert.strictEqual(p.ns.viewDepth(d), 0);
        assert.strictEqual(p.ns.viewOk(d), false, 'no picker open: ok is the page\'s');
        ok('Back: level 2 -> 1 -> the page, then the page\'s own; the preview stops on the way; ok confirms a layer');
    }

    // ---------------------------------------------------------------- 9. leaving the page, or Settings, stops previews
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open();
        p.draw(d);
        p.tap('cat:melaton'); p.tap('cat:melaton'); p.draw(d);
        p.tap('s:m0');
        assert.strictEqual(names(b, 'preview').length, 1);
        p.ns.stop(d); // the page is saved or left
        assert.strictEqual(p.ns.viewDepth(d), 0);
        assert.strictEqual(names(b, 'stop').length, 1, 'commit / leave stops the preview');
        // another program in front
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:melaton'); p.tap('cat:melaton'); p.draw(d);
        p.tap('s:m0');
        p.fire('wmAppChange', { id: 'today', prev: 'settings' });
        assert.strictEqual(p.ns.viewDepth(d), 0, 'Settings left: the picker closes');
        assert.strictEqual(names(b, 'stop').length, 2, 'and the preview stops');
        assert.strictEqual(p.live('androidsoundpreview'), 0);
        // saving while a preview plays
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:melaton'); p.tap('cat:melaton'); p.draw(d);
        p.tap('s:m0');
        await (p.ns.commit(d));
        assert.strictEqual(names(b, 'stop').length, 3, 'saving stops it');
        assert.strictEqual(names(b, 'set').length, 0, 'nothing changed, nothing written');
        ok('previews stop when the page is saved or left and when another program comes forward; no listener stays');
    }

    // ---------------------------------------------------------------- 10. a refused save keeps the page open and says so once
    {
        const { p, d, b } = fresh({}, { refuse: true });
        d.nsound = { mode: 'none', id: '', title: '', category: '' };
        const said = [];
        const r = await (p.ns.commit(d, (o) => { said.push(o); return Promise.resolve(); }));
        assert.strictEqual(r, false);
        assert.strictEqual(said.length, 1);
        assert(/could not be saved/.test(said[0].text) && said[0].icon === 'error');
        assert.strictEqual(p.ns.changed(d), true, 'still unsaved');
        ok('a refusal from the app is told once, in words, and the page stays open');
    }

    // ---------------------------------------------------------------- 11. no sound without a tap, no notice of any kind
    {
        const { p, d, b } = fresh({}, { current: { mode: 'sound', id: 'n2', title: 'Notify 002', category: 'notification' } });
        d.nsoundUi.host = p.api;
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.draw(d); // already highlighted (it holds the sound in use): this tap opens it
        assert.strictEqual(p.ns.viewDepth(d), 2);
        assert(/is-selected is-chosen"[^>]*data-key="s:n2"/.test(p.list.innerHTML), 'the sound in use is highlighted and ticked');
        assert.strictEqual(names(b, 'preview').length, 0, 'opening the picker on a chosen sound plays nothing');
        assert(!/toast|messageBox|appNote|notify\(|new Audio/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the picker raises no notice itself');
        ok('opening the picker plays nothing; the sound in use is highlighted and ticked; no notice sites in the file');
    }

    // ---------------------------------------------------------------- 12. the screen off, the page hidden or an Android program in front end the preview only
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:melaton'); p.tap('cat:melaton'); p.draw(d);
        assert.strictEqual(p.live('melatonscreen', 'window'), 1, 'melatonscreen is heard on window');
        assert.strictEqual(p.live('visibilitychange', 'document'), 1, 'visibilitychange on document');
        assert.strictEqual(p.live('wmBehind', 'document'), 1, 'wmBehind on document');
        const stops = () => names(b, 'stop').length;
        const way = (label, go) => {
            if (!p.list.innerHTML.includes('is-selected')) p.tap('s:m0');
            else if (!p.playButton.classes.has('is-playing')) p.tapPlay();
            p.fire('androidsoundpreview', { id: 'm0', state: 'playing' });
            assert(p.playButton.classes.has('is-playing'), `${label}: sounding`);
            const before = stops(); const renders = p.rerenders; const html = p.list.innerHTML; const depth = p.ns.viewDepth(d);
            go();
            assert.strictEqual(stops(), before + 1, `${label}: the preview is stopped`);
            assert.strictEqual(p.ns.viewDepth(d), depth, `${label}: the picker stays open where it was`);
            assert.strictEqual(p.rerenders, renders, `${label}: nothing is redrawn`);
            assert.strictEqual(p.list.innerHTML, html, `${label}: the list is as it was`);
            assert(!p.playButton.classes.has('is-playing') && p.playButton.attrs['aria-label'] === 'Play', `${label}: the button is Play again`);
            assert(/is-selected[^>]*data-key="s:m0"/.test(p.list.innerHTML), `${label}: the row is still highlighted`);
        };
        p.tap('s:m0');
        // not away: nothing stops
        p.fire('androidsoundpreview', { id: 'm0', state: 'playing' });
        const base = stops();
        p.fire('visibilitychange', {}); p.fire('melatonscreen', { on: true }); p.fire('wmBehind', { on: false });
        assert.strictEqual(stops(), base, 'visible, screen on, not behind: the preview goes on');
        p.document.hidden = true;
        way('hidden', () => p.fire('visibilitychange', {}));
        p.document.hidden = false;
        way('screen off (event)', () => p.fire('melatonscreen', { on: false }));
        way('behind an Android program (event)', () => p.fire('wmBehind', { on: true }));
        p.document.documentElement.dataset.screenOff = '';
        way('screen off (html[data-screen-off])', () => p.fire('melatonscreen', {}));
        delete p.document.documentElement.dataset.screenOff;
        p.document.documentElement.dataset.wmBehind = '';
        way('behind (html[data-wm-behind])', () => p.fire('wmBehind', {}));
        delete p.document.documentElement.dataset.wmBehind;
        assert.strictEqual(p.ns.viewDepth(d), 2, 'the picker is still open');
        // the listeners go with the picker
        p.ns.back(d); p.ns.back(d);
        assert.strictEqual(p.ns.viewDepth(d), 0);
        for (const t of ['melatonscreen', 'visibilitychange', 'wmBehind', 'wmAppChange', 'androidsoundpreview']) assert.strictEqual(p.live(t), 0, `${t}: no listener after the picker closed`);
        const after = stops();
        p.document.hidden = true; p.fire('visibilitychange', {}); p.fire('melatonscreen', { on: false }); p.fire('wmBehind', { on: true });
        assert.strictEqual(stops(), after, 'a closed picker stops nothing');
        ok('screen off, page hidden and behind an Android program each stop the preview only (picker, row and list untouched, button back to Play); not-away events do nothing; every listener is gone after the picker closes');
    }

    // ---------------------------------------------------------------- 13. the sound in use is the first row of its category
    {
        const cur = { mode: 'sound', id: 'n104', title: 'Notify 104', category: 'notification' }; // on page 3 of 120
        const open = (current) => {
            const w = fresh({}, { current });
            w.d.nsoundUi.host = w.p.api;
            w.d.nsoundUi.open(); w.p.draw(w.d);
            return w;
        };
        const soundKeys = (p) => keys(p.list.innerHTML).filter((k) => k.startsWith('s:'));
        const { p, d, b } = open(cur);
        p.tap('cat:notification'); p.draw(d); // the category holding the sound is highlighted: this tap opens it
        assert.strictEqual(p.ns.viewDepth(d), 2);
        let sk2 = soundKeys(p);
        assert.strictEqual(sk2.length, 51, '50 loaded + the sound in use');
        assert.strictEqual(sk2[0], 's:n104', 'first row');
        assert(/is-selected is-chosen"[^>]*data-key="s:n104"[^>]*>(?:(?!data-key)[\s\S])*Notify 104/.test(p.list.innerHTML), 'it is ticked, highlighted and titled from the choice');
        assert.strictEqual(sk2.filter((k) => k === 's:n104').length, 1);
        assert.strictEqual(names(b, 'preview').length, 0, 'opening the category plays nothing');
        assert(!p.ns.softKeys(d).left.disabled, 'Select is on (the sound in use is highlighted)');
        p.tap('more'); p.tap('more');
        sk2 = soundKeys(p);
        assert.strictEqual(sk2.length, 120, 'all 120 once');
        assert.strictEqual(sk2.filter((k) => k === 's:n104').length, 1, 'it appears once');
        assert.strictEqual(sk2[0], 's:n104', 'the first row stays');
        assert(!keys(p.list.innerHTML).includes('more'));
        // it plays and selects like any sound row
        p.tap('s:n3');
        p.tap('s:n104');
        assert.deepStrictEqual(names(b, 'preview').pop(), ['preview', 'n104'], 'a tap plays the pinned row');
        p.ns.softKeys(d).left.action();
        assert.deepStrictEqual(plain(d.nsound), cur, 'Select on it keeps the choice');
        assert.strictEqual(p.ns.changed(d), false, 'and it is no change to save');
        // with a search text: exactly what the bridge answers
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.draw(d);
        assert.strictEqual(soundKeys(p)[0], 's:n104');
        p.type('chime'); p.flush();
        sk2 = soundKeys(p);
        assert.strictEqual(sk2.length, 12, 'a search lists only what matches');
        assert(!sk2.includes('s:n104'), 'no pinned row with a search text');
        assert(!/is-selected/.test(p.list.innerHTML), 'the highlight went with the row that is not listed');
        p.type(''); p.flush();
        assert.strictEqual(soundKeys(p).length, 51, 'search cleared: the sound in use is pinned again');
        assert.strictEqual(soundKeys(p)[0], 's:n104');
        // among the rows loaded: nothing changes
        const near = open({ mode: 'sound', id: 'n7', title: 'Notify 007 chime', category: 'notification' });
        near.p.tap('cat:notification'); near.p.draw(near.d);
        const nk = soundKeys(near.p);
        assert.strictEqual(nk.length, 50);
        assert.strictEqual(nk[7], 's:n7', 'in its own place');
        assert.strictEqual(nk[0], 's:n0');
        assert(/is-selected is-chosen"[^>]*data-key="s:n7"/.test(near.p.list.innerHTML));
        // a sound of another category is not pinned here
        const other = open({ mode: 'sound', id: 'r1', title: 'Chime ring', category: 'ringtone' });
        other.p.tap('cat:notification'); other.p.tap('cat:notification'); other.p.draw(other.d);
        assert.strictEqual(other.p.ns.viewDepth(other.d), 2);
        assert.strictEqual(soundKeys(other.p).length, 50);
        assert(!soundKeys(other.p).includes('s:r1'), 'not pinned in another category');
        assert.strictEqual(other.p.list.innerHTML.includes('Chime ring'), false);
        // the default and None have nothing to pin
        const dflt = open({ mode: 'default', id: '', title: '', category: '' });
        dflt.p.tap('cat:notification'); dflt.p.tap('cat:notification'); dflt.p.draw(dflt.d);
        assert.strictEqual(soundKeys(dflt.p).length, 50);
        ok('the sound in use further down a category is its first row (ticked, highlighted, plays and selects like any row); once after Show more; not pinned with a search text, in another category, or when already among the rows');
    }

    // ---------------------------------------------------------------- 14. opening the picker ends the other previews of this page
    {
        const { p, d } = fresh({}, {});
        assert.strictEqual(p.sk.wmStopped, 0);
        let click;
        p.ns.bindRow({ querySelector: () => ({ addEventListener: (t, fn) => { click = fn; } }) }, d, p.api);
        click();
        assert.strictEqual(p.sk.wmStopped, 1, 'the Windows Mobile sound preview of the Notifications tab is stopped');
        assert.strictEqual(p.ns.viewDepth(d), 1, 'and the picker is open');
        p.window.wmShell.sounds.stop = () => { throw new Error('boom'); };
        d.nsoundUi.shutdown();
        assert.strictEqual(p.ns.viewDepth(d), 0);
        click();
        assert.strictEqual(p.ns.viewDepth(d), 1, 'a failing stop does not keep the picker from opening');
        delete p.window.wmShell.sounds;
        click();
        assert.strictEqual(p.ns.viewDepth(d), 1, 'a shell without sounds is fine');
        ok('opening the picker stops the Notifications tab\'s preview (guarded: a failing or missing stop never blocks the picker)');
    }

    // ---------------------------------------------------------------- 15. every way out stops the app's preview, whatever the page thinks is sounding
    {
        const { p, d, b } = fresh({}, {});
        d.nsoundUi.host = p.api;
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification'); p.draw(d);
        p.tap('s:n1'); // preview A
        p.fire('androidsoundpreview', { id: 'n1', state: 'playing' });
        p.tap('s:n2'); // preview B (the app has not said anything about it yet)
        p.fire('androidsoundpreview', { id: 'n1', state: 'stopped' }); // A's stop arrives after B was asked for
        const lastCall = () => b.calls.map((c) => c[0]).filter((n) => n === 'preview' || n === 'stop').pop();
        assert.strictEqual(lastCall(), 'preview', 'B was asked for last');
        assert.strictEqual(p.ns.back(d), true);
        assert.strictEqual(lastCall(), 'stop', 'Back stops B although the page lost track of it');
        // Back from level 1, Select, shutdown and the away handlers do the same
        const before = names(b, 'stop').length;
        assert.strictEqual(p.ns.back(d), true);
        assert.strictEqual(names(b, 'stop').length, before + 1, 'leaving level 1 stops too');
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification'); p.draw(d);
        p.tap('s:n1'); p.tap('s:n2');
        p.fire('androidsoundpreview', { id: 'n1', state: 'stopped' });
        const b2 = names(b, 'stop').length;
        p.ns.softKeys(d).left.action(); // Select
        assert.strictEqual(names(b, 'stop').length, b2 + 1, 'Select stops');
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification'); p.draw(d);
        p.tap('s:n1'); p.fire('androidsoundpreview', { id: 'n1', state: 'stopped' });
        const b3 = names(b, 'stop').length;
        p.ns.stop(d); // shutdown
        assert.strictEqual(names(b, 'stop').length, b3 + 1, 'shutdown stops');
        d.nsoundUi.open(); p.draw(d);
        p.tap('cat:notification'); p.tap('cat:notification'); p.draw(d);
        p.tap('s:n1'); p.fire('androidsoundpreview', { id: 'n1', state: 'stopped' });
        const b4 = names(b, 'stop').length;
        p.document.hidden = true; p.fire('visibilitychange', {});
        assert.strictEqual(names(b, 'stop').length, b4 + 1, 'the away handler stops');
        ok('previews A then B, A\'s stopped event, then Back: a stop follows the last preview; Back from level 1, Select, shutdown and the away handlers stop once each');
    }
    console.log(`ok: ${step} checks`);
}

main().catch((err) => { console.error(err); process.exit(1); });
