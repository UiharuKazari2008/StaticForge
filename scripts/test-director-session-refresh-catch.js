'use strict';
// #1242: the fire-and-forget session list refreshes in public/scripts/comp/director.js end in a catch, so a timeout of
// loadDirectorSessions() ("Timeout loading director sessions", 10 s) is no unhandled rejection.
//  1. static: every loadDirectorSessions() call is awaited, chained or the definition; the best-effort catch form
//     `this|director.loadDirectorSessions().catch(() => { /* list refresh is best effort */ })` is at exactly 6 places
//     (the 5 added for #1242 plus the one in takePersona, which already had it).
//  2. behaviour (real file, real methods): openSessionOverlay, setSessionPanelState and the director_create_session_response
//     handler (both of its refresh calls) run with a loadDirectorSessions that rejects with 'Request timeout'; no
//     unhandledRejection is raised. The same run on the source with the catch removed raises one (control), so the
//     check can fail.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '../public/scripts/comp/director.js');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

// ---- 1. static
const CATCH = '/* list refresh is best effort */';
const bare = [];
const chained = []; // the fire-and-forget form with the best-effort catch
lines.forEach((line, i) => {
    let from = 0;
    for (;;) {
        const at = line.indexOf('loadDirectorSessions()', from);
        if (at < 0) break;
        from = at + 1;
        const before = line.slice(0, at);
        const after = line.slice(at + 'loadDirectorSessions()'.length);
        const n = i + 1;
        if (/async\s+$/.test(before)) continue; // the definition
        if (/\bawait\s+(this|director)\.$/.test(before)) continue; // awaited
        if (/\breturn\s+(this|director)\.$/.test(before)) continue; // returned
        if (/^\s*\.catch\(\s*\(\)\s*=>\s*\{\s*\/\* list refresh is best effort \*\/\s*\}\s*\)/.test(after)) { chained.push(n); continue; }
        if (/^\s*\.(then|catch|finally)\(/.test(after)) continue; // chained: the .then( at 3793/3802 end in .catch (checked below)
        bare.push(`${n}: ${line.trim()}`);
    }
});
assert.deepStrictEqual(bare, [], `fire-and-forget loadDirectorSessions() without a handler:\n${bare.join('\n')}`);
assert.strictEqual(chained.length, 6, `best-effort catch call sites, got ${chained.length} at lines ${chained.join(', ')}`);
// the two .then( chains must themselves end in a .catch( (3793 on one line, 3802 over a block)
lines.forEach((line, i) => {
    if (!/loadDirectorSessions\(\)\.then\(/.test(line)) return;
    let tail = line;
    for (let j = i + 1; j < Math.min(lines.length, i + 40) && !/\.catch\(/.test(tail); j++) tail += '\n' + lines[j];
    assert.ok(/\.catch\(/.test(tail), `line ${i + 1}: .then( chain without .catch(`);
});

// ---- 2. behaviour
function loadDirector(source) {
    const start = source.indexOf('class Director {');
    const end = source.indexOf('\n}\n', start);
    assert.ok(start >= 0 && end > start, 'Director class');
    const handlers = {};
    const window = {
        wsClient: { on: (type, fn) => { handlers[type] = fn; }, off() {}, isConnected: () => false },
        directorInstance: null
    };
    const ctx = {
        window,
        document: {},
        console,
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        DIRECTOR_PERSONA_KEY: 'staticforge_director_persona',
        openManualModalWithContent: async () => {},
        getComputedStyle: () => ({ getPropertyValue: () => '' })
    };
    vm.createContext(ctx);
    vm.runInContext(`${source.slice(start, end + 2)}\nthis.Director = Director;`, ctx);
    return { Director: ctx.Director, handlers, window };
}

const flat = () => new Promise((resolve) => setImmediate(resolve));

async function runSites(source) {
    const { Director, handlers, window } = loadDirector(source);
    const seen = [];
    const onRejection = (reason) => { seen.push(reason && reason.message ? reason.message : String(reason)); };
    process.on('unhandledRejection', onRejection);
    const exercised = [];
    try {
        const make = () => {
            const d = Object.create(Director.prototype);
            d.loadDirectorSessions = () => { exercised.push('load'); return Promise.reject(new Error('Request timeout')); };
            d.initializeScrollbars = () => {};
            d.staticSessionPanel = () => true; // no click-outside listener to leave behind
            d.addClickOutsideListener = () => {};
            d.applySessionPanelFold = () => {};
            d.rememberPersona = () => {};
            d.directorSessionList = { classList: { remove() {}, add() {}, toggle() {}, contains: () => false } };
            d.persona = 'wren';
            return d;
        };

        // (a) openSessionOverlay: the overlay opens and asks for a fresh list
        make().openSessionOverlay();
        // (b) setSessionPanelState('open'): unfolding the panel asks for the list
        make().setSessionPanelState('open');

        // (c) the create-session response handler, both of its refresh calls (the applet path and the normal path)
        const director = make();
        Object.assign(director, {
            packetFromOtherServer: () => false,
            rememberSessionModel() {},
            _pendingOutgoing: null,
            _creatingChat: true,
            _focusComposer: true, // keeps the draft: no composer to touch
            sessionIsListed: () => false,
            rememberListedSession() {},
            studioIsOpen: () => false,
            directorWindowIsOpen: () => true,
            openDirectorWindow: async () => {},
            showDirector: async () => {},
            showSessionChat: async () => {},
            directorBtn: null
        });
        window.directorInstance = director;
        director.setupDirectorWebSocketHandlers();
        const handler = handlers.director_create_session_response;
        assert.strictEqual(typeof handler, 'function', 'the real file registers director_create_session_response');
        const reply = { data: { success: true, session: { id: 's1', name: 'n', messages: [] } } };
        director._askWrenApplet = true; // director.loadDirectorSessions() after openDirectorWindow
        await handler(reply);
        director._askWrenApplet = false; // director.loadDirectorSessions() after showDirector
        await handler(reply);

        await flat();
        await flat();
        await flat();
        assert.strictEqual(exercised.length, 4, `4 refresh calls reached (overlay, panel, applet reply, normal reply), got ${exercised.length}`);
    } finally {
        process.removeListener('unhandledRejection', onRejection);
    }
    return seen;
}

(async () => {
    const seen = await runSites(src);
    assert.deepStrictEqual(seen, [], `unhandled rejections from the list refresh: ${seen.join(' | ')}`);

    // control: without the catch the same run does raise them (so the check above can fail)
    const stripped = src.split(`.catch(() => { ${CATCH} });`).join(';');
    assert.notStrictEqual(stripped, src, 'control: catches were removed from the source string');
    const raised = await runSites(stripped);
    assert.strictEqual(raised.length, 4, `control: 4 unhandled rejections without the catch, got ${raised.length}`);
    assert.ok(raised.every((m) => m === 'Request timeout'));

    console.log('ok: director session refresh: 6 best-effort catch sites, no bare fire-and-forget call, no unhandled rejection from 4 exercised sites (control raises 4)');
})().catch((err) => { console.error(err); process.exit(1); });
