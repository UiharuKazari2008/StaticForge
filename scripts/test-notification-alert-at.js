#!/usr/bin/env node
/**
 * alertAt (StaticForge #1367): every notice carries when it was last published as news (0: never). The phone's app and page
 * name one event by the notice id and that time, so the event sounds once. Checks the rules of modules/notificationInbox.js
 * (single notices, stacks, the marks of dealt-with items), that the pages' inbox_updated, inbox_list and the phone's
 * packet (first send, resend, catch-up) carry it, and the add-once column of an older database.
 *
 *   node scripts/test-notification-alert-at.js [path/to/notificationInbox.js]
 *
 * The optional path is for proving the checks can fail (a copy of the module without the change; it is compiled under the
 * real module's path). The database is in memory, or a throwaway file for the migration: never the real inbox.
 */
'use strict';

process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const REAL = path.join(__dirname, '..', 'modules', 'notificationInbox.js');
if (process.argv[2]) {
    const from = path.resolve(process.argv[2]);
    const load = Module._extensions['.js'];
    Module._extensions['.js'] = function (mod, filename) {
        if (filename === REAL) return mod._compile(fs.readFileSync(from, 'utf8'), filename);
        return load.apply(this, arguments);
    };
}

const as = require('../modules/activeSync');
const inbox = require(REAL);

let now = 1_000_000;
inbox._test.setNow(() => now);

// a fake phone link and fake pages: what each was sent
const toPhone = [];
as.sendInboxNotice = (_gr, _ws, notice, opts = {}) => {
    toPhone.push(Object.assign({}, notice));
    if (Array.isArray(opts.sentTo)) opts.sentTo.push('phone');
    return 1;
};
as.sendInboxCleared = () => 1;
const toPages = [];
inbox.bind({ getPath: () => null, getWebSocketServer: () => ({ broadcast: (m) => { if (m.type === 'inbox_updated') toPages.push(m.data); } }) });

const tick = () => { now += 1000; return now; };
const row = (id) => inbox.list('admin', { includeCleared: true }).find((n) => n.id === id);
const lastPage = (id) => [...toPages].reverse().find((d) => d.notice && d.notice.id === id);
const lastPhone = (id) => [...toPhone].reverse().find((n) => n.id === id);
const send = (o) => inbox.publish(Object.assign({ app: 'weather', title: 'T', cls: 'reminder' }, o));

let step = 0;
const ok = (msg) => console.log(`  ${++step}. ${msg}`);

// 1. a loud publish: now, on the page's packet, the list and the phone's packet
{
    const at = tick();
    const out = send({ id: 'a:1', text: 'one' });
    assert.strictEqual(out.alertAt, at, 'publish returns it');
    assert.strictEqual(row('a:1').alertAt, at, 'inbox_list carries it');
    assert.strictEqual(lastPage('a:1').notice.alertAt, at, 'inbox_updated carries it');
    assert.strictEqual(lastPhone('a:1').alertAt, at, 'the phone packet carries it');
    ok('a loud publish sets alertAt to now (publish, inbox_list, inbox_updated, phone packet)');

    // 2. a silent update of the live row keeps it, new or seen
    tick();
    send({ id: 'a:1', text: 'one, updated' });
    assert.strictEqual(lastPhone('a:1').alert, false, 'silent');
    assert.strictEqual(row('a:1').alertAt, at);
    assert.strictEqual(lastPhone('a:1').alertAt, at);
    assert.strictEqual(lastPage('a:1').notice.alertAt, at);
    inbox.ack('admin', 'a:1', 'seen', 'phone');
    tick();
    send({ id: 'a:1', text: 'one, updated again', alert: false });
    assert.strictEqual(row('a:1').alertAt, at, 'a seen row too');
    ok('a silent publish onto a live row (new or seen) keeps its alertAt');

    // 3. real news on the live row: now again
    const at2 = tick();
    send({ id: 'a:1', text: 'another event', alert: true });
    assert.strictEqual(row('a:1').alertAt, at2);
    ok('news on a live row sets it to now again');
}

// 4. a silent publish that creates a row: 0
{
    tick();
    const out = send({ id: 'a:2', text: 'quietly', alert: false });
    assert.strictEqual(out.alertAt, 0);
    assert.strictEqual(row('a:2').alertAt, 0);
    assert.strictEqual(lastPhone('a:2').alertAt, 0);
    assert.strictEqual(lastPage('a:2').notice.alertAt, 0);
    ok('a silent publish that creates a row sets 0');
}

// 5. a done row: unchanged stays done and untouched; brought back silently: 0; brought back loud: now
{
    const at = tick();
    send({ id: 'a:3', text: 'hold' });
    inbox.ack('admin', 'a:3', 'cleared', 'phone');
    tick();
    const same = send({ id: 'a:3', text: 'hold' });
    assert.strictEqual(same.alert, false, 'the early return still answers a silent row');
    assert.strictEqual(same.state, 'cleared', 'it stays dealt with');
    assert.strictEqual(same.alertAt, at, 'its alertAt is not touched');
    tick();
    send({ id: 'a:3', text: 'hold on', alert: false });
    assert.strictEqual(row('a:3').state, 'new', 'brought back');
    assert.strictEqual(row('a:3').alertAt, 0, 'silently: 0');
    inbox.ack('admin', 'a:3', 'cleared', 'phone');
    const back = tick();
    send({ id: 'a:3', text: 'another hold' });
    assert.strictEqual(row('a:3').alertAt, back, 'loud: now');
    ok('a done row: stays (untouched), comes back silent with 0, comes back loud with now');
}

// 6. resend and catch-up read the row: the same alertAt
{
    const at = tick();
    send({ id: 'a:4', text: 'resend me' });
    toPhone.length = 0;
    now += 20000;
    inbox._test.resendDue();
    const again = lastPhone('a:4');
    assert.ok(again && again.resent === true, 'sent again');
    assert.strictEqual(again.alertAt, at);
    toPhone.length = 0;
    inbox.catchUpPhone('other-phone');
    const caught = toPhone.find((n) => n.catchUp);
    assert.ok(caught, 'a catch-up went');
    assert.strictEqual(caught.alertAt, row(caught.id).alertAt);
    assert.ok(caught.alertAt > 0);
    ok('a resend and a catch-up carry the row\'s alertAt');
}

// 7. stacks
{
    const mail = (id, extra) => inbox.publish(Object.assign({ app: 'messaging', cls: 'mail', stack: 'mail', id, title: 'New E-mail Message', text: id, data: { kind: 'mail' } }, extra || {}));
    const at = tick();
    mail('mail:x:INBOX:1', { digest: 'm1' });
    assert.strictEqual(row('stack:mail').alertAt, at);
    assert.strictEqual(lastPhone('stack:mail').alertAt, at);
    ok('a new stack: now');

    tick();
    mail('mail:x:INBOX:2', { digest: 'm2' });
    assert.strictEqual(lastPhone('stack:mail').alert, false);
    assert.strictEqual(row('stack:mail').alertAt, at);
    tick();
    mail('mail:x:INBOX:2', { digest: 'm2' });
    assert.strictEqual(row('stack:mail').alertAt, at);
    ok('a silent join, and the same item again, keep it');

    const news = tick();
    mail('mail:x:INBOX:1', { digest: 'm1-changed', alert: true });
    assert.strictEqual(lastPhone('stack:mail').alert, true);
    assert.strictEqual(row('stack:mail').alertAt, news);
    ok('an item with news: now');

    tick();
    inbox.clear('admin', 'mail:x:INBOX:2', 'phone');
    assert.strictEqual(lastPage('stack:mail').notice.alert, false, 'rewritten silently');
    assert.strictEqual(row('stack:mail').alertAt, news);
    assert.strictEqual(lastPhone('stack:mail').alertAt, news);
    assert.strictEqual(row('mail:x:INBOX:2').alertAt, 0, 'the mark of the item dealt with');
    ok('a silent rewrite keeps it; the mark of an item dealt with has 0');

    inbox.ack('admin', 'stack:mail', 'cleared', 'phone');
    assert.strictEqual(row('mail:x:INBOX:1').alertAt, 0);
    tick();
    const dealt = mail('mail:x:INBOX:1', { digest: 'm1-changed' });
    assert.deepStrictEqual([dealt.alert, dealt.state, dealt.alertAt], [false, 'cleared', 0], 'the dealt-with early return as before');
    const fresh = tick();
    mail('mail:x:INBOX:3', { digest: 'm3' });
    assert.strictEqual(row('stack:mail').alertAt, fresh);
    ok('a whole stack cleared marks its items with 0; the next stack starts with now');
}

// 8. the add-once column of a database from before alertAt: waiting rows count as news from when they were made
{
    const Database = require('better-sqlite3');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-alert-at-'));
    const file = path.join(dir, 'notifications.db');
    const old = new Database(file);
    old.exec(`CREATE TABLE notices (user TEXT NOT NULL, id TEXT NOT NULL, app TEXT NOT NULL DEFAULT '', cls TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL DEFAULT '', actions TEXT NOT NULL DEFAULT '[]', data TEXT NOT NULL DEFAULT '{}',
        createdAt INTEGER NOT NULL, expiresAt INTEGER, state TEXT NOT NULL DEFAULT 'new', actedBy TEXT, updatedAt INTEGER NOT NULL, digest TEXT,
        PRIMARY KEY (user, id))`);
    old.prepare("INSERT INTO notices (user, id, title, text, createdAt, updatedAt) VALUES ('admin', 'old:1', 'Old', 'waiting', 4242, 4242)").run();
    old.close();
    try {
        inbox._test.reset();
        process.env.NOTIFICATION_INBOX_DB = file;
        assert.strictEqual(row('old:1').alertAt, 4242);
        // added once: a later open leaves the rows as they are
        const quiet = send({ id: 'a:9', text: 'silent', alert: false });
        assert.strictEqual(quiet.alertAt, 0);
        inbox._test.reset();
        assert.strictEqual(row('a:9').alertAt, 0, 'not filled again');
        assert.strictEqual(row('old:1').alertAt, 4242);
        ok('an older database gets the column once: existing rows alertAt = createdAt');
    } finally {
        inbox._test.reset();
        process.env.NOTIFICATION_INBOX_DB = ':memory:';
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

console.log('test-notification-alert-at: ok');
process.exit(0);
