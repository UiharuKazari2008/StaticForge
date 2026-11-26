#!/usr/bin/env node
/**
 * A flood of mail is ONE stacked notice (Yozora 1098: group, dampen and order notifications).
 *
 * Replays the server's `stack:mail` pushes (the contract of modules/notificationInbox.js: the first mail alert true, every
 * further one alert false with the item added) through public/scripts/comp/wmNotificationInbox.js in a fake page and checks:
 * - ten mails in a row: one box, one sound (appNote silent false once, never again), updated in place, one seen ack;
 * - the box lists the newest five as one-line rows, then "+ 5 more", and carries the count 10 for the tray badge;
 * - a silent update that changes nothing writes nothing;
 * - a row opens THAT message (Messaging.openImapMessage / openMail), clears that item and hides the box;
 * - the box body opens the mail list, acting on the stack; Dismiss acks the stack cleared;
 * - a new loud stack (alert true) comes up again, sounding;
 * - a page behind shows nothing live; on resume the stack shows once, quietly in the Android app;
 * - Messaging is told the inbox owns the mail note (mailStacked);
 * - wmShell.orderNotes: fresh notices newest first, older by priority then newest.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmNotificationInbox.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmShell.js'), 'utf8');

function page() {
    const handlers = new Map();
    const notes = []; // every appNote made: { opts, updates, hidden, open, el }
    const acks = [];
    const opened = [];
    let listed = [];
    const els = new Map();
    const document = {
        hidden: false,
        documentElement: { classList: { contains: (c) => c === 'ui-mobile' } },
        querySelectorAll: () => [],
        addEventListener: () => {},
        getElementById: (id) => els.get(id) || null,
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
        appNote: (opts) => {
            const id = `toast-${notes.length + 1}`;
            const el = { clickers: [], addEventListener(t, fn) { if (t === 'click') this.clickers.push(fn); } };
            els.set(id, el);
            const n = {
                id, opts, el, updates: [], hidden: 0, open: true,
                update(o) { this.updates.push(o); },
                hide() { this.hidden++; },
                close() { this.open = false; els.delete(id); },
            };
            notes.push(n);
            return n;
        },
    };
    const wmMessaging = {
        openImapMessage: (...a) => opened.push(['imap', ...a]),
        openMail: (...a) => opened.push(['mail', ...a]),
        openAccount: (...a) => opened.push(['account', ...a]),
        showAccounts: () => opened.push(['accounts']),
        inboxDrop: (n) => opened.push(['drop', n.data && (n.data.uid != null ? n.data.uid : n.data.id)]),
        inboxAdopt: (n) => { opened.push(['adopt', n.data.uid]); return true; },
    };
    const window = { uiShell: 'mobile', wsClient, wmShell, wmMessaging, addEventListener: () => {} };
    const ctx = {
        window, document,
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        setTimeout: () => 1, clearTimeout: () => {},
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console,
    };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'wmNotificationInbox.js' });
    return {
        notes, acks, opened, window, document,
        push: (notice) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'new', notice } }),
        remote: (id, state) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'ack', id, state } }),
        setList: (l) => { listed = l; },
        reconnect: () => handlers.get('connected')(),
        click: (note, target) => note.el.clickers.forEach((fn) => fn({ target })),
    };
}

const flush = () => new Promise((r) => setImmediate(r));
const ID = 'stack:mail';
const mailItem = (k, extra = {}) => ({
    id: `mail:acct1:INBOX:${k}`, title: 'New E-mail Message', text: `From: Sender ${k}\nSubject ${k}`, at: 1000 + k,
    data: { app: 'messaging', kind: 'mail', accountId: 'acct1', folder: 'INBOX', uid: k, from: `Sender ${k}`, subject: `Subject ${k}` },
    actions: ['view'], ...extra,
});
// the server's stack row after k mails (newest first), alert on the first only
function stack(k, extra = {}) {
    const items = [];
    for (let i = k; i >= 1; i--) items.push(mailItem(i));
    return Object.assign({
        id: ID, app: 'messaging', cls: 'mail', title: k === 1 ? 'New E-mail Message' : `${k} New E-mail Messages`,
        text: items.slice(0, 6).map((x) => `${x.data.from} - ${x.data.subject}`).join('\n'),
        data: { stack: 'mail', count: k, lastAt: 1000 + k, items }, actions: ['view'], state: 'new',
        createdAt: 1000, updatedAt: 1000 + k, sortAt: 1000 + k, prio: 2, alert: k === 1,
    }, extra);
}
const rowOf = (item) => ({ closest: (sel) => (sel === '.wm-stack-row' ? { dataset: { item } } : null) });
const bodyOf = () => ({ closest: (sel) => (sel === '[data-wm-tap]' ? {} : null) });

(async () => {
    // ten mails in a row, page in front
    const p = page();
    await flush();
    assert.strictEqual(p.window.wmNotificationInbox.mailStacked(), true, 'the inbox owns the mail note');
    p.push(stack(1));
    assert.strictEqual(p.notes.length, 1, 'mail 1: one box');
    assert.strictEqual(p.notes[0].opts.silent, false, 'mail 1 sounds (alert true)');
    assert.strictEqual(p.notes[0].opts.badge, 0, 'one mail: no badge');
    assert.strictEqual(p.notes[0].opts.event, 'mail', 'the mail sound class');
    for (let k = 2; k <= 10; k++) p.push(stack(k));
    assert.strictEqual(p.notes.length, 1, 'ten mails: still one box');
    assert.strictEqual(p.notes.filter((n) => !n.opts.silent).length, 1, 'ten mails: one sound');
    assert.strictEqual(p.notes[0].updates.length, 9, 'nine in-place updates');
    const last = p.notes[0].updates[8];
    assert.strictEqual(last.title, '10 New E-mail Messages', 'title is the count');
    assert.strictEqual(last.badge, 10, 'the badge is the count in the stack');
    assert.strictEqual(last.sortAt, 1010, 'the sort time moves with the newest item');
    assert.strictEqual(last.prio, 2, 'prio carried');
    assert.strictEqual((last.html.match(/class="wm-stack-row"/g) || []).length, 5, 'five rows');
    assert.ok(last.html.includes('+ 5 more'), '"+ 5 more" under them');
    assert.ok(last.html.indexOf('Subject 10') < last.html.indexOf('Subject 9') && !last.html.includes('Subject 5<'), 'newest first, the oldest left to "more"');
    assert.ok(last.html.includes('data-wm-tap="list"'), 'the body answers a tap');
    assert.ok(last.update === undefined && !('silent' in last), 'an update carries no sound flag');
    assert.deepStrictEqual(p.acks, [`${ID}=seen`], 'one seen ack for the whole flood');

    // the same stack again changes nothing: nothing written
    p.push(stack(10));
    assert.strictEqual(p.notes[0].updates.length, 9, 'an unchanged update writes nothing');

    // a row opens that message and drops that item; the box goes (hide)
    p.click(p.notes[0], rowOf('mail:acct1:INBOX:7'));
    assert.deepStrictEqual(p.opened.filter((o) => o[0] !== 'drop'), [['imap', 'acct1', 'INBOX', 7]], 'row opens THAT message');
    assert.ok(p.acks.includes('mail:acct1:INBOX:7=cleared'), 'its item is cleared on the server');
    assert.strictEqual(p.notes[0].hidden, 1, 'the box is hidden, the rest stay');
    // the body opens the list and acts on the stack
    p.opened.length = 0;
    p.click(p.notes[0], bodyOf());
    assert.deepStrictEqual(p.opened, [['account', 'imap:acct1', 'INBOX']], 'body opens that account\'s mail list');
    assert.ok(p.acks.includes(`${ID}=acted`) && !p.notes[0].open, 'the stack is acted on and its box gone');

    // a new loud stack after that: a new box, sounding
    p.push(stack(1));
    assert.strictEqual(p.notes.length, 2, 'next mail after acting: a new box');
    assert.strictEqual(p.notes[1].opts.silent, false, 'and it sounds');

    // a loud notice while a box is up replaces it (the server began a new stack under the id)
    p.push(stack(1, { alert: true }));
    assert.strictEqual(p.notes.length, 3, 'a new loud stack comes up again');
    assert.strictEqual(p.notes.filter((n) => n.open).length, 1, 'never two boxes');

    // Dismiss: acks the stack cleared (softkey), remote clear closes the box
    const keys = p.notes[2].opts.softKeys();
    keys.left.action();
    assert.ok(p.acks.includes(`${ID}=cleared`) && !p.notes[2].open, 'Dismiss clears the stack');
    p.push(stack(3, { alert: true }));
    p.remote(ID, 'cleared');
    assert.strictEqual(p.notes.filter((n) => n.open).length, 0, 'cleared elsewhere: the box goes');

    // a dovecote item opens by its id; several accounts open the account list
    const d = page();
    await flush();
    const dm = { id: 'dmail:9', title: 'New E-mail Message', text: 'x', at: 5, data: { app: 'messaging', kind: 'dovecote', id: 9, from: 'Agent', subject: 'Hi' } };
    d.push(stack(1, { data: { stack: 'mail', count: 2, lastAt: 6, items: [dm, mailItem(1)] }, alert: true }));
    d.click(d.notes[0], rowOf('dmail:9'));
    assert.deepStrictEqual(d.opened.filter((o) => o[0] !== 'drop'), [['mail', 9]], 'a dovecote row opens its mail by id');
    d.opened.length = 0;
    d.click(d.notes[0], bodyOf());
    assert.deepStrictEqual(d.opened, [['accounts']], 'mixed accounts: the account list');

    // the page behind: nothing live; on resume the stack shows once (silent in the Android app)
    const h = page();
    await flush();
    h.document.hidden = true;
    h.push(stack(4, { alert: true }));
    assert.strictEqual(h.notes.length, 0, 'hidden: nothing live');
    h.document.hidden = false;
    h.window.AndroidDevice = {};
    h.setList([stack(4, { createdAt: Date.now() - 5000 })]);
    h.reconnect();
    await flush(); await flush();
    assert.strictEqual(h.notes.length, 1, 'resume: one box');
    assert.strictEqual(h.notes[0].opts.silent, true, 'in the Android app the box comes without a second sound');
    assert.strictEqual(h.notes[0].opts.badge, 4, 'with its count');
    assert.deepStrictEqual(h.opened.filter((o) => o[0] === 'adopt').length, 4, 'its items join Messaging\'s count');
    // more mail arrived meanwhile: resume changes the box in place
    h.setList([stack(6, { updatedAt: Date.now() + 10 })]);
    h.reconnect();
    await flush(); await flush();
    assert.strictEqual(h.notes.length, 1, 'a later resume: still one box');
    assert.strictEqual(h.notes[0].updates.length, 1, 'changed in place');
    assert.strictEqual(h.notes[0].updates[0].badge, 6, 'badge 6');

    // wmShell.orderNotes: fresh first and newest first; older by prio, then newest; no sortAt: when first seen, prio 1
    const src = SHELL.slice(SHELL.indexOf('const NOTE_FRESH_MS'), SHELL.indexOf('const noteOf = '));
    assert.ok(src.includes('function orderNotes'), 'orderNotes found');
    const NOW = 10 * 3600 * 1000;
    const appNotes = new Map();
    const ctx = { appNotes, Date: { now: () => NOW }, Number, Map, Set };
    vm.createContext(ctx);
    vm.runInContext(`${src}; this.orderNotes = orderNotes;`, ctx);
    const min = 60000;
    const mk = (id) => ({ id, ids: [id] });
    appNotes.set('a', { sortAt: NOW - 2 * min, prio: 1 });   // fresh, older of the fresh
    appNotes.set('b', { sortAt: NOW - 1 * min, prio: 1 });   // fresh, newest -> top
    appNotes.set('c', { sortAt: NOW - 60 * min, prio: 4 });  // old, high priority
    appNotes.set('d', { sortAt: NOW - 30 * min, prio: 2 });  // old, medium, newer
    appNotes.set('e', { sortAt: NOW - 90 * min, prio: 2 });  // old, medium, older
    const order = ctx.orderNotes([mk('e'), mk('a'), mk('d'), mk('c'), mk('b'), mk('f')]).map((n) => n.id);
    // f has no sortAt: first seen now -> fresh, and the newest of all
    assert.deepStrictEqual(order, ['f', 'b', 'a', 'c', 'd', 'e'], 'time first (a new notice on top), priority only among the older');

    console.log('wm notice stack: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
