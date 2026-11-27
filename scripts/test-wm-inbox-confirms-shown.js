#!/usr/bin/env node
/**
 * The page confirms every notice whose box it has up (#1321): the Android app posts no Android notification any more and
 * draws its own box over a page that does not say "shown", so a silent early return would make two boxes. News under an id
 * whose box is still up is drawn again, sounding, never only confirmed. Runs the real inbox script in a fake phone page.
 * Silent: no sound is played.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const INBOX = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/wmNotificationInbox.js'), 'utf8');

const handlers = new Map();
const notes = [];
const closed = [];
const claims = [];
const up = new Set();
const document = { hidden: false, documentElement: { classList: { contains: () => true } }, querySelectorAll: () => [], addEventListener: () => {}, getElementById: (id) => (up.has(id) ? { addEventListener: () => {} } : null) };
const wsClient = {
    isConnected: () => true,
    on: (t, fn) => { handlers.set(t, fn); },
    sendMessage: (type) => Promise.resolve(type === 'inbox_list' ? { data: { notices: [], total: 0 } } : {}),
};
const wmShell = {
    appNote: (opts) => {
        notes.push(opts);
        const id = `toast-${notes.length}`;
        up.add(id);
        return { id, update() {}, close() { up.delete(id); closed.push(id); }, hide() {} };
    },
};
const window = { uiShell: 'mobile', wsClient, wmShell, AndroidInbox: { shown: (id) => claims.push(id) }, AndroidNotification: {}, addEventListener: () => {} };
const ctx = {
    window, document, localStorage: { getItem: (k) => (k === 'userType' ? 'admin' : null) },
    setTimeout: () => 0, clearTimeout: () => {},
    Date, Promise, JSON, Map, Set, String, Number, Array, Object, Math, console,
};
vm.createContext(ctx);
vm.runInContext(INBOX, ctx, { filename: 'wmNotificationInbox.js' });

const update = (notice) => handlers.get('inbox_updated')({ data: { reason: 'new', notice } });
function run(label, notice) {
    const first = notes.length;
    update(Object.assign({ alert: true }, notice));
    assert.strictEqual(notes.length, first + 1, `${label}: its box comes up`);
    assert.strictEqual(claims.length > 0 && claims[claims.length - 1], notice.id, `${label}: the app is told`);

    claims.length = 0;
    update(Object.assign({ alert: false }, notice));
    assert.strictEqual(notes.length, first + 1, `${label}: sent again quietly, no second box`);
    assert.deepStrictEqual(claims, [notice.id], `${label}: and the app is told again, or it draws its box over ours`);

    claims.length = 0;
    const gone = closed.length;
    update(Object.assign({ alert: true }, notice, { text: 'the next one' }));
    assert.strictEqual(notes.length, first + 2, `${label}: news under the same id comes up again`);
    assert.strictEqual(closed.length, gone + 1, `${label}: in place of the old box`);
    assert.strictEqual(notes[notes.length - 1].silent, false, `${label}: sounding`);
    assert.deepStrictEqual(claims, [notice.id], `${label}: confirmed once`);
    claims.length = 0;
}

const base = (id, cls, kind) => ({ id, cls, title: 'T', text: 'x', state: 'new', createdAt: Date.now() + 1000, data: { kind } });
run('a server notice', base('director:s:turn', 'director', 'director'));
run('a reminder', Object.assign(base('rem:1', 'reminder', 'reminder'), { data: {} }));

// a stack whose box is up and does not change is confirmed too
const stack = { id: 'stack:mail', cls: 'mail', title: '2 New E-mail Messages', text: '', state: 'new', createdAt: Date.now() + 1000, data: { kind: 'stack', stack: true, items: [{ id: 'a', title: 'a', text: 'a' }, { id: 'b', title: 'b', text: 'b' }] } };
const before = notes.length;
update(Object.assign({ alert: true }, stack));
if (notes.length === before + 1) {
    claims.length = 0;
    update(Object.assign({ alert: false }, stack));
    assert.strictEqual(notes.length, before + 1, 'a stack changed in place: one box');
    assert.deepStrictEqual(claims, ['stack:mail'], 'and the app is told it is shown');
} else {
    assert.fail('the stack drew no box: the fake stack no longer matches isStack()');
}

console.log('test-wm-inbox-confirms-shown: ok');
process.exit(0);
