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

    // A bot/job may never write into Yukimi's mailbox, whether sending or forwarding.
    assert.throws(() => mail.sendMail({ fromOwner: 'menma', to: 'yukimi', subject: 'x', body: 'y' }), /Yukimi/);
    try {
        mail.sendMail({ fromOwner: 'menma', to: 'yukimi', subject: 'x', body: 'y' });
        assert.fail('expected DovecoteError');
    } catch (err) {
        assert.ok(err instanceof mail.DovecoteError);
        assert.strictEqual(err.code, 'FORBIDDEN');
    }

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

    assert.throws(() => mail.forwardMail('menma', { id: menmaInbox[0].id, to: 'yukimi' }), /Yukimi/);

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
    assert.strictEqual(mail.resolveOwnerFromActor('YUKIMI'), null);
    assert.strictEqual(mail.resolveOwnerFromActor('yukimi'), null);
    assert.strictEqual(mail.resolveOwnerFromActor('grok'), null);
    assert.strictEqual(mail.resolveOwnerFromActor(''), null);

    // Image load preferences are per-owner/per-sender and additive, not global.
    mail.setImagePref('yukimi', 'Menma', true);
    assert.ok(mail.getAlwaysLoadSenders('yukimi').has('menma'));
    assert.strictEqual(mail.getAlwaysLoadSenders('rook').has('menma'), false);

    console.log('dovecote privacy tests passed');
}

main();
