'use strict';

// Multi-recipient Dovecote sends: to/cc as a string or an array, one inbox
// copy per recipient, one shared thread, one shared attachment blob, and
// list/read returning to and cc as arrays (including old single-recipient rows).

const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-multi-'));
const dovecoteDatabase = require('../modules/dovecoteDatabase');
assert.strictEqual(dovecoteDatabase.initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');

function inbox(owner, subject) {
    return mail.listMail(owner, { folder: 'inbox' }).filter((row) => row.subject === subject);
}

function main() {
    const single = mail.sendMail({ fromOwner: 'cursor', to: 'menma', subject: 'one', body: 'hi' });
    assert.deepStrictEqual(single.to, ['menma']);
    assert.deepStrictEqual(single.cc, []);
    const menmaOne = inbox('menma', 'one');
    assert.strictEqual(menmaOne.length, 1);
    assert.deepStrictEqual(menmaOne[0].to, ['menma']);
    assert.deepStrictEqual(menmaOne[0].cc, []);
    assert.deepStrictEqual(mail.readMail('menma', menmaOne[0].id).to, ['menma']);
    assert.strictEqual(mail.listMail('cursor', { folder: 'sent' }).find((row) => row.id === single.id).threadId, menmaOne[0].threadId);

    // Yukimi is an allowed recipient for bots (the tool text used to say otherwise).
    const toYukimi = mail.sendMail({ fromOwner: 'cursor', to: 'yukimi', cc: 'sala', subject: 'for-yukimi', body: 'report' });
    assert.deepStrictEqual(toYukimi.to, ['yukimi']);
    assert.deepStrictEqual(toYukimi.cc, ['sala']);
    assert.strictEqual(inbox('yukimi', 'for-yukimi').length, 1);
    assert.strictEqual(inbox('sala', 'for-yukimi').length, 1);

    const multi = mail.sendMail({
        fromOwner: 'cursor',
        to: ['menma', 'Yukimi', 'menma'],
        cc: ['yukimi', 'rook', 'menma@dream.co.jp'],
        subject: 'fanout',
        body: 'hello all'
    });
    assert.deepStrictEqual(multi.to, ['menma', 'yukimi']);
    assert.deepStrictEqual(multi.cc, ['rook']);
    const recipients = ['menma', 'yukimi', 'rook'];
    const copies = recipients.map((owner) => {
        const rows = inbox(owner, 'fanout');
        assert.strictEqual(rows.length, 1, owner + ' gets exactly one copy');
        return rows[0];
    });
    const threadIds = new Set(copies.map((row) => row.threadId));
    threadIds.add(mail.listMail('cursor', { folder: 'sent' }).find((row) => row.subject === 'fanout').threadId);
    assert.strictEqual(threadIds.size, 1, 'every copy shares one threadId');
    copies.forEach((row) => {
        assert.deepStrictEqual(row.to, ['menma', 'yukimi']);
        assert.deepStrictEqual(row.cc, ['rook']);
        const full = mail.readMail(row.owner, row.id);
        assert.deepStrictEqual(full.to, ['menma', 'yukimi']);
        assert.deepStrictEqual(full.cc, ['rook']);
        assert.strictEqual(full.body, 'hello all');
    });
    assert.strictEqual(mail.listMail('hoshino', { folder: 'inbox' }).filter((row) => row.subject === 'fanout').length, 0);

    // A comma-separated string is the same as an array. Cc-only is a real send.
    const fromString = mail.sendMail({ fromOwner: 'menma', to: 'sala, tifa', cc: 'pyra', subject: 'string-list', body: 'x' });
    assert.deepStrictEqual(fromString.to, ['sala', 'tifa']);
    assert.deepStrictEqual(fromString.cc, ['pyra']);
    assert.strictEqual(inbox('sala', 'string-list').length, 1);
    assert.strictEqual(inbox('tifa', 'string-list').length, 1);
    assert.strictEqual(inbox('pyra', 'string-list').length, 1);
    const ccOnly = mail.sendMail({ fromOwner: 'menma', to: [], cc: 'ivory', subject: 'cc-only', body: 'x' });
    assert.deepStrictEqual(ccOnly.to, []);
    assert.deepStrictEqual(ccOnly.cc, ['ivory']);
    assert.deepStrictEqual(inbox('ivory', 'cc-only')[0].to, []);
    assert.deepStrictEqual(inbox('ivory', 'cc-only')[0].cc, ['ivory']);

    const beforeEmpty = dovecoteDatabase.getDb().prepare('SELECT COUNT(*) AS n FROM dovecote_message').get().n;
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: '', cc: '   ', subject: 'nope', body: 'x' }),
        (err) => err.code === 'EMPTY_RECIPIENTS' && /At least one recipient is required/.test(err.message)
    );
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: [], cc: [], subject: 'nope', body: 'x' }),
        (err) => err.code === 'EMPTY_RECIPIENTS'
    );
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: ['rook', 'not-a-bot'], cc: 'yukimi', subject: 'bad', body: 'x' }),
        (err) => err.code === 'UNKNOWN_RECIPIENT' && /not-a-bot/.test(err.message)
    );
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: { name: 'rook' }, subject: 'bad', body: 'x' }),
        (err) => err.code === 'UNKNOWN_RECIPIENT'
    );
    const afterEmpty = dovecoteDatabase.getDb().prepare('SELECT COUNT(*) AS n FROM dovecote_message').get().n;
    assert.strictEqual(afterEmpty, beforeEmpty, 'a rejected send writes no rows');
    assert.strictEqual(inbox('rook', 'bad').length, 0);

    // Cc opening the message does not stamp the receipt. A To recipient does.
    const receipt = mail.sendMail({ fromOwner: 'cursor', to: 'menma', cc: 'yukimi', subject: 'receipt-cc', body: 'ping' });
    const yukimiCopy = inbox('yukimi', 'receipt-cc')[0];
    mail.readMail('yukimi', yukimiCopy.id);
    assert.strictEqual(mail.listMail('cursor', { folder: 'sent' }).find((row) => row.id === receipt.id).readByRecipient, false);
    mail.readMail('menma', inbox('menma', 'receipt-cc')[0].id);
    assert.strictEqual(mail.listMail('cursor', { folder: 'sent' }).find((row) => row.id === receipt.id).readByRecipient, true);

    // One blob, shared by the sent copy and every recipient. Deleting one copy leaves it.
    const payload = Buffer.from('shared-bytes');
    const withFile = mail.sendMail({
        fromOwner: 'cursor',
        to: ['menma', 'rook'],
        cc: 'yukimi',
        subject: 'shared-file',
        body: 'see attached',
        attachments: [{ name: 'note.txt', mimeType: 'text/plain', data: payload }]
    });
    const sentFile = mail.listMail('cursor', { folder: 'sent' }).find((row) => row.id === withFile.id);
    const attId = sentFile.attachments[0].id;
    const sharedPath = path.join(dovecoteDatabase.getAttachmentsRoot(), 'shared', attId);
    assert.ok(fs.existsSync(sharedPath));
    assert.strictEqual(fs.readFileSync(sharedPath).toString(), 'shared-bytes');
    const holders = ['cursor', 'menma', 'rook', 'yukimi'];
    holders.forEach((owner) => {
        const fetched = mail.getAttachment(owner, attId);
        assert.ok(fetched, owner + ' can read the shared blob');
        assert.strictEqual(fetched.data.toString(), 'shared-bytes');
    });
    const sharedFiles = fs.readdirSync(path.join(dovecoteDatabase.getAttachmentsRoot(), 'shared'));
    assert.ok(sharedFiles.includes(attId));
    holders.slice(1).forEach((owner) => {
        const row = inbox(owner, 'shared-file')[0];
        assert.strictEqual(row.attachments[0].id, attId);
        assert.ok(!fs.existsSync(path.join(dovecoteDatabase.getAttachmentsRoot(), row.id, attId)), 'no per-copy blob');
    });
    mail.permanentlyDeleteMail('menma', inbox('menma', 'shared-file')[0].id);
    assert.ok(fs.existsSync(sharedPath), 'deleting one copy keeps the shared blob');
    assert.strictEqual(mail.getAttachment('rook', attId).data.toString(), 'shared-bytes');

    // A row written before to_list/cc_list existed still lists as arrays.
    const legacyId = crypto.randomUUID();
    const legacyThread = crypto.randomUUID();
    const now = new Date().toISOString();
    dovecoteDatabase.getDb().prepare(`
        INSERT INTO dovecote_message (
            id, owner, folder, archive_subfolder, thread_id, from_owner, to_owner,
            subject, body, format, reply_to_id, fwd_from_owner, fwd_from_message_id,
            read, flagged, created_at, updated_at, deleted_at, paired_message_id, attachments
        ) VALUES (?, 'rook', 'inbox', NULL, ?, 'menma', 'rook', 'legacy', 'old body', 'text', NULL, NULL, NULL, 0, 0, ?, ?, NULL, NULL, NULL)
    `).run(legacyId, legacyThread, now, now);
    const legacy = mail.readMail('rook', legacyId);
    assert.deepStrictEqual(legacy.to, ['rook']);
    assert.deepStrictEqual(legacy.cc, []);
    const legacySummary = mail.listMail('rook', { folder: 'inbox' }).find((row) => row.id === legacyId);
    assert.deepStrictEqual(legacySummary.to, ['rook']);
    assert.deepStrictEqual(legacySummary.cc, []);

    // Mailbox changes push once (send, first read, not a second read of the same row).
    const handler = require('../modules/ws/handlers/250-dovecoteHandler');
    const broadcasts = [];
    handler.registerPackets({
        globalResources: {
            getWebSocketServer: () => ({ broadcast: (msg) => broadcasts.push(msg) })
        }
    });
    broadcasts.length = 0;
    const listMailBeforePush = dovecoteDatabase.getDb().prepare(
        "SELECT COUNT(*) AS n FROM dovecote_audit_log WHERE action = 'list_mail' AND actor = 'sala'"
    ).get().n;
    const pushed = mail.sendMail({ fromOwner: 'yukimi', to: 'sala', subject: 'push', body: 'live' });
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].type, 'dovecote_mailbox_updated');
    assert.ok(broadcasts[0].data.owners.includes('yukimi'));
    assert.ok(broadcasts[0].data.owners.includes('sala'));
    assert.ok(broadcasts[0].data.mailboxes.some((box) => box.owner === 'sala' && box.unread >= 1));
    assert.ok(Array.isArray(broadcasts[0].data.inbox.sala));
    assert.ok(broadcasts[0].data.inbox.sala.some((row) => row.subject === 'push'));
    assert.ok(Array.isArray(broadcasts[0].data.unreadInbox.sala));
    assert.ok(pushed.id);
    const listMailAfterPush = dovecoteDatabase.getDb().prepare(
        "SELECT COUNT(*) AS n FROM dovecote_audit_log WHERE action = 'list_mail' AND actor = 'sala'"
    ).get().n;
    assert.strictEqual(listMailAfterPush, listMailBeforePush, 'mailbox push snapshot must not audit list_mail as the owner');
    const salaId = mail.listMail('sala', { folder: 'inbox' }).find((row) => row.subject === 'push').id;
    broadcasts.length = 0;
    mail.readMail('sala', salaId);
    assert.strictEqual(broadcasts.length, 1);
    assert.ok(broadcasts[0].data.owners.includes('sala'));
    assert.ok(broadcasts[0].data.owners.includes('yukimi'), 'read receipt pushes the sender mailbox too');
    broadcasts.length = 0;
    mail.readMail('sala', salaId);
    assert.strictEqual(broadcasts.length, 0, 'opening an already-read message does not push');
    mail.setMailboxChangedListener(null);

    console.log('dovecote multi-recipient tests passed');
}

main();
