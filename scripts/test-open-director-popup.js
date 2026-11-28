#!/usr/bin/env node
'use strict';
/*
 * Yozora #1319 findings 4 (mobile) and 6.
 *
 *  1. The Director status icon's popup (wmShell.js statusBubble 'director'): Open Director with a turn running calls
 *     wmDirectorApp.openSession(persona KEY, session id) with exactly the running chat - Wren's, Kabuki's (the server's
 *     persona word, else the chat's row) or Yozora's - and nothing else (no open('director') first, no remembered chat);
 *     idle, or when openSession cannot land, it is the app as it was left (open('director')).
 *  2. status-popups.js (the app's own copy of that popup) carries the same target as open { app, persona, sessionId }.
 *  3. wmDirector.js in a fake page: openSession lands on the persona first and then the chat, the page covered
 *     meanwhile (nothing of the chat she last had shows), also when the app is not yet shown; the melatonopenapp
 *     payload of the app's popup does the same. The Sessions page carries one tab per persona that can be chosen, the
 *     one in use marked, a tap switches the persona and the list is hers (scroll position kept per persona), and the
 *     tabs follow director.js's paintPersonaToggle.
 *  4. cursorDirector.js directorStatus names the persona (wren | kabuki) of the running chat.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The source of `function name(...) { ... }` (brace matched; the bodies here hold no braces in strings). */
function extractFunction(src, name) {
    const at = src.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `${name} is in the source`);
    let i = src.indexOf('{', src.indexOf(')', at));
    let depth = 0;
    const from = at;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(from, i + 1); }
    }
    throw new Error(`${name} does not close`);
}

const plain = (x) => JSON.parse(JSON.stringify(x)); // arrays made inside the fake page have its own Array
const tick = () => new Promise((resolve) => setImmediate(resolve));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

// ===================================================================== 1. the popup's Open (wmShell.js)
const shellSrc = read('public/scripts/comp/wmShell.js');
assert.ok(/const links = apps\.has\('director'\) \? \[directorOpenLink\(\)\] : \[\];/.test(shellSrc), "the popup's Open is directorOpenLink()");
assert.ok(!/label: 'Open Director', action: \(\) => open\('director'\)/.test(shellSrc), "no bare open('director') link is left in the popup");

function shellWorld(status, win) {
    const calls = [];
    const ctx = {
        window: Object.assign({ directorInstance: null, wmDirectorApp: null, wsClient: null }, win || {}),
        shellDirectorStatus: status, shellDirectorAsked: true,
        statusDirty: () => {}, String, Array, Promise,
        closeBubble: () => calls.push(['closeBubble']),
        open: (id) => calls.push(['open', id])
    };
    vm.createContext(ctx);
    const code = ['runningPersonaKey', 'directorState', 'directorOpenLink'].map((n) => extractFunction(shellSrc, n)).join('\n');
    vm.runInContext(`${code}\nthis.directorState = directorState; this.directorOpenLink = directorOpenLink;`, ctx);
    return {
        calls, ctx,
        setStatus: (s) => { ctx.shellDirectorStatus = s; },
        state: () => ctx.directorState(),
        tap: async () => { ctx.directorOpenLink().action(); await flush(); }
    };
}
const spyApp = (calls, answer) => ({ openSession: (p, id) => { calls.push(['openSession', p, id]); return Promise.resolve(answer); } });

(async () => {
    // a running Wren chat (the server names the persona)
    {
        const calls = [];
        const w = shellWorld({ running: true, sessionId: 'dirc_w1', sessionName: 'Beach', persona: 'wren' }, { wmDirectorApp: spyApp(calls, true) });
        w.calls = calls; w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
        assert.strictEqual(w.directorOpenLink, undefined);
        const st = w.state();
        assert.strictEqual(st.personaKey, 'wren');
        assert.strictEqual(st.sessionId, 'dirc_w1');
        assert.strictEqual(st.persona, 'Director', 'the label the popup prints is unchanged');
        w.ctx.window.wmDirectorApp = spyApp(calls, true);
        await w.tap();
        assert.deepStrictEqual(calls, [['closeBubble'], ['openSession', 'wren', 'dirc_w1']], 'Open lands on the running Wren chat, nothing else');
    }
    // a running Kabuki chat: the server's word, the chat's row, the page's own turn
    {
        const cases = [
            ['the server names her', { running: true, sessionId: 'dirc_k1', persona: 'kabuki' }, null],
            ['the chat row says Obliterated Memories', { running: true, sessionId: 'dirc_k2' }, { directorSessions: [{ id: 'dirc_k2', memoryStore: 'obliterated' }], persona: 'wren' }],
            ['her tab started the turn', { running: true, sessionId: 'dirc_k3' }, { directorSessions: [], persona: 'kabuki', _runningSessionId: 'dirc_k3' }]
        ];
        for (const [why, status, di] of cases) {
            const calls = [];
            const w = shellWorld(status, { directorInstance: di, wmDirectorApp: spyApp(calls, true) });
            w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
            assert.strictEqual(w.state().personaKey, 'kabuki', why);
            await w.tap();
            assert.deepStrictEqual(calls, [['closeBubble'], ['openSession', 'kabuki', status.sessionId]], `${why}: Open lands on her chat`);
        }
    }
    // a Wren chat the list knows is not Kabuki's (no persona word from an older server)
    {
        const w = shellWorld({ running: true, sessionId: 'dirc_w2' }, { directorInstance: { directorSessions: [{ id: 'dirc_w2', memoryStore: null }], persona: 'kabuki' } });
        assert.strictEqual(w.state().personaKey, 'wren');
    }
    // a running Yozora turn
    {
        const calls = [];
        const w = shellWorld({ running: false, xi: { running: true, sessionId: 'xi_1', sessionName: 'Fix' } }, { wmDirectorApp: spyApp(calls, true) });
        w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
        assert.strictEqual(w.state().personaKey, 'xi');
        assert.strictEqual(w.state().persona, 'Yozora');
        await w.tap();
        assert.deepStrictEqual(calls, [['closeBubble'], ['openSession', 'xi', 'xi_1']], 'Open lands on the running Yozora chat');
    }
    // idle: the app as it was left, openSession untouched
    {
        const calls = [];
        const w = shellWorld({ running: false, sessionId: null, persona: null }, { wmDirectorApp: spyApp(calls, true) });
        w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
        assert.strictEqual(w.state().personaKey, null);
        await w.tap();
        assert.deepStrictEqual(calls, [['open', 'director']], 'idle Open is open(director), as before');
    }
    // the turn ended between the popup being drawn and the tap: the status is read again at the tap
    {
        const calls = [];
        const w = shellWorld({ running: true, sessionId: 'dirc_w3', persona: 'wren' }, { wmDirectorApp: spyApp(calls, true) });
        w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
        const link = w.ctx.directorOpenLink();
        w.setStatus({ running: false, sessionId: null });
        link.action();
        await flush();
        assert.deepStrictEqual(calls, [['open', 'director']]);
    }
    // openSession cannot land (the chat is gone): the app opens as it was left rather than nothing
    {
        const calls = [];
        const w = shellWorld({ running: true, sessionId: 'dirc_gone', persona: 'wren' }, { wmDirectorApp: spyApp(calls, false) });
        w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
        await w.tap();
        assert.deepStrictEqual(calls, [['closeBubble'], ['openSession', 'wren', 'dirc_gone'], ['open', 'director']]);
    }
    // no Director app object yet: the app as it was left
    {
        const calls = [];
        const w = shellWorld({ running: true, sessionId: 'dirc_w4', persona: 'wren' }, {});
        w.ctx.closeBubble = () => calls.push(['closeBubble']); w.ctx.open = (id) => calls.push(['open', id]);
        await w.tap();
        assert.deepStrictEqual(calls, [['open', 'director']]);
    }

    // ================================================================= 2. the app's own copy (status-popups.js)
    {
        global.CafeTasks = { lib: {} };
        require(path.join(ROOT, 'public/scripts/tasks/status-popups.js'));
        const build = (f) => global.CafeTasks.lib.statusPopups.build('director', f, {}, new Date());
        assert.deepStrictEqual(build({ director: { running: true, sessionId: 's9', persona: 'kabuki' } }).open, { app: 'director', persona: 'kabuki', sessionId: 's9' });
        assert.deepStrictEqual(build({ director: { running: true, sessionId: 'x1', persona: 'xi' } }).open, { app: 'director', persona: 'xi', sessionId: 'x1' });
        assert.strictEqual(build({ director: { running: false, sessionId: 's9', persona: 'wren' } }).open, undefined, 'idle: no target');
        assert.strictEqual(build({ director: { running: true } }).open, undefined, 'no chat named: no target');
        assert.strictEqual(build({ director: { running: true, sessionId: 's9', persona: 'nobody' } }).open, undefined, 'an unknown persona is no target');
        assert.strictEqual(build({}).sec.length, 2, 'the popup builds from empty inputs');
        assert.deepStrictEqual(build({}).sec[1].links, ['Open']);
    }

    // ================================================================= 3. wmDirector.js in a fake page
    await wmDirectorChecks();

    // ================================================================= 4. the server names the persona
    {
        const os = require('os');
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'open-director-popup-'));
        fs.mkdirSync(path.join(home, '.cache', 'dreamscape-director'), { recursive: true });
        const at = '2026-11-01T00:00:00Z';
        fs.writeFileSync(path.join(home, '.cache', 'dreamscape-director', 'index.json'), JSON.stringify({ chats: [
            { id: 'dirc_w', name: 'Wren chat', messages: [], created_at: at, updated_at: at },
            { id: 'dirc_k', name: 'Chiyo chat', memoryStore: 'obliterated', messages: [], created_at: at, updated_at: at }
        ] }));
        process.env.HOME = home; // directorHome() is under it
        const cd = require('../modules/cursorDirector');
        const runs = cd._test.runs;
        try {
            let st = await cd.directorStatus(false);
            assert.strictEqual(st.running, false);
            assert.strictEqual(st.persona, null, 'idle: no persona');
            runs.set('dirc_k', {});
            st = await cd.directorStatus(false);
            assert.deepStrictEqual([st.running, st.sessionId, st.persona], [true, 'dirc_k', 'kabuki'], "an Obliterated Memories chat is Chiyo's");
            runs.clear(); runs.set('dirc_w', {});
            st = await cd.directorStatus(false);
            assert.deepStrictEqual([st.running, st.sessionId, st.persona], [true, 'dirc_w', 'wren']);
            runs.clear(); runs.set('dirc_unknown', {});
            st = await cd.directorStatus(false);
            assert.strictEqual(st.persona, null, 'a chat the index does not know names no persona (the page then reads its list)');
        } finally { runs.clear(); fs.rmSync(home, { recursive: true, force: true }); }
    }
    console.log('test-open-director-popup: ok');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

// ---------------------------------------------------------------------------------------------- the fake page
function classList() {
    const set = new Set();
    return {
        add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)),
        contains: (c) => set.has(c), toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; if (v) set.add(c); else set.delete(c); return v; },
        has: (c) => set.has(c)
    };
}
/** Any element: unknown methods are no-ops that hand back another one, so the app's own paint code runs unharmed. */
function el(extra) {
    const base = { classList: classList(), dataset: {}, style: {}, children: [], hidden: false, textContent: '', value: '', scrollTop: 0, isConnected: true, parentNode: null };
    const target = Object.assign(base, extra || {});
    return new Proxy(target, {
        get(t, k) {
            if (k in t) return t[k];
            if (typeof k === 'symbol' || k === 'then') return undefined;
            return () => el();
        },
        set(t, k, v) { t[k] = v; return true; }
    });
}

/** A strip / list element that really holds what the app writes into it. */
function stripEl() {
    const handlers = {};
    const s = { buttons: [], dataset: {}, style: {}, classList: classList(), addEventListener: (t, fn) => { handlers[t] = fn; } };
    Object.defineProperty(s, 'innerHTML', {
        get: () => s._html || '',
        set: (html) => {
            s._html = html;
            s.buttons = [...String(html).matchAll(/<button[^>]*class="wm-tab"[^>]*data-persona="([^"]+)"[^>]*aria-selected="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((m) => {
                const attrs = { 'aria-selected': m[2] };
                return { dataset: { persona: m[1] }, textContent: m[3], getAttribute: (a) => attrs[a], setAttribute: (a, v) => { attrs[a] = v; }, closest: () => null, attrs };
            });
            s.buttons.forEach((b) => { b.closest = (sel) => (sel === '.wm-tab' ? b : null); });
        }
    });
    s.querySelectorAll = (sel) => (sel === '.wm-tab' ? s.buttons : []);
    s.click = async (persona) => {
        const b = s.buttons.find((x) => x.dataset.persona === persona);
        assert.ok(b, `a ${persona} tab is drawn`);
        handlers.click({ target: b });
        await flush();
    };
    s.labels = () => s.buttons.map((b) => b.textContent);
    s.selected = () => s.buttons.filter((b) => b.attrs['aria-selected'] === 'true').map((b) => b.dataset.persona);
    return s;
}
function listEl() {
    const s = { scrollTop: 0, dataset: {}, style: {}, classList: classList(), addEventListener() {}, querySelectorAll: () => [] };
    s.innerHTML = '';
    return s;
}

async function wmDirectorChecks() {
    const timers = [];
    const clock = { t: 1000 }; // the page's Date.now(): personaReady waits 12 s of it for a persona that cannot be chosen
    const handlers = new Map();
    const opened = [];
    const events = [];
    const listeners = new Map();
    const pageEl = el({ appended: [] });
    pageEl.appendChild = (n) => { pageEl.appended.push(n); return n; };
    const strips = [];
    const lists = [];
    const winStub = {};
    const doc = {
        hidden: false,
        documentElement: { classList: { contains: (c) => c === 'ui-mobile' }, dataset: { wmBoot: 'done' }, style: { getPropertyValue: () => '' } },
        addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        createElement: () => {
            const e = el();
            // a page the app builds (pushPage): its html is a tab strip and a list
            Object.defineProperty(e, 'innerHTML', {
                get: () => '',
                set: (html) => {
                    if (!/wmd-persona-tabs/.test(html)) return;
                    const st = stripEl(); const li = listEl();
                    strips.push(st); lists.push(li);
                    e.firstChild = st; e.lastChild = li;
                    e.querySelector = (sel) => (sel === '.wmd-persona-tabs' ? st : sel === '.wmd-sessions-list' ? li : null);
                }
            });
            return e;
        },
        body: {}
    };

    // the Director as director.js leaves it for this app: its own persona / sessions bookkeeping, recorded
    const log = [];
    const lists_ = {
        wren: [{ id: 'w1', name: 'Wren one' }, { id: 'w2', name: 'Wren two' }],
        kabuki: [{ id: 'k1', name: 'Kabuki one' }],
        xi: [{ id: 'x1', name: 'Xi one' }]
    };
    const remembered = { wren: 'w1', kabuki: null, xi: null };
    const d = {
        _personaSession: { wren: 'w1', kabuki: null, xi: null }, persona: 'wren', _xiEnabled: false, _kabuki: false, _windowOpen: true, currentSession: { id: 'w1' }, directorSessions: lists_.wren.slice(), _running: false, pendingAttachments: [],
        kabukiAvailable() { return this._kabuki; },
        directorWindowIsOpen() { return this._windowOpen; },
        async openDirectorWindow() { log.push('openDirectorWindow'); this._windowOpen = true; },
        paintPersonaToggle() { log.push('paintPersonaToggle'); },
        // director.js: the status packet and a turn's end flip a row's `running` (the app redraws the open Sessions page on a change)
        paintRunningSessions(ids) { (this.directorSessions || []).forEach((r) => { r.running = ids.includes(r.id); }); },
        markSessionRunning(id, on) { (this.directorSessions || []).forEach((r) => { if (r.id === id) r.running = !!on; }); },
        async loadDirectorSessions() { this.directorSessions = lists_[this.persona].slice(); log.push(`load:${this.persona}`); },
        async setPersona(p) {
            if (p === 'kabuki' && !this._kabuki) return;
            if (p === 'xi' && !(this._xiEnabled && this._windowOpen)) return;
            this.persona = p;
            this.paintPersonaToggle();
            this.currentSession = null;
            await this.loadDirectorSessions();
            const found = this._personaSession[p] && this.directorSessions.find((s) => s.id === this._personaSession[p]);
            if (found) await this.showSessionChat(found); else { this.currentSession = { draft: true }; log.push(`draft:${p}`); }
        },
        async showSessionChat(s) { log.push(`show:${s.id}@${this.persona}@${pageEl.classList.contains('wmd-cover') ? 'covered' : 'visible'}`); this.currentSession = s; },
        toolsMenuConfig: () => ({ sections: [], onAction() {} }), computerMenuItems: () => [], handleToolsAction() {}, abortTurn() {},
        directorWindow: el(), formatSessionDate: () => 'today', getSessionPreviewImage: () => '', sessionWorkspaceMeta: () => null, sessionPrints: () => []
    };
    // a fresh paintPersonaToggle is what the app wraps; calls through the wrapper reach the recorded one
    const wmShell = new Proxy({
        current: 'today', registerApp: (a) => { wmShell.app = a; },
        busy: (fn) => (typeof fn === 'function' ? Promise.resolve().then(fn) : () => {}),
        open: (id) => { opened.push(id); wmShell.current = id; wmShell.app.show(pageEl); },
        setTitle: (t) => { wmShell.title = t; },
        refreshSoftKeys: () => {}, syncHistory: () => {}, menuAt: () => {}, onScreen: () => true, holdMs: 550
    }, { get: (t, k) => (k in t ? t[k] : () => {}) });
    const win = {
        uiShell: 'mobile', wmShell, directorInstance: d, wmSettings: { fitTabs: (strip) => { events.push(['fitTabs', strip.buttons.length]); } },
        addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); }, dispatchEvent: () => {},
        wsClient: { on: (t, fn) => { if (!handlers.has(t)) handlers.set(t, []); handlers.get(t).push(fn); }, off: () => {}, isConnected: () => false }
    };
    const ctx = {
        window: win, document: doc, localStorage: { getItem: () => null, setItem: () => {} },
        setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
        console: { log() {}, warn: () => {}, error: console.error }, Date: class extends Date { static now() { return clock.t; } }, JSON, Map, Set, Promise, Object, Array, String, Number, Math, CustomEvent: function () {}, requestAnimationFrame: () => {},
        getComputedStyle: () => ({ getPropertyValue: () => '' }), MutationObserver: function () { this.observe = () => {}; }, ResizeObserver: function () { this.observe = () => {}; }, Event: function () {},
        CSS: { escape: (s) => s }
    };
    vm.createContext(ctx);
    vm.runInContext(read('public/scripts/comp/wmDirector.js'), ctx, { filename: 'wmDirector.js' });
    // a hand-off that never lands would end the process silently (nothing left to wait on): say where it stood
    const watchdog = setTimeout(() => { console.error('HANG', JSON.stringify({ log, opened, persona: d.persona })); process.exit(2); }, 5000);
    const app = wmShell.app;
    const api = win.wmDirectorApp;
    assert.ok(app && api && typeof api.openSession === 'function', 'the app registered and wmDirectorApp is there');
    const fire = (type, msg) => (handlers.get(type) || []).forEach((fn) => fn(msg));
    const flushTimers = () => timers.splice(0).forEach((fn) => { try { fn(); } catch (_) { /* the fake page */ } });
    const reset = () => { log.length = 0; opened.length = 0; };

    // ---- openSession while the app is not shown: the app comes up covered, persona first, then that chat
    d._kabuki = true;
    d._windowOpen = false;
    const landed = api.openSession('kabuki', 'k1');
    // the shell showed the app with the hand-off: covered from that frame on
    assert.deepStrictEqual(opened, ['director'], 'the app is opened once');
    assert.ok(pageEl.classList.contains('wmd-cover') || log.length > 0, 'the page is covered while the hand-off runs');
    assert.strictEqual(await landed, true, 'openSession resolves true when the chat is up');
    assert.strictEqual(d.persona, 'kabuki', 'the named persona is the one on screen');
    assert.strictEqual(d.currentSession.id, 'k1', 'the named chat is the one on screen');
    const shows = log.filter((x) => x.startsWith('show:'));
    assert.deepStrictEqual(shows, ['show:k1@kabuki@covered'], 'the only chat shown is the target, on its persona, with the page covered');
    assert.ok(!log.some((x) => x.startsWith('draft:')), 'no new-session draft is put up on the way to the named chat');
    assert.ok(log.indexOf('openDirectorWindow') < log.indexOf('show:k1@kabuki@covered'), 'her window opens first, the persona then');
    assert.ok(!pageEl.classList.contains('wmd-cover'), 'the cover is lifted once the chat is there');

    // ---- openSession while the app is in front on another chat: covered, lands on the chat, cover lifted
    reset();
    d.persona = 'wren'; d.currentSession = { id: 'w1' }; d.directorSessions = lists_.wren.slice();
    assert.strictEqual(await api.openSession('wren', 'w2'), true);
    assert.deepStrictEqual(log.filter((x) => x.startsWith('show:')), ['show:w2@wren@covered']);
    assert.deepStrictEqual(opened, [], 'already in front: not opened again');
    assert.ok(!pageEl.classList.contains('wmd-cover'));
    // the chat already on screen is not covered at all
    reset();
    assert.strictEqual(await api.openSession('wren', 'w2'), true);
    assert.ok(!log.some((x) => /covered/.test(x)), 'the chat already shown is not covered');
    // a chat that is not in the persona's list: false (the popup then opens the app as it was left)
    reset();
    assert.strictEqual(await api.openSession('wren', 'nope'), false);
    assert.ok(!pageEl.classList.contains('wmd-cover'));
    // a persona that cannot be chosen: false
    reset();
    d._kabuki = false; d.persona = 'wren';
    const refused = api.openSession('kabuki', 'k1');
    for (let i = 0; i < 40; i++) { await tick(); clock.t += 1000; flushTimers(); }
    assert.strictEqual(await refused, false, 'Kabuki without an engine: not landed');
    assert.ok(!pageEl.classList.contains('wmd-cover'));
    d._kabuki = true;

    // ---- the app's own popup (melatonopenapp { id, persona, sessionId })
    reset();
    d.persona = 'wren'; d.currentSession = { id: 'w1' };
    const onOpenApp = (listeners.get('melatonopenapp') || [])[0];
    assert.ok(onOpenApp, 'the page listens for the app opening it');
    onOpenApp({ detail: { id: 'director', persona: 'kabuki', sessionId: 'k1' } });
    await flush();
    assert.strictEqual(d.persona, 'kabuki');
    assert.strictEqual(d.currentSession.id, 'k1');
    reset();
    onOpenApp({ detail: 'director' }); // the plain form is not this listener's
    onOpenApp({ detail: { id: 'messaging', persona: 'wren', sessionId: 'w1' } });
    onOpenApp({ detail: { id: 'director', persona: 'constructor', sessionId: 'w1' } });
    await flush();
    assert.deepStrictEqual(opened, ['director'], 'only the Director object with no persona opens the app; others are ignored');

    // ---- the Sessions page and its tabs
    reset();
    d._kabuki = false; d._xiEnabled = false; d.persona = 'wren'; d.currentSession = { id: 'w1' }; d.directorSessions = lists_.wren.slice();
    wmShell.current = 'director';
    app.show(pageEl);
    await flush();
    const openSessions = async () => {
        const menu = app.softKeys().right.menu();
        const row = menu.find((r) => r && r.label === 'Sessions');
        assert.ok(row, 'the Menu has Sessions');
        row.action();
        await flush();
    };
    await openSessions();
    const strip = strips[strips.length - 1];
    const list = lists[lists.length - 1];
    assert.ok(strip && list, 'the Sessions page has its tab strip and its list');
    assert.strictEqual(strip.style.display, 'none', 'one persona: no strip');
    assert.deepStrictEqual(plain(api.personaTabs().map((t) => t.key)), ['wren']);
    assert.ok(/Wren one/.test(list.innerHTML), "the list is Wren's chats");

    // #1319 (finding 1 on the phone): a chat the server lists as running reads "Working...", live from the status / turn end hooks
    assert.ok(!/Working\.\.\./.test(list.innerHTML), 'nothing runs: no row says Working');
    d.paintRunningSessions(['w2']);
    assert.ok(/Working\.\.\.[^]*Wren two|Wren two[^]*Working\.\.\./.test(list.innerHTML) && (list.innerHTML.match(/Working\.\.\./g) || []).length === 1, 'the running chat\'s row says Working, only that one');
    d.markSessionRunning('w2', false);
    assert.ok(!/Working\.\.\./.test(list.innerHTML), 'the turn ended: the row clears at once');

    // Chiyo gets an engine: director.js paints its toggle, the tab appears (no polling: the hook)
    d._kabuki = true;
    d.paintPersonaToggle();
    assert.deepStrictEqual(strip.labels(), ['Yumiya', 'Chiyo'], 'a tab per persona that can be chosen');
    assert.strictEqual(strip.style.display, '', 'two personas: the strip shows');
    assert.deepStrictEqual(strip.selected(), ['wren'], 'the persona in use is marked');
    // Yozora on, her window open
    d._xiEnabled = true;
    d.paintPersonaToggle();
    assert.deepStrictEqual(strip.labels(), ['Yumiya', 'Chiyo', 'Yozora']);
    // ... but not while her window is closed (setPersona would refuse her)
    d._windowOpen = false;
    d.paintPersonaToggle();
    assert.deepStrictEqual(strip.labels(), ['Yumiya', 'Chiyo'], 'Yozora only when she can be chosen');
    d._windowOpen = true;
    d.paintPersonaToggle();
    assert.ok(events.some((e) => e[0] === 'fitTabs'), "the shell's tab fitting runs on the strip");

    // scroll position: kept by a refresh, kept per persona across a switch
    list.scrollTop = 120;
    fire('director_get_sessions_response', { data: { success: true } });
    flushTimers();
    assert.strictEqual(list.scrollTop, 120, 'a refresh keeps the scroll position');
    await strip.click('kabuki');
    assert.strictEqual(d.persona, 'kabuki', 'a tap switches the persona');
    assert.deepStrictEqual(strip.selected(), ['kabuki'], 'the tapped tab is the marked one');
    assert.ok(/Kabuki one/.test(list.innerHTML) && !/Wren one/.test(list.innerHTML), "the list below is Chiyo's chats, not Yumiya's");
    assert.strictEqual(list.scrollTop, 0, "Chiyo's list starts at the top");
    list.scrollTop = 40;
    await strip.click('wren');
    assert.strictEqual(d.persona, 'wren');
    assert.ok(/Wren one/.test(list.innerHTML) && !/Kabuki one/.test(list.innerHTML));
    assert.strictEqual(list.scrollTop, 120, "Yumiya's list is where it was left");
    assert.ok(!log.filter((x) => x.startsWith('load:')).some((x, i, a) => i > 0 && a[i - 1] === x), 'no second list load behind the switch');
    // the same tab again does nothing
    reset();
    await strip.click('wren');
    assert.deepStrictEqual(log, [], 'the tab in use is a no-op');
    // Yozora's tab
    await strip.click('xi');
    assert.strictEqual(d.persona, 'xi');
    assert.ok(/Xi one/.test(list.innerHTML));
    // the persona changed from elsewhere (a chat opened by id adopts its tab): the strip follows the hook
    d.persona = 'wren';
    d.paintPersonaToggle();
    assert.deepStrictEqual(strip.selected(), ['wren']);

    // the Sessions menu no longer repeats the persona choice (the tabs are over the list); the chat's Menu still has it
    const sessionsKeys = app.softKeys();
    const sessionsRows = sessionsKeys.right.menu();
    assert.deepStrictEqual(plain(sessionsRows.map((r) => r.label)), ['New Session', 'Refresh'], "the Sessions page's Menu has no Persona submenu");
    assert.ok(/Sessions$/.test(String(wmShell.title)), 'the page title names the persona and Sessions');
    app.onBack();
    await flush();
    const chatRows = app.softKeys().right.menu();
    const personaRow = chatRows.find((r) => r && r.label === 'Persona');
    assert.ok(personaRow, "the chat's Menu keeps its Persona submenu (no tabs over a chat)");
    assert.deepStrictEqual(plain(personaRow.submenu().map((r) => r.label)), ['Yumiya', 'Chiyo', 'Yozora']);
    assert.deepStrictEqual(plain(personaRow.submenu().map((r) => r.radio)), [true, false, false]);
    clearTimeout(watchdog);
}
