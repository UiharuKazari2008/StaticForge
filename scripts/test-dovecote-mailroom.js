'use strict';

// Mailroom mailbox, trusted X-Original-To (display only), and mailroom-role
// MCP/mail-layer gates. Ordinary bots stay owner-scoped.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovecote-mailroom-'));
const { initializeDovecoteDatabase, getDb } = require('../modules/dovecoteDatabase');
assert.strictEqual(initializeDovecoteDatabase(tmpDir), true);
const mail = require('../modules/dovecoteMail');
const addresses = require('../modules/mailGatewayAddresses');
const spam = require('../modules/mailGatewaySpam');

function auditActions(action) {
    return getDb().prepare('SELECT actor, action, success, detail FROM dovecote_audit_log WHERE action = ?').all(action);
}

function main() {
    assert.strictEqual(mail.isValidOwner('mailroom'), true);
    assert.strictEqual(mail.isBotOwner('mailroom'), true);
    assert.strictEqual(mail.MAILROOM_OWNER, 'mailroom');
    assert.strictEqual(mail.resolveOwnerFromActor('Mailroom'), 'mailroom');
    const map = addresses.createMapping({ mailboxes: addresses.DEFAULT_MAILBOXES });
    assert.strictEqual(addresses.toMailbox('mailroom.ops@dream.737.jp.net', map), 'mailroom');
    assert.strictEqual(addresses.toExternal('mailroom', map), 'mailroom.ops@dream.737.jp.net');

    const trusted = [
        'X-Original-To: <lost.dept@dream.737.jp.net>',
        'X-Original-To: <forged@evil.example>',
        'Received: from sender by mx.dream.737.jp.net',
        'X-Original-To: <below@dream.737.jp.net>',
        'From: alice@example.com'
    ].join('\r\n');
    assert.strictEqual(spam.trustedOriginalTo(trusted), 'lost.dept@dream.737.jp.net');
    assert.strictEqual(spam.trustedOriginalTo([
        'Received: from sender by mx.dream.737.jp.net',
        'X-Original-To: <below@dream.737.jp.net>',
        'From: alice@example.com'
    ].join('\r\n')), null);
    assert.strictEqual(spam.trustedOriginalTo([
        'From: alice@example.com',
        'X-Original-To: <below-from@dream.737.jp.net>'
    ].join('\r\n')), null);

    const inbound = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        fromLabel: 'Alice <alice@example.com>',
        toOwner: 'mailroom',
        subject: 'catch-all',
        body: 'please file',
        originalTo: 'lost.dept@dream.737.jp.net'
    });
    assert.strictEqual(inbound.originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(inbound.route, 'inbound');
    const listed = mail.listMail('mailroom', { folder: 'inbox' });
    assert.strictEqual(listed[0].originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(mail.readMail('ivory', inbound.id), null);

    assert.throws(
        () => mail.mailroomForwardMail('rook', { id: inbound.id, to: 'ivory' }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.throws(
        () => mail.mailroomMoveMail('ivory', { mailbox: 'ivory', id: inbound.id, spam: true }),
        (err) => err.code === 'FORBIDDEN'
    );
    const denied = auditActions('mailroom_forward_mail').concat(auditActions('mailroom_move_mail'));
    assert.ok(denied.some((row) => row.actor === 'rook' && row.success === 0));
    assert.ok(denied.some((row) => row.actor === 'ivory' && row.success === 0));

    const fwd = mail.mailroomForwardMail('mailroom', { id: inbound.id, to: 'ivory' });
    assert.ok(fwd);
    const ivoryCopy = mail.readMail('ivory', fwd.id);
    assert.strictEqual(ivoryCopy.route, 'inbound');
    assert.strictEqual(ivoryCopy.originalTo, 'lost.dept@dream.737.jp.net');
    assert.strictEqual(ivoryCopy.external, true);
    assert.strictEqual(ivoryCopy.labelSuspicious, false);
    assert.ok(auditActions('mailroom_forward_mail').some((row) => row.actor === 'mailroom' && row.success === 1));

    const other = mail.deliverInboundMail({
        fromAddress: 'spam@ext.com',
        toOwner: 'guren',
        subject: 'bot-spam',
        body: 'viagra',
        spam: true
    });
    const moved = mail.mailroomMoveMail('mailroom', { mailbox: 'guren', id: other.id, spam: false });
    assert.strictEqual(moved.folder, 'inbox');
    assert.strictEqual(moved.mailbox, 'guren');
    assert.strictEqual(moved.body, undefined);
    assert.strictEqual(mail.readMail('guren', other.id).folder, 'inbox');
    assert.ok(auditActions('mailroom_move_mail').some((row) => (
        row.actor === 'mailroom' && row.success === 1 && /mailbox=guren/.test(row.detail)
    )));

    const yukimiIn = mail.deliverInboundMail({
        fromAddress: 'alice@example.com',
        toOwner: 'yukimi',
        subject: 'private',
        body: 'no'
    });
    assert.throws(
        () => mail.mailroomMoveMail('mailroom', { mailbox: 'yukimi', id: yukimiIn.id, spam: true }),
        (err) => err.code === 'FORBIDDEN'
    );
    assert.strictEqual(mail.readMail('yukimi', yukimiIn.id).folder, 'inbox');
    assert.ok(auditActions('mailroom_move_mail').some((row) => (
        row.success === 0 && /yukimi/.test(row.detail || '')
    )));

    const facadeSrc = fs.readFileSync(path.join(__dirname, '..', 'modules/mcpAgentFacade.js'), 'utf8');
    assert.match(facadeSrc, /name: 'mailroom_forward_mail'/);
    assert.match(facadeSrc, /name: 'mailroom_move_mail'/);
    assert.match(facadeSrc, /owner !== dovecoteMail\.MAILROOM_OWNER/);
    assert.match(facadeSrc, /role: 'mailroom'/);

    console.log('dovecote mailroom tests passed');
}

main();
