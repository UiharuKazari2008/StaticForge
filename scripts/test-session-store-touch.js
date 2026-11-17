#!/usr/bin/env node
/**
 * The session store's per-request write (#890, modules/sessionStoreTouch.js) on a real connect-sqlite3
 * store in a temp folder: WAL journal (concurrentDb), synchronous NORMAL, touch() skipped for a session
 * touched or saved within the window, written again after it, and expired rows still unreadable.
 *   node scripts/test-session-store-touch.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const { tuneSessionStore } = require('../modules/sessionStoreTouch');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-touch-'));
const p = (fn) => new Promise((resolve, reject) => fn((err, v) => (err ? reject(err) : resolve(v))));

(async () => {
    const store = new SQLiteStore({ dir, db: 'sessions.sqlite', table: 'sessions', concurrentDb: true });
    await new Promise((r) => store.client.once('connect', r));
    let clock = 1_000_000_000_000;
    tuneSessionStore(store, { now: () => clock });
    const journal = await p((cb) => store.db.get('PRAGMA journal_mode', cb));
    assert.strictEqual(String(journal.journal_mode).toLowerCase(), 'wal', 'concurrentDb: WAL journal');
    const sync = await p((cb) => store.db.get('PRAGMA synchronous', cb));
    assert.strictEqual(Number(sync.synchronous), 1, 'synchronous NORMAL');

    // count the UPDATEs touch() makes
    let updates = 0;
    const run = store.db.run.bind(store.db);
    store.db.run = (sql, ...args) => { if (/^UPDATE/.test(sql)) updates += 1; return run(sql, ...args); };

    const day = 86400000;
    const sess = (expires) => ({ cookie: { maxAge: 7 * day, expires: new Date(expires).toISOString(), httpOnly: true, path: '/' }, user: 'a' });
    await p((cb) => store.set('sid-1', sess(Date.now() + 7 * day), cb));
    // just saved: the touch is skipped
    await p((cb) => store.touch('sid-1', sess(Date.now() + 7 * day), cb));
    assert.strictEqual(updates, 0, 'a session saved a moment ago is not touched');
    clock += 11 * 60 * 1000;
    await p((cb) => store.touch('sid-1', sess(Date.now() + 7 * day + 5000), cb));
    assert.strictEqual(updates, 1, 'after the window the touch is written');
    await p((cb) => store.touch('sid-1', sess(Date.now() + 7 * day + 6000), cb));
    await p((cb) => store.touch('sid-1', sess(Date.now() + 7 * day + 7000), cb));
    assert.strictEqual(updates, 1, 'touches within the window are skipped');
    const row = await p((cb) => store.db.get('SELECT expired FROM sessions WHERE sid = ?', ['sid-1'], cb));
    assert.ok(row.expired >= Date.now() + 7 * day, 'the stored expiry moved with the written touch');

    // another session is touched on its own clock
    await p((cb) => store.set('sid-2', sess(Date.now() + 7 * day), cb));
    clock += 11 * 60 * 1000;
    await p((cb) => store.touch('sid-2', sess(Date.now() + 7 * day), cb));
    assert.strictEqual(updates, 2);

    // a destroyed session is forgotten; get() still answers for live ones
    await p((cb) => store.destroy('sid-2', cb));
    const got = await p((cb) => store.get('sid-1', cb));
    assert.strictEqual(got.user, 'a');
    assert.strictEqual(await p((cb) => store.get('sid-2', cb)), undefined);

    // an expired row reads as no session (and the library's own cleanup deletes it)
    await p((cb) => store.db.run('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)', ['old', Date.now() - 1000, JSON.stringify(sess(Date.now() - 1000))], cb));
    assert.strictEqual(await p((cb) => store.get('old', cb)), undefined, 'expired: no session');
    await p((cb) => store.db.run('DELETE FROM sessions WHERE ? > expired', [Date.now()], cb));
    const left = await p((cb) => store.db.all('SELECT sid FROM sessions', cb));
    assert.deepStrictEqual(left.map((r) => r.sid), ['sid-1'], 'the cleanup query keeps live sessions');

    clearInterval(store._dsTouchSweep);
    await p((cb) => store.db.close(cb));
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('session store touch: ok');
})().catch((e) => { console.error(e); process.exit(1); });
