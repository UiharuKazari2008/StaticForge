'use strict';

// Batch mark/delete/forward (one round trip, own mailbox only) and cursor
// pagination for listMail. Folder unread/total stay folder-wide, not page-sized.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-batch-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');

function sendMany(from, to, n, prefix) {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const sent = mail.sendMail({
            fromOwner: from,
            to: to,
            subject: prefix + '-' + String(i).padStart(3, '0'),
            body: 'body ' + i,
            format: 'text'
        });
        ids.push(sent.id);
    }
    return ids;
}

function main() {
    sendMany('menma', 'rook', 60, 'page');
    const first = mail.listMail('rook', { folder: 'inbox', limit: 20 });
    assert.strictEqual(first.length, 20);
    assert.strictEqual(first.total, 60);
    assert.strictEqual(first.unread, 60);
    assert.strictEqual(first.hasMore, true);
    assert.ok(first.nextCursor);
    assert.strictEqual(first.owner, 'rook');

    const second = mail.listMail('rook', { folder: 'inbox', limit: 20, cursor: first.nextCursor });
    assert.strictEqual(second.length, 20);
    assert.strictEqual(second.total, 60);
    assert.strictEqual(second.unread, 60);
    assert.strictEqual(second.hasMore, true);
    const firstIds = new Set(first.map((row) => row.id));
    second.forEach((row) => assert.ok(!firstIds.has(row.id), 'pages must not overlap'));

    const rest = mail.listMail('rook', { folder: 'inbox', limit: 30, cursor: second.nextCursor });
    assert.strictEqual(rest.length, 20);
    assert.strictEqual(rest.hasMore, false);
    assert.strictEqual(rest.nextCursor, null);
    assert.strictEqual(first.length + second.length + rest.length, 60);

    assert.throws(
        () => mail.listMail('rook', { folder: 'inbox', cursor: 'not-a-cursor' }),
        (err) => err.code === 'INVALID_CURSOR'
    );

    const pageIds = first.slice(0, 5).map((row) => row.id);
    const marked = mail.markMailBatch('rook', { ids: pageIds, read: true });
    assert.strictEqual(marked.updated, 5);
    assert.strictEqual(marked.missing.length, 0);
    assert.ok(marked.mail.every((row) => row.read === true));
    const afterRead = mail.listMail('rook', { folder: 'inbox', limit: 1 });
    assert.strictEqual(afterRead.unread, 55);
    assert.strictEqual(afterRead.total, 60);

    const otherId = mail.listMail('menma', { folder: 'sent', limit: 1 })[0].id;
    const cross = mail.markMailBatch('rook', { ids: [pageIds[0], otherId], read: false });
    assert.strictEqual(cross.updated, 1);
    assert.deepStrictEqual(cross.missing, [otherId]);
    assert.strictEqual(mail.markMail('menma', { id: pageIds[1], deleted: true }), null);

    const deleted = mail.markMailBatch('rook', { ids: pageIds.slice(0, 3), deleted: true });
    assert.strictEqual(deleted.updated, 3);
    const inboxAfter = mail.listMail('rook', { folder: 'inbox', limit: 1 });
    assert.strictEqual(inboxAfter.total, 57);
    const trash = mail.listMail('rook', { folder: 'deleted', limit: 10 });
    assert.strictEqual(trash.total, 3);
    const restored = mail.markMailBatch('rook', { ids: pageIds.slice(0, 2), deleted: false });
    assert.strictEqual(restored.updated, 2);
    assert.ok(restored.mail.every((row) => row.folder === 'inbox'));

    const spamIds = first.slice(5, 8).map((row) => row.id);
    const toSpam = mail.markMailBatch('rook', { ids: spamIds, spam: true });
    assert.strictEqual(toSpam.updated, 3);
    assert.ok(toSpam.mail.every((row) => row.folder === 'spam'));
    const notSpam = mail.markMailBatch('rook', { ids: spamIds, spam: false });
    assert.ok(notSpam.mail.every((row) => row.folder === 'inbox'));

    const fwdIds = first.slice(8, 11).map((row) => row.id);
    const fwd = mail.forwardMailBatch('rook', { ids: fwdIds, to: 'ivory' });
    assert.strictEqual(fwd.updated, 3);
    assert.strictEqual(fwd.to, 'ivory');
    assert.strictEqual(fwd.missing.length, 0);
    const ivory = mail.listMail('ivory', { folder: 'inbox' });
    assert.strictEqual(ivory.total, 3);
    ivory.forEach((row) => assert.match(row.subject, /^Fwd:/));

    assert.strictEqual(mail.forwardMailBatch('ivory', { ids: fwdIds, to: 'hoshino' }).updated, 0);
    assert.throws(
        () => mail.markMailBatch('rook', { ids: Array.from({ length: 201 }, (_, i) => 'x' + i) }),
        (err) => err.code === 'BATCH_TOO_LARGE'
    );

    console.log('dovecote batch / pagination tests passed');
}

main();
