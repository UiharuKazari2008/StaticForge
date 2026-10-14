'use strict';

// Dovecote attachment storage: a send writes the bytes once under
// .cache/dovecote/attachments/shared/<attachment-id>. Every mailbox copy
// references that id. The shared file stays until no message references it.
// Legacy rows may still have a per-message file, removed with that message.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-attachments-'));
const dovecoteDatabase = require('../modules/dovecoteDatabase');
assert.strictEqual(dovecoteDatabase.initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');

function attachmentFile(messageId, attachmentId) {
    return path.join(dovecoteDatabase.getAttachmentsRoot(), messageId, attachmentId);
}

function sharedFile(attachmentId) {
    return path.join(dovecoteDatabase.getAttachmentsRoot(), 'shared', attachmentId);
}

function main() {
    const attachmentsRoot = dovecoteDatabase.getAttachmentsRoot();
    assert.strictEqual(attachmentsRoot, path.join(tmpDir, 'dovecote', 'attachments'));

    // One send stores the bytes once. The sent copy and the inbox copy share that file.
    const sent = mail.sendMail({
        fromOwner: 'menma', to: 'rook', subject: 'file', body: 'see attached',
        attachments: [{ name: 'note.txt', mimeType: 'text/plain', data: Buffer.from('hello attachment') }]
    });
    const sentMail = mail.listMail('menma', { folder: 'sent' }).find((m) => m.id === sent.id);
    const inboxMail = mail.listMail('rook', { folder: 'inbox' }).find((m) => m.subject === 'file');
    const attId = sentMail.attachments[0].id;
    assert.strictEqual(attId, inboxMail.attachments[0].id);

    assert.ok(fs.existsSync(sharedFile(attId)), 'send should store one shared blob');
    assert.strictEqual(fs.readFileSync(sharedFile(attId)).toString(), 'hello attachment');
    assert.ok(!fs.existsSync(attachmentFile(sent.id, attId)), 'sent copy must not duplicate the blob');
    assert.ok(!fs.existsSync(attachmentFile(inboxMail.id, attId)), 'inbox copy must not duplicate the blob');

    assert.strictEqual(mail.getAttachment('menma', attId).data.toString(), 'hello attachment');
    assert.strictEqual(mail.getAttachment('rook', attId).data.toString(), 'hello attachment');

    // Forwarding shares the same blob instead of writing another copy.
    const fwd = mail.forwardMail('rook', { id: inboxMail.id, to: 'hoshino' });
    assert.ok(!fs.existsSync(attachmentFile(fwd.id, attId)), 'forward must not duplicate a shared blob');
    assert.strictEqual(mail.getAttachment('hoshino', attId).data.toString(), 'hello attachment');

    // Deleting once just moves the message to the 'deleted' folder — files stay put.
    const deletedOnce = mail.markMail('menma', { id: sent.id, deleted: true });
    assert.strictEqual(deletedOnce.folder, 'deleted');
    assert.strictEqual(deletedOnce.permanentlyDeleted, undefined);
    assert.ok(fs.existsSync(sharedFile(attId)), 'soft delete must not touch the shared blob');

    // Deleting an already-deleted message permanently removes the row.
    // The shared blob stays while another message still references it.
    const deletedTwice = mail.markMail('menma', { id: sent.id, deleted: true });
    assert.strictEqual(deletedTwice.permanentlyDeleted, true);
    assert.strictEqual(mail.readMail('menma', sent.id), null);
    assert.ok(fs.existsSync(sharedFile(attId)), 'shared blob stays while the inbox copy references it');
    assert.strictEqual(mail.getAttachment('rook', attId).data.toString(), 'hello attachment');

    // permanentlyDeleteMail is owner-scoped like everything else.
    const sent2 = mail.sendMail({ fromOwner: 'menma', to: 'hoshino', subject: 'solo', body: 'x' });
    assert.strictEqual(mail.permanentlyDeleteMail('rook', sent2.id), null);
    assert.ok(mail.readMail('menma', sent2.id));

    // Once every message referencing an attachment id is gone, the metadata
    // row is cleaned up too (no permanent orphan growth).
    mail.permanentlyDeleteMail('rook', inboxMail.id);
    assert.ok(fs.existsSync(sharedFile(attId)), 'shared blob stays while the forward still references it');
    mail.permanentlyDeleteMail('hoshino', fwd.id);
    const metaRow = dovecoteDatabase.getDb().prepare('SELECT id FROM dovecote_attachment WHERE id = ?').get(attId);
    assert.strictEqual(metaRow, undefined, 'attachment metadata should be cleaned up once unreferenced');
    assert.ok(!fs.existsSync(sharedFile(attId)), 'shared blob goes away with the last reference');

    console.log('dovecote attachment storage tests passed');
}

function testLegacyBlobMigration() {
    const legacyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-legacy-'));
    const Database = require('better-sqlite3');
    const legacyDbPath = path.join(legacyTmpDir, 'dovecote.db');
    const legacyDb = new Database(legacyDbPath);
    legacyDb.exec(`
        CREATE TABLE dovecote_message (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, folder TEXT NOT NULL,
            archive_subfolder TEXT, thread_id TEXT NOT NULL, from_owner TEXT NOT NULL,
            to_owner TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
            format TEXT NOT NULL DEFAULT 'text', reply_to_id TEXT, fwd_from_owner TEXT,
            fwd_from_message_id TEXT, read INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
            paired_message_id TEXT, attachments TEXT
        )
    `);
    legacyDb.exec(`
        CREATE TABLE dovecote_attachment (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL
        )
    `);
    // Real UUIDs: the file-path guards in dovecoteMail.js only accept
    // UUID-shaped ids (defense in depth for path segments), same as every id
    // this module mints at runtime via crypto.randomUUID().
    const legacyAttId = require('crypto').randomUUID();
    const legacyMsgId = require('crypto').randomUUID();
    legacyDb.prepare(
        'INSERT INTO dovecote_attachment (id, name, mime_type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(legacyAttId, 'old.txt', 'text/plain', 5, Buffer.from('bytes'), '2026-01-01T00:00:00.000Z');
    legacyDb.prepare(`
        INSERT INTO dovecote_message (
            id, owner, folder, archive_subfolder, thread_id, from_owner, to_owner, subject, body,
            format, reply_to_id, fwd_from_owner, fwd_from_message_id, read, flagged, created_at,
            updated_at, deleted_at, paired_message_id, attachments
        ) VALUES (?, 'menma', 'sent', NULL, 't1', 'menma', 'rook', 'old', 'body', 'text', NULL, NULL, NULL, 1, 0, ?, ?, NULL, NULL, ?)
    `).run(legacyMsgId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', JSON.stringify([legacyAttId]));
    legacyDb.close();

    dovecoteDatabase.resetForTests(legacyTmpDir);
    const migratedPath = path.join(legacyTmpDir, 'dovecote', 'attachments', legacyMsgId, legacyAttId);
    assert.ok(fs.existsSync(migratedPath), 'legacy blob should be migrated to a file');
    assert.strictEqual(fs.readFileSync(migratedPath).toString(), 'bytes');

    const columns = dovecoteDatabase.getDb().prepare('PRAGMA table_info(dovecote_attachment)').all().map((c) => c.name);
    assert.ok(!columns.includes('data'), 'data BLOB column should be dropped after migration');

    const fetched = mail.getAttachment('menma', legacyAttId);
    assert.strictEqual(fetched.data.toString(), 'bytes');

    console.log('dovecote legacy blob migration test passed');
}

main();
testLegacyBlobMigration();
