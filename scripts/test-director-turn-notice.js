#!/usr/bin/env node
/**
 * The Director's "turn is finished" is one notification on the phone (Yukimi, Nov 20 2026: 2-3 per turn, #997).
 *
 * Replays the server's inbox pushes for two turns on one session (the same id director:<session>:turn each time)
 * through public/scripts/comp/wmNotificationInbox.js in a fake page, and checks wmShell's directorTurnWatch no
 * longer posts a note of its own:
 * - each finished turn shows exactly one note at once (no producer wait), and acks it seen, also the second turn
 *   (the seen ack was kept per id, so the second turn's notice stayed new and came up again at the next resume);
 * - a resume / reconnect after that shows nothing more;
 * - a quiet class (Display message on screen off: stored seen) shows nothing;
 * - a page behind (hidden) shows nothing live, and on resume shows it once.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmNotificationInbox.js'), 'utf8');

function page() {
    const handlers = new Map();
    const docListeners = new Map();
    const notes = [];
    const acks = [];
    let listed = [];
    const timers = [];
    const document = {
        hidden: false,
        documentElement: { classList: { contains: (c) => c === 'ui-mobile' } },
        querySelectorAll: () => [],
        addEventListener: (t, fn) => { docListeners.set(t, fn); },
    };
    const wsClient = {
        isConnected: () => true,
        on: (t, fn) => { handlers.set(t, fn); },
        sendMessage: (type, payload) => {
            if (type === 'inbox_ack') acks.push(`${payload.id}=${payload.state}`);
            if (type === 'inbox_list') return Promise.resolve({ data: { notices: listed, total: listed.length } });
            return Promise.resolve({});
        },
    };
    const wmShell = {
        appNote: (o) => { const n = { title: o.title, html: o.html, event: o.event, open: true, close() { this.open = false; } }; notes.push(n); return n; },
    };
    const window = {
        uiShell: 'mobile', wsClient, wmShell,
        addEventListener: () => {},
    };
    const ctx = {
        window, document,
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        clearTimeout: () => {},
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, console,
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'wmNotificationInbox.js' });
    return {
        notes, acks, document, timers,
        push: (notice) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'new', notice } }),
        cleared: (id) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'ack', id, state: 'cleared' } }),
        setList: (l) => { listed = l; },
        reconnect: () => handlers.get('connected')(),
        runTimers: () => { const t = timers.splice(0); t.forEach((x) => x.fn()); },
    };
}

const flush = () => new Promise((r) => setImmediate(r));
const ID = 'director:dirc_test:turn';
const notice = (at, extra = {}) => Object.assign({
    id: ID, app: 'director', cls: 'director', title: 'Director', text: '"Wren": the turn is finished.',
    data: { app: 'director', kind: 'director', sessionId: 'dirc_test' }, createdAt: at, updatedAt: at, state: 'new', alert: true,
}, extra);

(async () => {
    // wmShell posts no note of its own any more: the inbox notice is the one notification
    const shell = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmShell.js'), 'utf8');
    const watch = shell.slice(shell.indexOf('function directorTurnWatch'), shell.indexOf('function paintUpdateIcon'));
    assert.ok(watch.length > 0, 'directorTurnWatch found');
    assert.ok(!/notify\(/.test(watch), 'directorTurnWatch posts no notification of its own');

    // two turns on one session, page in front
    const p = page();
    await flush();
    const t1 = Date.now() + 1000;
    p.push(notice(t1));
    assert.strictEqual(p.notes.length, 1, 'turn 1: one note, at once');
    assert.strictEqual(p.notes[0].event, 'director', 'the note carries the Director sound class');
    assert.deepStrictEqual(p.acks, [`${ID}=seen`], 'turn 1 acked seen');
    // the user dismisses it; the next turn starts (the server clears it) and ends
    p.cleared(ID);
    const t2 = t1 + 60000;
    p.push(notice(t2));
    assert.strictEqual(p.notes.filter((n) => n.open).length, 1, 'turn 2: one note');
    assert.deepStrictEqual(p.acks, [`${ID}=seen`, `${ID}=seen`], 'turn 2 acked seen too (same id)');
    // the server now holds it seen: a reconnect shows nothing more
    p.setList([notice(t2, { state: 'seen' })]);
    p.reconnect();
    await flush(); await flush();
    assert.strictEqual(p.notes.length, 2, 'no extra note on reconnect');
    p.runTimers();
    assert.strictEqual(p.notes.length, 2, 'no producer wait left to show another');

    // Display message on screen off: the server stores it seen, the page shows nothing
    const q = page();
    await flush();
    q.push(notice(Date.now() + 1000, { state: 'seen' }));
    q.runTimers();
    assert.strictEqual(q.notes.length, 0, 'quiet class: no note');

    // the page behind: nothing live; on resume it shows once
    const h = page();
    await flush();
    h.document.hidden = true;
    const th = Date.now() + 1000;
    h.push(notice(th));
    h.runTimers();
    assert.strictEqual(h.notes.length, 0, 'hidden: nothing live');
    h.document.hidden = false;
    h.setList([notice(th)]);
    h.reconnect();
    await flush(); await flush();
    assert.strictEqual(h.notes.length, 1, 'resume: shown once');
    h.reconnect();
    await flush(); await flush();
    assert.strictEqual(h.notes.length, 1, 'a second resume: still once');

    console.log('director turn notice: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
