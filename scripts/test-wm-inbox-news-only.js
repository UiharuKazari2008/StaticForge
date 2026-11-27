#!/usr/bin/env node
/**
 * A box of the phone's inbox sounds only when the server published its notice as news (StaticForge #1367): a live packet
 * says so (alert), a listed row by alertAt (> 0; a row without the field, from an older server, is news). One exception
 * on purpose: a stack missed while away comes up silently in the Android app. Every note carries the notice's id and
 * alertAt, so the shell can ask the app before it sounds. Runs the real wmNotificationInbox.js in a fake phone page;
 * an appNote with silent false is a note the shell would sound. Nothing sounds.
 *
 *   node scripts/test-wm-inbox-news-only.js [path/to/wmNotificationInbox.js]
 *
 * The optional path is for proving the checks can fail (a copy without the change).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = process.argv[2] || path.join(__dirname, '..', 'public/scripts/comp/wmNotificationInbox.js');
const INBOX = fs.readFileSync(FILE, 'utf8');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };

/** One phone page; o.app: inside the Android app. */
function world(o = {}) {
    const handlers = new Map();
    const notes = [];
    const adopted = [];
    const timers = [];
    const up = new Set();
    let listed = [];
    const adopter = () => ({ inboxAdopt: (n, opt) => { adopted.push({ id: n.id, opt: Object.assign({}, opt) }); return true; }, inboxDrop() {} });
    const document = { hidden: false, documentElement: { classList: { contains: () => true } }, querySelectorAll: () => [], addEventListener() {}, getElementById: (id) => (up.has(id) ? { addEventListener() {} } : null) };
    const window = {
        uiShell: 'mobile',
        wsClient: {
            isConnected: () => true,
            on: (t, fn) => handlers.set(t, fn),
            sendMessage: (type) => Promise.resolve(type === 'inbox_list' ? { data: { notices: listed, total: listed.length } } : {}),
        },
        wmShell: {
            appNote: (opts) => {
                const note = { opts: Object.assign({}, opts), updates: [], closes: [] };
                notes.push(note);
                const id = `toast-${notes.length}`;
                up.add(id);
                return { id, update: (u) => note.updates.push(Object.assign({}, u)), close: (c) => { up.delete(id); note.closes.push(c ? Object.assign({}, c) : null); }, hide() {} };
            },
        },
        AndroidInbox: { shown() {} },
        wmChatApp: adopter(),
        wmMessaging: adopter(),
        addEventListener() {},
    };
    if (o.app) window.AndroidNotification = {};
    const ctx = {
        window, document, localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        setTimeout: (fn, ms) => { if (ms === 1500) timers.push(fn); return timers.length; }, clearTimeout() {},
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console,
    };
    vm.createContext(ctx);
    vm.runInContext(INBOX, ctx, { filename: 'wmNotificationInbox.js' });
    return {
        notes, adopted, window,
        ready: flush,
        async resume(rows) { listed = rows; await window.wmNotificationInbox.catchUp(); await flush(); },
        push: (notice) => handlers.get('inbox_updated')({ data: { reason: 'new', notice } }),
        /** The 1.5 s a page app has to show its own note. */
        producerTime() { timers.splice(0).forEach((fn) => fn()); },
        last: () => notes[notes.length - 1],
    };
}

const AT = 1700000000000;
const later = () => Date.now() + 60000;
const row = (id, cls, kind, alertAt, extra) => {
    const n = Object.assign({ id, cls, title: `Title ${id}`, text: 'text', state: 'new', createdAt: AT, data: { kind } }, extra || {});
    if (alertAt !== undefined) n.alertAt = alertAt;
    return n;
};
const stackRow = (alertAt) => {
    const n = { id: 'stack:fleetdone', cls: 'notification', title: '2 Fleet items are done', text: '', state: 'new', createdAt: AT, data: { stack: 'fleetdone', count: 2, items: [{ id: 'a', title: 'a', text: 'a', data: {} }, { id: 'b', title: 'b', text: 'b', data: {} }] } };
    if (alertAt !== undefined) n.alertAt = alertAt;
    return n;
};

let step = 0;
let failed = 0;
async function check(name, fn) {
    ++step;
    try { await fn(); console.log(`  ${step}. ok   ${name}`); } catch (e) { failed++; console.log(`  ${step}. FAIL ${name}\n       ${String(e && e.message).split('\n').slice(0, 10).join('\n       ')}`); }
}

/** One listed row at resume: is its box silent? */
async function resumed(n, o) {
    const w = world(o);
    await w.ready();
    await w.resume([n]);
    assert.strictEqual(w.notes.length, 1, `${n.id}: one box`);
    return w.last().opts;
}

async function main() {
    for (const [what, createdAt] of [['arrived while away', AT], ['arrived since the page started', later()]]) {
        await check(`resume, ${what}: a row never published as news comes up silent, a news row sounds, an older server's row sounds`, async () => {
            const make = (alertAt) => row('director:s:turn', 'director', 'director', alertAt, { createdAt });
            assert.strictEqual((await resumed(make(0))).silent, true, 'alertAt 0');
            assert.strictEqual((await resumed(make(AT))).silent, false, 'alertAt > 0');
            assert.strictEqual((await resumed(make(undefined))).silent, false, 'no alertAt');
        });
    }
    await check('resume: reminders the same, and shown again later still silent', async () => {
        const make = (alertAt) => row('rem:1', 'reminder', undefined, alertAt, { data: {} });
        assert.strictEqual((await resumed(make(0))).silent, true, 'alertAt 0');
        assert.strictEqual((await resumed(make(AT))).silent, false);
        assert.strictEqual((await resumed(make(undefined))).silent, false);
        const w = world();
        await w.ready();
        await w.resume([make(0)]);
        w.window.wmNotificationInbox.clear('rem:1'); // its box taken by something else: the list of reminders shows it again
        await w.resume([]);
        assert.strictEqual(w.notes.length, 2);
        assert.strictEqual(w.last().opts.silent, true, 'shown again: still no news');
    });
    await check('resume, a missed stack: in a browser it sounds only as news; in the Android app it comes up silently (on purpose)', async () => {
        assert.strictEqual((await resumed(stackRow(0))).silent, true);
        assert.strictEqual((await resumed(stackRow(AT))).silent, false);
        assert.strictEqual((await resumed(stackRow(undefined))).silent, false);
        assert.strictEqual((await resumed(stackRow(AT), { app: true })).silent, true);
    });
    await check('a live reminder published silently stays silent; as news it sounds', async () => {
        for (const [alert, silent] of [[false, true], [true, false]]) {
            const w = world({ app: true });
            await w.ready();
            w.push(row('rem:2', 'reminder', undefined, AT, { data: {}, alert }));
            assert.strictEqual(w.notes.length, 1);
            assert.strictEqual(w.last().opts.silent, silent, `alert ${alert}`);
        }
    });
    await check('a producer kind no program showed: the fallback box is silent for a silent packet (alertAt kept or 0), sounds for news', async () => {
        for (const [alert, alertAt, silent] of [[false, AT, true], [false, 0, true], [true, AT, false], [undefined, undefined, false]]) {
            const w = world({ app: true });
            await w.ready();
            const n = row('lapis:unlocked', 'lapis-unlocked', 'unlocked', alertAt);
            if (alert !== undefined) n.alert = alert;
            w.push(n);
            w.producerTime();
            assert.strictEqual(w.notes.length, 1, 'the fallback box');
            assert.strictEqual(w.last().opts.silent, silent, `alert ${alert}`);
        }
    });
    await check('a program that adopts it is told: live only for news, quiet otherwise', async () => {
        for (const [alert, want] of [[false, { arrived: true, live: false, quiet: true }], [true, { arrived: true, live: true, quiet: false }]]) {
            const w = world({ app: true });
            await w.ready();
            w.push(row('sms:a:c', 'sms', 'sms', AT, { alert }));
            w.producerTime();
            assert.deepStrictEqual(w.adopted.map((a) => a.opt), [want], `alert ${alert}`);
        }
        const w = world();
        await w.ready();
        await w.resume([row('sms:a:q', 'sms', 'sms', 0)]);
        assert.deepStrictEqual(w.adopted.map((a) => a.opt), [{ arrived: false, live: false, quiet: true }], 'a listed row never published as news');
        const asked = world();
        await asked.ready();
        asked.window.wmNotificationInbox.showOne(row('chat:1', 'chat', 'chat', AT));
        assert.deepStrictEqual(asked.adopted.map((a) => a.opt), [{ arrived: false, live: false, quiet: true }], 'asked for: quiet');
    });
    await check('what was quiet stays quiet: a consent question at resume, the holder\'s tap, "show what is waiting"', async () => {
        assert.strictEqual((await resumed(row('device-ask:L1', 'question', 'device-ask', AT))).silent, true);
        const w = world();
        await w.ready();
        w.window.wmNotificationInbox.showOne(row('director:s:turn', 'director', 'director', AT));
        assert.strictEqual(w.last().opts.silent, true, 'showOne');
        w.window.wmNotificationInbox.showOne(row('rem:3', 'reminder', undefined, AT, { data: {} }));
        assert.strictEqual(w.last().opts.silent, true, 'showOne, a reminder');
        await w.resume([]);
        const again = world();
        await again.ready();
        await again.resume([]);
        await again.resume([row('system:a', 'system', 'system', AT, { state: 'seen', updatedAt: Date.now() })]);
        const before = again.notes.length;
        await again.window.wmNotificationInbox.showWaiting();
        assert.ok(again.notes.slice(before).every((n) => n.opts.silent === true), 'showWaiting');
    });
    await check('every box carries its notice and alertAt (a notice, a reminder, a stack, and a stack\'s change in place)', async () => {
        const w = world();
        await w.ready();
        await w.resume([row('director:s:turn', 'director', 'director', 11), row('rem:4', 'reminder', undefined, 12, { data: {} }), stackRow(13)]);
        assert.deepStrictEqual(w.notes.map((n) => [n.opts.notice, n.opts.noticeAt]), [['director:s:turn', 11], ['rem:4', 12], ['stack:fleetdone', 13]]);
        const changed = stackRow(13);
        changed.data.items.unshift({ id: 'c', title: 'c', text: 'c', data: {} });
        changed.data.count = 3;
        w.push(Object.assign(changed, { alert: false }));
        const stack = w.notes[2];
        assert.strictEqual(w.notes.length, 3, 'changed in place');
        assert.deepStrictEqual([stack.updates[0].notice, stack.updates[0].noticeAt], ['stack:fleetdone', 13]);
    });
    await check('a box drawn again for news under its id closes the old one as replaced', async () => {
        const w = world();
        await w.ready();
        await w.resume([row('director:s:turn', 'director', 'director', AT)]);
        w.push(row('director:s:turn', 'director', 'director', AT + 5, { alert: true }));
        assert.strictEqual(w.notes.length, 2);
        assert.deepStrictEqual(w.notes[0].closes, [{ replaced: true }]);
        w.window.wmNotificationInbox.clear('x');
        const done = world();
        await done.ready();
        await done.resume([row('director:s:turn', 'director', 'director', AT)]);
        await done.resume([row('director:s:turn', 'director', 'director', AT, { state: 'cleared' })]);
        assert.deepStrictEqual(done.notes[0].closes, [null], 'cleared elsewhere: put away, not replaced');
    });

    if (failed) { console.log(`test-wm-inbox-news-only: ${failed} of ${step} FAILED`); process.exit(1); }
    console.log('test-wm-inbox-news-only: ok');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
