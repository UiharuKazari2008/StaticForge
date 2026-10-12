'use strict';

// Dovecote privacy matrix: every read/write is scoped to the resolved
// caller's own mailbox. No MCP tool input ever supplies the owner, and
// cross-mailbox reads behave as 404 (return null) rather than leaking
// existence of the message.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-privacy-'));
const { initializeDovecoteDatabase } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');

function main() {
    // Yukimi can send to any bot mailbox.
    const sent = mail.sendMail({ fromOwner: 'yukimi', to: 'menma', subject: 'Hi', body: 'hello', format: 'text' });
    assert.ok(sent.id);
    const menmaInbox = mail.listMail('menma', { folder: 'inbox' });
    assert.strictEqual(menmaInbox.length, 1);
    assert.strictEqual(menmaInbox[0].read, false);

    // Reading marks read, and is scoped to the owner that was passed in.
    const read = mail.readMail('menma', menmaInbox[0].id);
    assert.ok(read);
    assert.strictEqual(read.body, 'hello');
    assert.strictEqual(read.read, true);

    // Another bot's mailbox never sees it — reading someone else's id 404s (null), it does not throw or leak content.
    assert.strictEqual(mail.readMail('rook', menmaInbox[0].id), null);
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).length, 0);

    // Yukimi herself cannot read as a bot she isn't — only resolveOwnerFromActor-backed
    // owners are valid, and reads scoped to an owner that doesn't hold the id 404.
    assert.strictEqual(mail.readMail('hoshino', menmaInbox[0].id), null);

    // Bots may send into Yukimi's mailbox (Yukimi 2026-10-10) but still can't read it.
    mail.sendMail({ fromOwner: 'menma', to: 'yukimi', subject: 'x', body: 'y' });
    assert.strictEqual(mail.listMail('yukimi', { folder: 'inbox' }).length >= 1, true);

    // Bot-to-bot send/forward is fine; it is only Yukimi's mailbox that is walled off.
    mail.sendMail({ fromOwner: 'menma', to: 'rook', subject: 'ping', body: 'pong' });
    assert.strictEqual(mail.listMail('rook', { folder: 'inbox' }).length, 1);

    const fwd = mail.forwardMail('menma', { id: menmaInbox[0].id, to: 'hoshino' });
    assert.ok(fwd);
    const hoshinoInbox = mail.listMail('hoshino', { folder: 'inbox' });
    assert.strictEqual(hoshinoInbox.length, 1);
    assert.strictEqual(hoshinoInbox[0].subject, 'Fwd: Hi');
    assert.strictEqual(hoshinoInbox[0].fwdFromOwner, 'menma');
    // Forwarding is a copy into a fresh thread — it must not share the original thread_id,
    // so the recipient can never pivot into the rest of that conversation.
    assert.notStrictEqual(hoshinoInbox[0].threadId, menmaInbox[0].threadId);

    assert.ok(mail.forwardMail('menma', { id: menmaInbox[0].id, to: 'yukimi' })); // bots may forward to Yukimi (2026-10-10)

    // Forwarding/reading a message id that isn't yours 404s even if it exists elsewhere.
    assert.strictEqual(mail.forwardMail('rook', { id: menmaInbox[0].id, to: 'hoshino' }), null);

    // mark_mail is owner-scoped the same way.
    const archived = mail.markMail('hoshino', { id: hoshinoInbox[0].id, archived: true, archiveSubfolder: 'projects' });
    assert.strictEqual(archived.folder, 'archive');
    assert.strictEqual(archived.archiveSubfolder, 'projects');
    assert.strictEqual(mail.markMail('rook', { id: hoshinoInbox[0].id, deleted: true }), null);

    // Unknown mailbox owners are rejected outright.
    assert.throws(() => mail.listMail('not-a-real-bot'), /Unknown mailbox/);
    assert.strictEqual(mail.isValidOwner('yukimi'), true);
    assert.strictEqual(mail.isValidOwner('claude'), true);
    assert.strictEqual(mail.isValidOwner('grok'), false);
    assert.strictEqual(mail.isBotOwner('yukimi'), false);
    assert.strictEqual(mail.isBotOwner('cursor'), true);

    // resolveOwnerFromActor never maps to the human mailbox, whatever the actor name looks like.
    assert.strictEqual(mail.resolveOwnerFromActor('Menma'), 'menma');
    // Director chat (Wren) callers map to the 'wren' bot mailbox, never the human one.
    assert.strictEqual(mail.resolveOwnerFromActor('Dreamscape Director'), 'wren');
    assert.strictEqual(mail.resolveOwnerFromActor('DreamscapeDirector'), 'wren');
    assert.strictEqual(mail.resolveOwnerFromActor('Wren'), 'wren');
    {
        const w = mail.sendMail({ fromOwner: 'wren', to: 'menma', subject: 'Bug', body: 'weather null', format: 'text' });
        assert.ok(w.id);
        assert.ok(mail.listMail('menma', { folder: 'inbox' }).some((m) => m.subject === 'Bug'));
        mail.sendMail({ fromOwner: 'yukimi', to: 'wren', subject: 'ForWren', body: 'x', format: 'text' });
        const wrenInbox = mail.listMail('wren', { folder: 'inbox' });
        assert.ok(wrenInbox.some((m) => m.subject === 'ForWren'));
        assert.ok(!wrenInbox.some((m) => m.subject === 'Bug'));
        assert.strictEqual(mail.readMail('menma', wrenInbox[0].id), null);
    }
    assert.strictEqual(mail.resolveOwnerFromActor('YUKIMI'), null);
    assert.strictEqual(mail.resolveOwnerFromActor('yukimi'), null);
    assert.strictEqual(mail.resolveOwnerFromActor('grok'), null);
    assert.strictEqual(mail.resolveOwnerFromActor(''), null);

    // Image load preferences are per-owner/per-sender and additive, not global.
    mail.setImagePref('yukimi', 'Menma', true);
    assert.ok(mail.getAlwaysLoadSenders('yukimi').has('menma'));
    assert.strictEqual(mail.getAlwaysLoadSenders('rook').has('menma'), false);

    // Read receipts: readByRecipient flips on the sender's sent copy only once
    // the recipient actually opens the message, and stays true afterward.
    const sent2 = mail.sendMail({ fromOwner: 'menma', to: 'rook', subject: 'ping', body: 'pong2' });
    assert.strictEqual(mail.listMail('menma', { folder: 'sent' }).find((m) => m.id === sent2.id).readByRecipient, false);
    const rookInbox2 = mail.listMail('rook', { folder: 'inbox' });
    const toRead = rookInbox2.find((m) => m.subject === 'ping');
    mail.readMail('rook', toRead.id);
    assert.strictEqual(mail.listMail('menma', { folder: 'sent' }).find((m) => m.id === sent2.id).readByRecipient, true);
    // Marking it unread again afterward does not retract the receipt.
    mail.markMail('rook', { id: toRead.id, read: false });
    assert.strictEqual(mail.listMail('menma', { folder: 'sent' }).find((m) => m.id === sent2.id).readByRecipient, true);

    // The sender re-marking their own already-read sent copy must not forge a receipt onto
    // the recipient's inbox copy — only the actual recipient reading their own copy can set it.
    const sent3 = mail.sendMail({ fromOwner: 'menma', to: 'hoshino', subject: 'no receipt yet', body: 'x' });
    mail.markMail('menma', { id: sent3.id, read: true }); // sent copies start read:true already
    const hoshinoInboxCopy = mail.listMail('hoshino', { folder: 'inbox' }).find((m) => m.subject === 'no receipt yet');
    assert.strictEqual(hoshinoInboxCopy.readByRecipient, false);

    // Attachments: stored bytes are only reachable through a mailbox that actually holds
    // a message referencing them — not a global by-id lookup.
    const withAttachment = mail.sendMail({
        fromOwner: 'menma', to: 'rook', subject: 'file', body: 'see attached',
        attachments: [{ name: 'note.txt', mimeType: 'text/plain', data: Buffer.from('hello attachment') }]
    });
    const rookInboxFile = mail.listMail('rook', { folder: 'inbox' }).find((m) => m.subject === 'file');
    assert.strictEqual(rookInboxFile.attachments.length, 1);
    assert.strictEqual(rookInboxFile.attachments[0].name, 'note.txt');
    assert.strictEqual(rookInboxFile.attachments[0].size, 'hello attachment'.length);
    const attId = rookInboxFile.attachments[0].id;
    const fetched = mail.getAttachment('rook', attId);
    assert.ok(fetched);
    assert.strictEqual(fetched.data.toString(), 'hello attachment');
    // The sender's own sent copy references the same attachment id.
    assert.ok(mail.getAttachment('menma', attId));
    // Nobody else can fetch it, even knowing the id.
    assert.strictEqual(mail.getAttachment('hoshino', attId), null);

    // Per-file and per-message size limits are enforced before anything is written.
    assert.throws(
        () => mail.sendMail({ fromOwner: 'menma', to: 'rook', subject: 'big', body: 'x', attachments: [{ name: 'big.bin', data: Buffer.alloc(mail.MAX_ATTACHMENT_BYTES + 1) }] }),
        /ATTACHMENT_TOO_LARGE|exceeds/
    );
    assert.throws(
        () => mail.sendMail({
            fromOwner: 'menma', to: 'rook', subject: 'big2', body: 'x',
            attachments: [
                { name: 'a.bin', data: Buffer.alloc(mail.MAX_ATTACHMENT_BYTES) },
                { name: 'b.bin', data: Buffer.alloc(mail.MAX_ATTACHMENT_BYTES) },
                { name: 'c.bin', data: Buffer.alloc(mail.MAX_ATTACHMENT_BYTES) }
            ]
        }),
        /ATTACHMENTS_TOO_LARGE|total/
    );

    console.log('dovecote privacy tests passed');
}

main();
