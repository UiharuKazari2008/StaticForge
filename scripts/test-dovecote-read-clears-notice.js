#!/usr/bin/env node
/**
 * Dreamscape Mail: opening a message clears its phone "New E-mail Message" (#999). Yukimi (Nov 20 2026): the status bar
 * kept its envelope though Messaging said no unread messages - readMail marked the message read without clearing the
 * notice dmail:<id>, which the status task counts as fresh mail. Also the start-up sweep: a notice left for mail already
 * read or moved goes; one for mail still unread stays.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-read-notice-'));
process.env.NOTIFICATION_INBOX_DB = path.join(tmpDir, 'notifications.db');
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const { resetForTests: resetExchangeDb } = require('../modules/mailExchangeDatabase');
assert.strictEqual(resetExchangeDb(path.join(tmpDir, 'exchange')), true);

const mail = require('../modules/dovecoteMail');
const inbox = require('../modules/notificationInbox');
const sources = require('../modules/notificationInboxSources');
inbox.bind({ getWebSocketServer: () => ({ broadcast: () => {} }) });

const HUMAN = mail.HUMAN_OWNER;
const state = (id) => { const n = inbox.list('admin', { includeCleared: true }).find((x) => x.id === `dmail:${id}`); return n ? n.state : null; };
const send = (subject) => {
    const r = mail.sendMail({ fromOwner: 'rook', to: HUMAN, subject, body: 'body' });
    const m = mail.listMail(HUMAN, { folder: 'inbox', silent: true }).find((x) => x.subject === subject);
    assert.ok(r && m, `delivered: ${subject}`);
    // the delivery event's notice (onDovecoteNewMail is what dovecoteMailboxEvents calls)
    sources.onDovecoteNewMail({ id: m.id, mailbox: HUMAN, from: 'Rook <rook@x>', subject });
    return m.id;
};

try {
    // opened = read: the notice goes
    const a = send('opened');
    assert.strictEqual(state(a), 'new');
    mail.readMail(HUMAN, a);
    assert.strictEqual(state(a), 'cleared', 'readMail clears the phone notice');

    // peeked without marking read: it stays
    const b = send('peeked');
    mail.readMail(HUMAN, b, { markRead: false });
    assert.strictEqual(state(b), 'new', 'markRead false keeps it');

    // the start-up sweep: read behind the inbox's back (an older build) and moved-out mail go, unread stays
    const c = send('read elsewhere');
    const d = send('archived elsewhere');
    const db = require('../modules/dovecoteDatabase').getDb();
    db.prepare('UPDATE dovecote_message SET read = 1 WHERE id = ?').run(c);
    db.prepare("UPDATE dovecote_message SET folder = 'archive' WHERE id = ?").run(d);
    assert.strictEqual(state(c), 'new');
    const gone = sources._test.sweepDovecote();
    assert.strictEqual(gone, 2, 'two stale notices swept');
    assert.strictEqual(state(c), 'cleared');
    assert.strictEqual(state(d), 'cleared');
    assert.strictEqual(state(b), 'new', 'unread mail keeps its notice');
    assert.strictEqual(sources._test.sweepDovecote(), 0, 'a second sweep finds nothing');

    console.log('dovecote read clears notice: all checks passed');
} catch (e) {
    console.error(e);
    process.exitCode = 1;
} finally {
    try { inbox._test.reset(); } catch (_) { /* closed */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
// the mail modules keep timers (mailroom, exchange): end here
process.exit(process.exitCode || 0);
