#!/usr/bin/env node
/**
 * A live mail the inbox hands to Messaging is heard (#1321): the app posts no Android notification for it.
 *
 * Runs Messaging's adopt block (public/scripts/comp/wmMessaging.js, cut out between its own comments) and the real
 * public/scripts/comp/wmNotificationInbox.js in a fake phone page inside the Android app:
 * - Messaging's own note (the inbox not stacking mail): live sounds; a live arrival anywhere in the debounce keeps the
 *   note loud, and the next burst is silent again; caught up on resume ({}, { live: false }) stays silent;
 * - while mail is the inbox's notice (Messaging draws none), a live mail no page app raised comes up as the inbox's box,
 *   sounding, exactly once; a caught-up stack is counted and stays silent.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MESSAGING = read('public/scripts/comp/wmMessaging.js');
const INBOX = read('public/scripts/comp/wmNotificationInbox.js');
const from = MESSAGING.indexOf('    const inAndroidApp = () =>');
const to = MESSAGING.indexOf('    /** Cleared elsewhere (read on another device): out of this note. */');
assert.ok(from > 0 && to > from, 'the adopt block is where this test cuts it');
const ADOPT = MESSAGING.slice(from, to);

/** Messaging's side: its adopt block with the note it would draw recorded. */
function messaging(window) {
    const timers = [];
    const shown = []; // every showImapNote call: its silent flag
    const ctx = {
        window,
        imapFresh: [], imapPending: new Set(), pendKey: (a, f, u) => `${a}|${f}|${u}`,
        showImapNote: (o) => shown.push(!!(o && o.silent)), shellStatus: () => {},
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout: (n) => { if (n) timers[n - 1] = null; },
    };
    vm.createContext(ctx);
    vm.runInContext(`${ADOPT}\nthis.inboxAdopt = inboxAdopt;`, ctx);
    return {
        ctx, shown, adopt: ctx.inboxAdopt,
        flush: () => { for (let i = 0; i < timers.length; i++) { const fn = timers[i]; timers[i] = null; if (fn) fn(); } },
    };
}
const mail = (uid) => ({ data: { app: 'messaging', kind: 'mail', accountId: 'a', folder: 'INBOX', uid, from: 'S', subject: `s${uid}` } });

// Messaging's own note, in the Android app
const m = messaging({ AndroidNotification: {} });
assert.strictEqual(m.adopt(mail(1), { live: true }), true, 'its note takes it');
m.flush();
assert.deepStrictEqual(m.shown, [false], 'live: loud');
m.adopt(mail(2), {});
m.flush();
m.adopt(mail(3), { live: false });
m.flush();
m.adopt(mail(4));
m.flush();
assert.deepStrictEqual(m.shown, [false, true, true, true], 'caught up (and after a live burst): silent');
m.shown.length = 0;
m.adopt(mail(5), {});
m.adopt(mail(6), { live: true });
m.adopt(mail(7), {});
m.flush();
assert.deepStrictEqual(m.shown, [false], 'a live one anywhere in the debounce: one note, loud');
const web = messaging({});
web.adopt(mail(1), {});
web.flush();
assert.deepStrictEqual(web.shown, [false], 'outside the Android app a caught-up note sounds, as before');

// with the real inbox on the phone: mail is the inbox's notice
(async () => {
    const handlers = new Map();
    const notes = [];
    const acks = [];
    const timers = [];
    const document = { hidden: false, documentElement: { classList: { contains: () => true } }, querySelectorAll: () => [], addEventListener: () => {}, getElementById: () => null };
    const wsClient = {
        isConnected: () => true,
        on: (t, fn) => { handlers.set(t, fn); },
        sendMessage: (type, payload) => {
            if (type === 'inbox_ack') acks.push(`${payload.id}=${payload.state}`);
            return Promise.resolve(type === 'inbox_list' ? { data: { notices: [], total: 0 } } : {});
        },
    };
    const wmShell = { appNote: (opts) => { notes.push(opts); return { id: `toast-${notes.length}`, update() {}, close() {}, hide() {} }; } };
    const window = { uiShell: 'mobile', wsClient, wmShell, AndroidNotification: {}, addEventListener: () => {} };
    const app = messaging(window);
    window.wmMessaging = { inboxAdopt: app.adopt, inboxDrop: () => {} };
    const ctx = {
        window, document, localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console,
    };
    vm.createContext(ctx);
    vm.runInContext(INBOX, ctx, { filename: 'wmNotificationInbox.js' });
    assert.strictEqual(window.wmNotificationInbox.mailStacked(), true);

    const notice = Object.assign({ id: 'mail:a:INBOX:9', app: 'messaging', cls: 'mail', title: 'New E-mail Message', text: 'From: S\ns9', state: 'new', createdAt: Date.now() + 1000, alert: true }, mail(9));
    handlers.get('inbox_updated')({ data: { reason: 'new', notice } });
    // no page app raises it within the inbox's wait (PRODUCER_MS)
    const wait = timers.find((t) => t.ms === 1500);
    assert.ok(wait, 'the inbox waits for a page app first');
    wait.fn();
    app.flush();
    assert.strictEqual(notes.length, 1, 'one box, the inbox\'s own');
    assert.strictEqual(notes[0].silent, false, 'and it sounds, in the Android app too');
    assert.deepStrictEqual(acks, ['mail:a:INBOX:9=seen']);
    assert.strictEqual(app.ctx.imapPending.size, 1, 'Messaging still counts it for the envelope');

    // a stack caught up on resume: counted by Messaging, silent
    assert.strictEqual(app.adopt(mail(10), {}), true);
    app.flush();
    assert.strictEqual(app.shown[app.shown.length - 1], true, 'caught up: silent');
    assert.strictEqual(notes.length, 1, 'no second box');

    console.log('test-wm-mail-adopt: ok');
})().catch((err) => { console.error(err); process.exit(1); });
