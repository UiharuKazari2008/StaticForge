'use strict';
// #1319 finding 3 (Director half) and finding 4 (desktop half), Yukimi Nov 26 2026.
// A persona switch keeps the chat on screen until the new tab's chat is ready, then swaps ONCE (no empty chat or draft
// in between, currentSession never null), and the persona control sits in the menu bar (#directorCommonHeader).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/scripts/comp/director.js'), 'utf8');
const start = src.indexOf('class Director {');
const end = src.indexOf('\n}\n', start);
assert.ok(start >= 0 && end > start, 'Director class');

const store = new Map();
const ctx = {
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v))
    },
    window: { wsClient: { isConnected: () => true, send() {} } },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    showGlassToast: () => {},
    console
};
vm.createContext(ctx);
vm.runInContext(`${src.slice(start, end + 2)}\nthis.Director = Director;`, ctx);
const D = ctx.Director;

const providers = [
    { id: 'deepseek', engine: 'custom:deepseek', name: 'DeepSeek', memoryStore: null },
    { id: 'abl', engine: 'custom:abl', name: 'Abliterated', memoryStore: 'obliterated' }
];

// ---- a page: the chat host counts every write to it; currentSession remembers every value it ever had ----
function page(persona, shown) {
    const d = Object.create(D.prototype);
    const host = { writes: [], set innerHTML(v) { this.writes.push(`html:${v}`); }, get innerHTML() { return ''; } };
    const seen = [];
    let current = shown;
    const win = { currentSession: shown, wsClient: ctx.window.wsClient };
    let winCurrent = shown;
    Object.defineProperty(win, 'currentSession', { get: () => winCurrent, set: (v) => { winCurrent = v; seen.push(['window', v]); } });
    Object.defineProperty(d, 'currentSession', { get: () => current, set: (v) => { current = v; seen.push(['page', v]); } });
    Object.assign(d, {
        PREFS_KEY: 'staticforge_director_chat_prefs',
        ENGINE_KEY: 'staticforge_director_engine',
        SESSION_MODEL_KEY: 'staticforge_director_session_models',
        engine: 'tokenrouter',
        persona,
        customProviders: providers,
        modelCatalogs: {},
        modelCatalog: [],
        directorSettings: null,
        directorSessions: [],
        _xiEnabled: true,
        _personaSession: { wren: null, kabuki: null, xi: null },
        _switchFrom: null,
        _personaTicket: 0,
        _personaLanding: null,
        effortLevels: [{ value: 'medium', name: 'Medium' }],
        directorChatMessages: host,
        paintModelPick() {},
        paintMessageFilter() {},
        syncEngineChrome() {},
        loadModelCache() {},
        removeQuickStart() {},
        hideBrowserPreview() {},
        directorWindowIsOpen: () => true,
        modelApplied: [],
        applySessionModel(session) { this.modelApplied.push(session && session.id); }
    });
    d.loadChatPrefs();
    // the chat's own paint: the one write the swap makes. The real showSessionChat / showNewSessionDraft set
    // currentSession and window.currentSession together and draw the chat; this stands in for them.
    d.swaps = [];
    d.showSessionChat = async (session) => {
        d.currentSession = session;
        win.currentSession = session;
        host.innerHTML = `chat ${session.id}`;
        d.swaps.push(session.id);
    };
    d.showNewSessionDraft = () => {
        const draft = { draft: true, id: null, name: 'New session', messages: [] };
        d.currentSession = draft;
        win.currentSession = draft;
        host.innerHTML = 'draft';
        d.swaps.push('draft');
        return true;
    };
    // the list of the persona asked for; the test releases it
    d.listCalls = [];
    d.listGate = [];
    d.loadDirectorSessions = () => new Promise((resolve) => {
        const call = {
            persona: d.persona,
            sessionAtAsk: d.currentSession,
            windowSessionAtAsk: win.currentSession,
            release(rows) { d.directorSessions = rows; resolve(); }
        };
        d.listCalls.push(call);
        d.listGate.push(call);
    });
    return { d, host, seen, win };
}
ctx.window.currentSession = null;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const w1 = { id: 'w1', name: 'Wren one', messages: [] };
const k1 = { id: 'k1', name: 'Chiyo one', messages: [] };
const x1 = { id: 'x1', name: 'Yozora one', messages: [] };

(async () => {
    // ---- Wren -> Kabuki with a remembered Kabuki chat: the Wren chat stays until it is ready, one swap ----
    {
        const { d, host, seen, win } = page('wren', w1);
        d._personaSession.kabuki = 'k1';
        const done = d.setPersona('kabuki');
        await flush();
        assert.strictEqual(d.persona, 'kabuki', 'the tab changes first');
        assert.strictEqual(d.listCalls.length, 1, 'the new tab\'s list is asked for');
        assert.strictEqual(d.listCalls[0].persona, 'kabuki');
        assert.strictEqual(d.listCalls[0].sessionAtAsk, w1, 'at the await the old chat is still the current one (never null)');
        assert.strictEqual(d.listCalls[0].windowSessionAtAsk, w1, 'window.currentSession agrees');
        assert.strictEqual(d.currentSession, w1);
        assert.strictEqual(win.currentSession, w1);
        assert.deepStrictEqual(host.writes, [], 'the chat host is not cleared or replaced while the target is not ready');
        assert.strictEqual(d._personaSession.wren, 'w1', 'the chat left is remembered for its tab');
        d.listGate[0].release([k1]);
        await done;
        assert.deepStrictEqual(d.swaps, ['k1'], 'one swap, to the remembered chat of the new tab');
        assert.strictEqual(d.currentSession, k1);
        assert.strictEqual(win.currentSession, k1);
        assert.deepStrictEqual(host.writes, ['html:chat k1'], 'the host is written once, with the new chat');
        assert.ok(seen.every(([, v]) => v), 'currentSession and window.currentSession were never set to null');
        assert.strictEqual(d._switchFrom, null);
        assert.strictEqual(d._personaLanding, null);
    }

    // ---- no remembered chat: the draft is the one swap (not before) ----
    {
        const { d, host, seen } = page('wren', w1);
        const done = d.setPersona('kabuki');
        await flush();
        assert.strictEqual(d.currentSession, w1, 'no empty draft while the list loads');
        assert.deepStrictEqual(host.writes, []);
        d.listGate[0].release([k1]);
        await done;
        assert.deepStrictEqual(d.swaps, ['draft']);
        assert.strictEqual(d.currentSession.draft, true);
        assert.deepStrictEqual(host.writes, ['html:draft']);
        assert.ok(seen.every(([, v]) => v));
    }

    // ---- a remembered chat the list no longer has: the draft ----
    {
        const { d } = page('wren', w1);
        d._personaSession.kabuki = 'gone';
        const done = d.setPersona('kabuki');
        await flush();
        d.listGate[0].release([k1]);
        await done;
        assert.deepStrictEqual(d.swaps, ['draft']);
    }

    // ---- Wren -> Yozora: packets of the tab left are ignored while the old chat still shows ----
    {
        const { d, host } = page('wren', w1);
        d._personaSession.xi = 'x1';
        const done = d.setPersona('xi');
        await flush();
        assert.strictEqual(d.currentSession, w1);
        assert.strictEqual(d.packetFromOtherServer({ persona: 'wren' }), true, 'a late Wren-server packet is ignored');
        assert.strictEqual(d.packetFromOtherServer({}), true, 'a packet without a tab is Wren\'s');
        assert.strictEqual(d.packetFromOtherServer({ persona: 'xi' }), false, 'a Yozora packet is the page\'s now');
        assert.deepStrictEqual(host.writes, []);
        d.listGate[0].release([x1]);
        await done;
        assert.deepStrictEqual(d.swaps, ['x1']);
        assert.strictEqual(d.currentSession, x1);
    }

    // ---- Yozora -> Wren, and the other way: the old chat is Yozora's, remembered for Yozora ----
    {
        const { d, host } = page('xi', x1);
        d._personaSession.wren = 'w1';
        const done = d.setPersona('wren');
        await flush();
        assert.strictEqual(d._personaSession.xi, 'x1');
        assert.strictEqual(d.packetFromOtherServer({ persona: 'xi' }), true, 'a late Yozora packet is ignored');
        assert.deepStrictEqual(host.writes, []);
        d.listGate[0].release([w1]);
        await done;
        assert.deepStrictEqual(d.swaps, ['w1']);
    }

    // ---- the same tab again: a no-op ----
    {
        const { d, host, seen } = page('wren', w1);
        await d.setPersona('wren');
        assert.strictEqual(d.listCalls.length, 0, 'no list is asked for');
        assert.strictEqual(d.currentSession, w1);
        assert.deepStrictEqual(host.writes, []);
        assert.strictEqual(seen.length, 0);
        // not a tab that cannot be chosen
        d._xiEnabled = false;
        await d.setPersona('xi');
        assert.strictEqual(d.persona, 'wren', 'Yozora off: no switch');
        d.customProviders = providers.filter((row) => !row.memoryStore);
        await d.setPersona('kabuki');
        assert.strictEqual(d.persona, 'wren', 'no Obliterated engine: no Kabuki');
        assert.strictEqual(d.listCalls.length, 0);
    }

    // ---- two quick switches: one swap, and the chat on screen is remembered for its own tab ----
    {
        const { d, host, seen } = page('wren', w1);
        d._personaSession.kabuki = 'k1';
        d._personaSession.xi = 'x1';
        const first = d.setPersona('kabuki');
        await flush();
        const second = d.setPersona('xi');
        await flush();
        assert.strictEqual(d.persona, 'xi');
        assert.strictEqual(d._personaSession.wren, 'w1');
        assert.strictEqual(d._personaSession.kabuki, 'k1', 'Wren\'s chat is not recorded under Kabuki');
        assert.strictEqual(d.currentSession, w1);
        assert.deepStrictEqual(host.writes, []);
        // the answer for Kabuki comes late: it must not land
        d.listGate[0].release([k1]);
        await first;
        assert.strictEqual(d.currentSession, w1, 'a superseded switch does not swap');
        assert.deepStrictEqual(host.writes, []);
        d.listGate[1].release([x1]);
        await second;
        assert.deepStrictEqual(d.swaps, ['x1'], 'one swap, to the last tab');
        assert.deepStrictEqual(host.writes, ['html:chat x1']);
        assert.ok(seen.every(([, v]) => v));
        assert.strictEqual(d._switchFrom, null);
    }

    // ---- back to the tab whose chat never left the screen: nothing is swapped ----
    {
        const { d, host } = page('wren', w1);
        d._personaSession.kabuki = 'k1';
        const first = d.setPersona('kabuki');
        await flush();
        const back = d.setPersona('wren');
        await flush();
        d.listGate.forEach((call) => call.release([w1]));
        await Promise.all([first, back]);
        assert.deepStrictEqual(d.swaps, [], 'no swap');
        assert.deepStrictEqual(host.writes, []);
        assert.strictEqual(d.currentSession, w1);
        assert.strictEqual(d.persona, 'wren');
        assert.deepStrictEqual(d.modelApplied, ['w1'], 'the chat\'s model is put back');
        assert.strictEqual(d._personaSession.wren, 'w1');
    }

    // ---- a chat opened by someone else while the list loads is left alone ----
    {
        const { d, host, win } = page('wren', w1);
        d._personaSession.kabuki = 'k1';
        const done = d.setPersona('kabuki');
        await flush();
        const other = { id: 'k2', name: 'opened meanwhile', messages: [] };
        d.currentSession = other;
        win.currentSession = other;
        d.listGate[0].release([k1]);
        await done;
        assert.strictEqual(d.currentSession, other);
        assert.deepStrictEqual(d.swaps, []);
        assert.deepStrictEqual(host.writes, []);
        assert.strictEqual(d._switchFrom, null);
    }

    // ---- nothing on screen yet: the switch lands the remembered chat as before ----
    {
        const { d } = page('wren', null);
        d._personaSession.kabuki = 'k1';
        const done = d.setPersona('kabuki');
        await flush();
        d.listGate[0].release([k1]);
        await done;
        assert.deepStrictEqual(d.swaps, ['k1']);
    }

    // ---- a message typed meanwhile waits for the chat it goes to ----
    {
        const { d } = page('wren', w1);
        d._personaSession.kabuki = 'k1';
        const done = d.setPersona('kabuki');
        await flush();
        assert.ok(d._personaLanding, 'the switch is pending');
        let sentTo = null;
        d.outgoingText = () => 'hello';
        d.pendingAttachments = [];
        Object.defineProperty(d, '_creatingChat', { get() { sentTo = d.currentSession.id; return true; } });
        const send = d.sendMessage();
        await flush();
        assert.strictEqual(sentTo, null, 'sendMessage has not looked at the chat yet');
        d.listGate[0].release([k1]);
        await done;
        await send.catch(() => {});
        assert.strictEqual(sentTo, 'k1', 'it goes to the chat that shows after the switch');
    }

    // ---- the toggle: names, state for a screen reader, hidden with only Wren ----
    {
        const { d } = page('wren', w1);
        const mk = (persona) => {
            const classes = new Set();
            const attrs = {};
            return { dataset: { persona }, attrs, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) }, setAttribute: (k, v) => { attrs[k] = v; } };
        };
        const buttons = [mk('wren'), mk('kabuki'), mk('xi')];
        const gc = new Set();
        d.directorPersonaGroup = { dataset: {}, classList: { toggle: (c, on) => (on ? gc.add(c) : gc.delete(c)), has: (c) => gc.has(c) }, querySelectorAll: () => buttons };
        d.persona = 'kabuki';
        d.paintPersonaToggle();
        assert.deepStrictEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false'], 'aria-pressed follows the active tab');
        assert.strictEqual(gc.has('hidden'), false);
        d.persona = 'wren';
        d._xiEnabled = false;
        d.customProviders = providers.filter((row) => !row.memoryStore);
        d.paintPersonaToggle();
        assert.strictEqual(gc.has('hidden'), true, 'only Wren: the control hides itself');
    }

    // ---- the markup: one control, in the menu bar, outside the session list ----
    {
        const html = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
        const ids = html.match(/id="directorPersonaGroup"/g) || [];
        assert.strictEqual(ids.length, 1, 'one persona control');
        const header = html.indexOf('id="directorCommonHeader"');
        const group = html.indexOf('id="directorPersonaGroup"');
        const container = html.indexOf('id="directorContainer"');
        const list = html.indexOf('id="directorSessionList"');
        assert.ok(header > 0 && group > header && group < container && group < list, 'inside #directorCommonHeader, before the container and the session list');
        const bar = html.slice(header, container);
        assert.ok(/id="directorMenuBtn"[\s\S]*id="directorPersonaGroup"/.test(bar), 'right after the menu button');
        const tag = html.slice(group, html.indexOf('</div>', group));
        assert.ok(/class="gallery-toggle-group hidden"/.test(html.slice(group - 10, group + 120)), 'the segmented-group kit element, hidden until painted');
        assert.ok(/aria-label="Director persona"/.test(html.slice(group, group + 200)), 'the group is named');
        assert.strictEqual((tag.match(/aria-pressed=/g) || []).length, 3, 'every button says whether it is pressed');
        assert.ok(!/id="directorSessionList"[\s\S]{0,900}directorPersonaGroup/.test(html), 'not in the session list any more');
        const css = fs.readFileSync(path.join(root, 'public/css/director.css'), 'utf8');
        assert.ok(!/#directorSessionList[^{]*#directorPersonaGroup/.test(css), 'no rule scopes the control to the session list');
        // the phone shell hides the whole bar, so the control does not show there (wm-director.css owns the phone UI)
        const wm = fs.readFileSync(path.join(root, 'public/css/wm-director.css'), 'utf8');
        assert.ok(/\.wm-director #directorCommonHeader,[\s\S]*?display: none !important/.test(wm), 'the phone shell hides #directorCommonHeader');
    }

    console.log('test-director-persona-switch-chat: ok');
})().catch((err) => { console.error(err); process.exit(1); });
