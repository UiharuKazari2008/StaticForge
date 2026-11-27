#!/usr/bin/env node
/**
 * Fleet's notices on the page (Yozora 1291, modules/fleetNotices.js): the client-side bits of their registration.
 *
 * Replays Fleet's inbox pushes through public/scripts/comp/wmNotificationInbox.js in a fake page (the harness of
 * scripts/test-wm-notice-stack.js) with the real status table (status-order.js) and checks:
 * - a single work-done / work-attention / account-login notice: its own bar glyph, its own holder kind, the Fleet sound
 *   class (the notice's cls 'fleet'), and its Menu > View opens Fleet on that work item (wmShell.open('claude-accounts',
 *   { workId, page }) - the phone's program id, not the desktop package id 'claudedesk');
 * - stack:fleetdone / stack:fleetattn: one box with a count, not titled as e-mail, its rows "<title> - <text>", a tap on a
 *   row opens THAT work item and clears that entry, the body opens Fleet (never Messaging), Dismiss clears the stack;
 * - a mail stack beside them still opens Messaging;
 * - the Fleet sound event exists in wmShell's SND_EVENTS (id 'fleet', "Fleet", its own default sound).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmNotificationInbox.js'), 'utf8');
const ORDER = fs.readFileSync(path.join(ROOT, 'public/scripts/tasks/status-order.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmShell.js'), 'utf8');

function page() {
    const handlers = new Map();
    const notes = [];
    const acks = [];
    const opened = [];
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
            if (type === 'inbox_list') return Promise.resolve({ data: { notices: [], total: 0 } });
            return Promise.resolve({});
        },
    };
    const wmShell = {
        open: (id, opts) => opened.push(['open', id, opts ? { workId: opts.workId, page: opts.page } : null]),
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
        inboxDrop: () => {},
        inboxAdopt: () => true,
    };
    const window = { uiShell: 'mobile', wsClient, wmShell, wmMessaging, addEventListener: () => {} };
    const ctx = {
        window, document,
        localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
        setTimeout: () => 1, clearTimeout: () => {},
        Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console,
    };
    vm.createContext(ctx);
    vm.runInContext(ORDER, ctx, { filename: 'status-order.js' });
    window.CafeTasks = ctx.CafeTasks;
    vm.runInContext(SRC, ctx, { filename: 'wmNotificationInbox.js' });
    return {
        notes, acks, opened, window,
        push: (notice) => handlers.get('inbox_updated')({ type: 'inbox_updated', data: { reason: 'new', notice } }),
        click: (note, target) => note.el.clickers.forEach((fn) => fn({ target })),
    };
}

const flush = () => new Promise((r) => setImmediate(r));
const APP = 'claudedesk';
const doneItem = (k) => ({ id: `fleet-work:${k}:done`, title: `Work item ${k} is done`, text: `Fix the thing ${k}\nCommitted.`, at: 1000 + k, data: { app: APP, kind: 'work-done', workId: k }, actions: [] });
const stackOf = (id, kind, items, extra = {}) => Object.assign({
    id, app: APP, cls: 'fleet', title: `${items.length} Work items`, text: '', state: 'new', createdAt: 1000, updatedAt: 2000, sortAt: 2000, prio: 2, alert: true,
    data: { stack: id.slice(6), count: items.length, lastAt: 2000, items },
}, extra);
const rowOf = (item) => ({ closest: (sel) => (sel === '.wm-stack-row' ? { dataset: { item } } : null) });
const bodyOf = () => ({ closest: (sel) => (sel === '[data-wm-tap]' ? {} : null) });

(async () => {
    // the sound event
    const ev = /\{ id: 'fleet', label: 'Fleet', kind: 'note', sound: '([^']+)'/.exec(SHELL);
    assert.ok(ev, 'wmShell SND_EVENTS has the Fleet event');
    assert.ok(!/Alarm[23]\./.test(ev[1]), 'its own default sound, not Alarm2 / Alarm3');
    assert.ok(fs.existsSync(path.join(ROOT, 'public/sounds/wm61', ev[1])), 'the sound file exists');

    // single notices
    const p = page();
    await flush();
    const one = (n) => { const before = p.notes.length; p.push(n); assert.strictEqual(p.notes.length, before + 1, `${n.id}: shown`); return p.notes[before]; };
    const d1 = one({ id: 'fleet-work:7:done', app: APP, cls: 'fleet', title: 'Work item 7 is done', text: 'x', state: 'new', data: { app: APP, kind: 'work-done', workId: 7 } });
    assert.strictEqual(d1.opts.icon, 'status-fleet-done', 'done: the check glyph');
    assert.strictEqual(d1.opts.holder, 'fleet-done', 'done: the green check holder');
    assert.strictEqual(d1.opts.event, 'fleet', 'done: the Fleet sound class');
    const a1 = one({ id: 'fleet-work:7:attention', app: APP, cls: 'fleet', title: 'Work item 7 needs you', text: 'x', state: 'new', data: { app: APP, kind: 'work-attention', workId: 7, state: 'input' } });
    assert.strictEqual(a1.opts.icon, 'status-fleet-attn', 'attention: the exclamation glyph');
    assert.strictEqual(a1.opts.holder, 'fleet-attention');
    const l1 = one({ id: 'fleet-account:2:login', app: APP, cls: 'fleet', title: 'Sign in', text: 'x', state: 'new', data: { app: APP, kind: 'account-login', accountIndex: 2, page: 'accounts' } });
    assert.strictEqual(l1.opts.icon, 'status-fleet-login', 'login: the key glyph');
    assert.strictEqual(l1.opts.holder, 'fleet-login');
    const view = (note) => note.opts.softKeys().right.menu().find((m) => m.label === 'View').action();
    view(d1);
    assert.deepStrictEqual(p.opened.pop(), ['open', 'claude-accounts', { workId: 7, page: undefined }], 'View opens Fleet on the work item');
    view(l1);
    assert.deepStrictEqual(p.opened.pop(), ['open', 'claude-accounts', { workId: undefined, page: 'accounts' }], 'the login notice opens Fleet on its page');

    // a stack of done notices: one box, a count, its rows, a tap on a row opens that item
    const q = page();
    await flush();
    q.push(stackOf('stack:fleetdone', 'work-done', [doneItem(3), doneItem(2), doneItem(1)]));
    assert.strictEqual(q.notes.length, 1, 'one box for the stack');
    const box = q.notes[0];
    assert.strictEqual(box.opts.event, 'fleet', 'one Fleet sound');
    assert.strictEqual(box.opts.icon, 'status-fleet-done', 'the stack row has the done glyph');
    assert.strictEqual(box.opts.holder, 'fleet-done', 'and the done holder picture');
    assert.strictEqual(box.opts.badge, 3, 'the count on the tray icon');
    assert.ok(!/e-mail/i.test(box.opts.title), 'not titled as e-mail');
    assert.strictEqual((box.opts.html.match(/class="wm-stack-row"/g) || []).length, 3, 'a row per item');
    assert.ok(box.opts.html.includes('Work item 3 is done') && box.opts.html.includes('Fix the thing 3'), 'a row names its item');
    q.click(box, rowOf('fleet-work:2:done'));
    assert.deepStrictEqual(q.opened, [['open', 'claude-accounts', { workId: 2, page: undefined }]], 'a row opens THAT work item in Fleet');
    assert.ok(q.acks.includes('fleet-work:2:done=cleared'), 'its entry leaves the stack');
    assert.strictEqual(box.hidden, 1, 'the box is hidden, the rest stay');
    q.opened.length = 0;
    q.click(box, bodyOf());
    assert.deepStrictEqual(q.opened, [['open', 'claude-accounts', { workId: undefined, page: undefined }]], 'the body opens Fleet, never Messaging');
    assert.ok(q.acks.includes('stack:fleetdone=acted'), 'the stack is acted on');

    // the attention stack
    q.push(stackOf('stack:fleetattn', 'work-attention', [{ id: 'fleet-work:9:attention', title: 'Work item 9 needs you', text: 'Which branch?', at: 1, data: { app: APP, kind: 'work-attention', workId: 9 }, actions: [] }, { id: 'fleet-work:8:attention', title: 'Work item 8 needs you', text: 'Pick one', at: 0, data: { app: APP, kind: 'work-attention', workId: 8 }, actions: [] }]));
    const att = q.notes[q.notes.length - 1];
    assert.strictEqual(att.opts.icon, 'status-fleet-attn');
    assert.strictEqual(att.opts.holder, 'fleet-attention');
    q.opened.length = 0;
    q.click(att, rowOf('fleet-work:8:attention'));
    assert.deepStrictEqual(q.opened, [['open', 'claude-accounts', { workId: 8, page: undefined }]], 'an attention entry opens its work item');
    att.opts.softKeys().left.action();
    assert.ok(q.acks.includes('stack:fleetattn=cleared') && !att.open, 'Dismiss clears the stack');

    // the mail stack is still Messaging's
    const m = page();
    await flush();
    const mi = (k) => ({ id: `mail:acct1:INBOX:${k}`, title: 'New E-mail Message', text: `From: S${k}\nSubject ${k}`, at: k, data: { app: 'messaging', kind: 'mail', accountId: 'acct1', folder: 'INBOX', uid: k, from: `S${k}`, subject: `Subject ${k}` }, actions: [] });
    m.push({ id: 'stack:mail', app: 'messaging', cls: 'mail', title: '2 New E-mail Messages', text: '', state: 'new', createdAt: 1, updatedAt: 2, sortAt: 2, prio: 2, alert: true, data: { stack: 'mail', count: 2, lastAt: 2, items: [mi(2), mi(1)] } });
    m.click(m.notes[0], bodyOf());
    assert.deepStrictEqual(m.opened, [['account', 'imap:acct1', 'INBOX']], 'the mail stack still opens Messaging');

    console.log('fleet notice stack: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
